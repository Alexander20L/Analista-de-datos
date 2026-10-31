"""Deterministic, resource-bounded K-Means over registered numeric columns."""

from dataclasses import dataclass

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from app.modules.exploration.adapters.analytics.base import DatasetTool, ToolOutput, finite
from app.modules.exploration.adapters.analytics.columns import numeric_array, require_role
from app.shared.application.errors import AnalysisNotApplicableError
from app.shared.contracts.datasource import RegisteredDataset
from app.shared.domain.enums.semantic_type import SemanticType
from app.shared.domain.models.analysis import ToolRequest

MIN_CLUSTERS = 2
MAX_CLUSTERS = 6


@dataclass(frozen=True)
class Silhouette:
    value: float | None
    sample_size: int
    warning: str | None = None


class KMeansClusteringTool(DatasetTool):
    """Discover statistical groups using two to four standardised numeric variables."""

    name = "kmeans_clustering"
    min_variables = 2
    max_variables = 4

    def compute(self, data: RegisteredDataset, request: ToolRequest) -> ToolOutput:
        variables = list(request.variables)
        for name in variables:
            require_role(data, name, SemanticType.NUMERIC)

        matrix = np.column_stack([numeric_array(data.values(name)) for name in variables])
        missing = np.isnan(matrix).any(axis=1)
        complete = matrix[~missing]
        used = len(complete)
        excluded = len(matrix) - used
        n_clusters = int(request.parameters["n_clusters"])

        if not np.isfinite(complete).all():
            raise AnalysisNotApplicableError(
                "K-Means requires finite observed values; infinity is not treated as missing."
            )
        if used > self.options.kmeans_max_rows:
            raise AnalysisNotApplicableError(
                f"K-Means would process {used} complete observations; the configured limit is "
                f"{self.options.kmeans_max_rows}."
            )
        self.require_sample(used, "K-Means")
        if used <= n_clusters:
            raise AnalysisNotApplicableError(
                f"K-Means needs more complete observations than clusters ({used} <= {n_clusters})."
            )

        constant = [
            name for name, values in zip(variables, complete.T, strict=True) if np.ptp(values) == 0
        ]
        if constant:
            raise AnalysisNotApplicableError(
                f"K-Means cannot standardise constant column(s): {', '.join(constant)}."
            )
        distinct = len(np.unique(complete, axis=0))
        if distinct < n_clusters:
            raise AnalysisNotApplicableError(
                f"K-Means needs at least {n_clusters} distinct complete observations; "
                f"found {distinct}."
            )

        scaler = StandardScaler()
        standardised = scaler.fit_transform(complete)
        model = KMeans(
            n_clusters=n_clusters,
            random_state=self.options.random_seed,
            n_init=self.options.kmeans_n_init,
            max_iter=self.options.kmeans_max_iter,
        ).fit(standardised)
        labels = model.labels_.astype(int, copy=False)
        represented = np.unique(labels)
        if len(represented) != n_clusters:
            raise AnalysisNotApplicableError(
                f"K-Means produced {len(represented)} non-empty clusters instead of {n_clusters}."
            )

        centroids = scaler.inverse_transform(model.cluster_centers_)
        silhouette = self._silhouette(standardised, labels)
        point_indices = self._sample_indices(
            labels, self.options.kmeans_max_plot_points, self.options.random_seed
        )
        sampled = len(point_indices) < used

        warnings: list[str] = []
        if excluded:
            warnings.append(
                f"Excluded {excluded} row(s) with a missing value in at least one "
                "selected variable."
            )
        if sampled:
            warnings.append(
                f"Showing a deterministic sample of {len(point_indices)} of {used} "
                "clustered points."
            )
        if silhouette.warning:
            warnings.append(silhouette.warning)
        elif silhouette.sample_size < used:
            warnings.append(
                f"Silhouette was calculated on a deterministic sample of "
                f"{silhouette.sample_size} of {used} observations."
            )

        clusters = []
        for cluster in range(n_clusters):
            center = centroids[cluster]
            clusters.append(
                {
                    "cluster": cluster,
                    "count": int(np.count_nonzero(labels == cluster)),
                    "centroid": {
                        name: finite(value) for name, value in zip(variables, center, strict=True)
                    },
                }
            )

        points = [
            {
                "x": finite(complete[index, 0]),
                "y": finite(complete[index, 1]),
                "cluster": int(labels[index]),
            }
            for index in point_indices
        ]
        result = {
            "kind": "kmeans",
            "variables": variables,
            "n_clusters": n_clusters,
            "clusters": clusters,
            "inertia": finite(model.inertia_),
            "silhouette": finite(silhouette.value),
            "silhouette_sample_size": silhouette.sample_size,
            "observations_used": used,
            "observations_excluded": excluded,
            "total_observations": len(matrix),
            "projection": {
                "x": variables[0],
                "y": variables[1],
                "uses_all_selected_variables": True,
            },
            "points": points,
            "total_points": used,
            "sampled": sampled,
            "interpretation": (
                "Grupos estadísticos basados únicamente en las variables numéricas seleccionadas; "
                "no son categorías verificadas ni grupos causales."
            ),
        }
        return ToolOutput(
            result=result,
            variables=variables,
            sample_size=used,
            warnings=warnings,
            metadata={
                "algorithm": "kmeans",
                "standardised": True,
                "random_seed": self.options.random_seed,
                "n_init": self.options.kmeans_n_init,
                "max_iter": self.options.kmeans_max_iter,
            },
        )

    def _silhouette(self, values: np.ndarray, labels: np.ndarray) -> Silhouette:
        represented = len(np.unique(labels))
        size = len(values)
        if represented < MIN_CLUSTERS or represented >= size:
            return Silhouette(
                None,
                0,
                "Silhouette is unavailable because it requires between 2 and n-1 clusters.",
            )
        limit = self.options.kmeans_silhouette_max_rows
        if limit <= represented:
            return Silhouette(
                None,
                0,
                f"Silhouette is unavailable because its sample limit ({limit}) must exceed "
                f"the number of represented clusters ({represented}).",
            )
        indices = self._sample_indices(labels, min(limit, size), self.options.random_seed)
        sampled_values = values[indices]
        sampled_labels = labels[indices]
        try:
            value = float(silhouette_score(sampled_values, sampled_labels))
        except ValueError as error:
            return Silhouette(None, len(indices), f"Silhouette is unavailable: {error}")
        return Silhouette(value, len(indices))

    @staticmethod
    def _sample_indices(labels: np.ndarray, limit: int, seed: int) -> np.ndarray:
        """Sample deterministically while retaining at least one point from every cluster."""

        size = len(labels)
        if size <= limit:
            return np.arange(size, dtype=int)
        rng = np.random.default_rng(seed)
        representatives = np.asarray(
            [rng.choice(np.flatnonzero(labels == cluster)) for cluster in np.unique(labels)],
            dtype=int,
        )
        remaining = np.setdiff1d(np.arange(size, dtype=int), representatives, assume_unique=False)
        extra = rng.choice(remaining, size=limit - len(representatives), replace=False)
        return np.sort(np.concatenate((representatives, extra)))
