import json

import numpy as np
import pytest
from eda_support import make_dataset, store_with

from app.modules.exploration.adapters.analytics.clustering.kmeans import (
    KMeansClusteringTool,
)
from app.shared.config.settings import Settings
from app.shared.domain.enums.semantic_type import SemanticType
from app.shared.domain.models.analysis import AnalysisResult, ToolRequest


def clustered_dataset(
    centers: list[tuple[float, float]], *, rows_per_cluster: int = 30, seed: int = 7
):
    rng = np.random.default_rng(seed)
    first: list[object] = []
    second: list[object] = []
    for x, y in centers:
        first.extend(float(value) for value in rng.normal(x, 0.15, rows_per_cluster))
        second.extend(float(value) for value in rng.normal(y, 2.0, rows_per_cluster))
    return make_dataset(
        {"x": first, "y": second},
        {"x": SemanticType.NUMERIC, "y": SemanticType.NUMERIC},
    )


async def run(
    dataset,
    *variables: str,
    n_clusters: object = 2,
    eda: dict[str, object] | None = None,
    include_parameter: bool = True,
) -> AnalysisResult:
    settings = Settings(_env_file=None, eda=eda or {})
    tool = KMeansClusteringTool(
        await store_with(dataset), settings.eda, settings.analysis.minimum_sample_size
    )
    parameters = {"n_clusters": n_clusters} if include_parameter else {}
    result = await tool.execute(
        ToolRequest(
            dataset_id=dataset.dataset_id,
            method="kmeans_clustering",
            variables=list(variables),
            parameters=parameters,
        )
    )
    json.dumps(result.model_dump(mode="json"), allow_nan=False)
    return result


async def test_two_separated_groups_return_counts_original_centroids_and_metrics() -> None:
    data = clustered_dataset([(-10.0, 100.0), (10.0, 1000.0)])
    result = await run(data, "x", "y")

    assert result.status == "SUCCESS" and result.sample_size == 60
    output = result.result
    assert isinstance(output, dict)
    assert output["observations_used"] == 60 and output["observations_excluded"] == 0
    assert sorted(cluster["count"] for cluster in output["clusters"]) == [30, 30]
    centers = sorted(output["clusters"], key=lambda cluster: cluster["centroid"]["x"])
    assert centers[0]["centroid"]["x"] == pytest.approx(-10, abs=0.2)
    assert centers[0]["centroid"]["y"] == pytest.approx(100, abs=2)
    assert centers[1]["centroid"]["x"] == pytest.approx(10, abs=0.2)
    assert centers[1]["centroid"]["y"] == pytest.approx(1000, abs=2)
    assert np.isfinite(output["inertia"]) and output["inertia"] >= 0
    assert 0.8 < output["silhouette"] <= 1
    assert output["projection"] == {
        "x": "x",
        "y": "y",
        "uses_all_selected_variables": True,
    }


async def test_three_groups_are_reproducible_without_relying_on_cluster_ids() -> None:
    data = clustered_dataset([(-8.0, 50.0), (0.0, 500.0), (9.0, 950.0)], seed=11)
    first = await run(data, "x", "y", n_clusters=3)
    second = await run(data, "x", "y", n_clusters=3)

    assert first.status == second.status == "SUCCESS"
    assert first.result == second.result
    assert sorted(cluster["count"] for cluster in first.result["clusters"]) == [30, 30, 30]
    xs = sorted(cluster["centroid"]["x"] for cluster in first.result["clusters"])
    assert xs == pytest.approx([-8, 0, 9], abs=0.2)


async def test_accepts_four_numeric_variables_and_rejects_a_fifth() -> None:
    rng = np.random.default_rng(4)
    group = np.repeat([-1.0, 1.0], 20)
    columns = {
        name: [float(value) for value in group * scale + rng.normal(0, 0.05, len(group))]
        for name, scale in zip(("a", "b", "c", "d", "e"), (1, 10, 100, 1000, 10000), strict=True)
    }
    data = make_dataset(columns, {name: SemanticType.NUMERIC for name in columns})

    accepted = await run(data, "a", "b", "c", "d")
    rejected = await run(data, "a", "b", "c", "d", "e")

    assert accepted.status == "SUCCESS"
    assert accepted.result["variables"] == ["a", "b", "c", "d"]
    assert all(
        set(cluster["centroid"]) == {"a", "b", "c", "d"} for cluster in accepted.result["clusters"]
    )
    assert rejected.status == "FAILED" and "expected 2 to 4" in rejected.warnings[0]


