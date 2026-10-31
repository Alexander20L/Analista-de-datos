"""Shared validation for EDA HTTP and internal calls; unknown options are rejected."""

import math

from app.shared.application.errors import ToolInputError
from app.shared.domain.models.analysis import ToolRequest


def validate_parameters(request: ToolRequest, *, max_groups: int) -> None:
    allowed = {
        "relationship_ranking": {"significance_level", "top_k"},
        "correlation_matrix": {"method"},
        "chart_correlation_heatmap": {"method"},
        "grouped_summary": {"max_groups"},
        "kmeans_clustering": {"n_clusters"},
    }.get(request.method, set())
    unknown = set(request.parameters) - allowed
    if unknown:
        raise ToolInputError(
            f"Unknown parameters for {request.method}: {', '.join(sorted(unknown))}"
        )
    if len(set(request.variables)) != len(request.variables):
        raise ToolInputError("Variables must be distinct")
    if request.method == "kmeans_clustering" and "n_clusters" not in request.parameters:
        raise ToolInputError("n_clusters is required for kmeans_clustering")
    for name, value in request.parameters.items():
        if name == "method" and value not in ("pearson", "spearman"):
            raise ToolInputError("method must be pearson or spearman")
        if name == "significance_level" and (
            isinstance(value, bool)
            or not isinstance(value, (float, int))
            or not math.isfinite(value)
            or not 0 < value < 1
        ):
            raise ToolInputError("significance_level must be a finite number between 0 and 1")
        if name in ("top_k", "max_groups") and (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not 1 <= value <= (max_groups if name == "max_groups" else 1000)
        ):
            cap = max_groups if name == "max_groups" else 1000
            raise ToolInputError(f"{name} must be an integer between 1 and {cap}.")
        if name == "n_clusters" and (
            isinstance(value, bool) or not isinstance(value, int) or not 2 <= value <= 6
        ):
            raise ToolInputError("n_clusters must be an integer between 2 and 6.")