async def test_missing_rows_are_excluded_and_the_registered_dataset_is_unchanged() -> None:
    original_x: list[object] = [-5.0] * 12 + [5.0] * 12
    original_y: list[object] = [10.0 + index / 10 for index in range(12)] + [
        100.0 + index / 10 for index in range(12)
    ]
    original_x[2] = None
    original_y[18] = None
    data = make_dataset(
        {"x": original_x, "y": original_y},
        {"x": SemanticType.NUMERIC, "y": SemanticType.NUMERIC},
    )
    before = {"x": data.values("x"), "y": data.values("y")}

    result = await run(data, "x", "y")

    assert result.status == "SUCCESS"
    assert result.result["observations_used"] == 22
    assert result.result["observations_excluded"] == 2
    assert "Excluded 2 row(s)" in result.warnings[0]
    assert data.values("x") == before["x"] and data.values("y") == before["y"]


async def test_constant_incompatible_and_insufficient_data_are_skipped() -> None:
    constant = make_dataset(
        {"x": [1.0] * 20, "y": [float(value) for value in range(20)]},
        {"x": SemanticType.NUMERIC, "y": SemanticType.NUMERIC},
    )
    assert (await run(constant, "x", "y")).status == "SKIPPED"

    incompatible = make_dataset(
        {"x": [float(value) for value in range(20)], "group": ["a", "b"] * 10},
        {"x": SemanticType.NUMERIC, "group": SemanticType.CATEGORICAL},
    )
    assert (await run(incompatible, "x", "group")).status == "SKIPPED"

    small = clustered_dataset([(-1.0, 0.0), (1.0, 5.0)], rows_per_cluster=5)
    result = await run(small, "x", "y")
    assert result.status == "SKIPPED" and "at least 20" in result.warnings[0]


@pytest.mark.parametrize("value", [1, 7, 2.5, "3", True])
async def test_invalid_cluster_parameters_fail(value: object) -> None:
    data = clustered_dataset([(-1.0, 0.0), (1.0, 5.0)])
    result = await run(data, "x", "y", n_clusters=value)
    assert result.status == "FAILED"
    assert "n_clusters must be an integer between 2 and 6" in result.warnings[0]


async def test_missing_parameter_duplicate_unknown_and_wrong_arity_fail() -> None:
    data = clustered_dataset([(-1.0, 0.0), (1.0, 5.0)])
    assert (await run(data, "x", "y", include_parameter=False)).status == "FAILED"
    assert (await run(data, "x", "x")).status == "FAILED"
    assert (await run(data, "x", "missing")).status == "FAILED"
    assert (await run(data, "x")).status == "FAILED"


async def test_resource_limits_bound_model_plot_and_silhouette_work() -> None:
    data = clustered_dataset(
        [(-12.0, 0.0), (-7.0, 100.0), (-2.0, 200.0), (3.0, 300.0), (8.0, 400.0), (13.0, 500.0)],
        rows_per_cluster=40,
    )
    limited = await run(data, "x", "y", n_clusters=6, eda={"kmeans_max_rows": 200})
    assert limited.status == "SKIPPED" and "configured limit is 200" in limited.warnings[0]

    result = await run(
        data,
        "x",
        "y",
        n_clusters=6,
        eda={"kmeans_max_plot_points": 20, "kmeans_silhouette_max_rows": 30},
    )
    assert result.status == "SUCCESS"
    assert len(result.result["points"]) == 20 and result.result["sampled"] is True
    assert {point["cluster"] for point in result.result["points"]} == set(range(6))
    assert result.result["silhouette"] is not None
    assert result.result["silhouette_sample_size"] == 30

    unavailable = await run(data, "x", "y", n_clusters=6, eda={"kmeans_silhouette_max_rows": 6})
    assert unavailable.status == "SUCCESS"
    assert unavailable.result["silhouette"] is None
    assert unavailable.result["silhouette_sample_size"] == 0
    assert any("Silhouette is unavailable" in warning for warning in unavailable.warnings)
