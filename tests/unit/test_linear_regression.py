"""Numerical references are independent of the tool's SciPy regression solver."""

import copy
import json
from fractions import Fraction
from math import sqrt

import numpy as np
import pytest
from eda_support import make_dataset, store_with

from app.modules.analysis.adapters.analytics.factory import build_statistical_tool_registry
from app.modules.exploration.adapters.analytics.association.linear_regression import (
    LinearRegressionTool,
)
from app.modules.exploration.adapters.visualization.charts import ScatterChart
from app.shared.application.dataset_registry import DatasetRegistry
from app.shared.config.settings import Settings
from app.shared.contracts.datasource import RegisteredDataset
from app.shared.domain.enums.semantic_type import SemanticType
from app.shared.domain.models.analysis import AnalysisResult, ToolRequest


def dataset(xs, ys) -> RegisteredDataset:
    return make_dataset(
        {"x": list(xs), "y": list(ys)},
        {"x": SemanticType.NUMERIC, "y": SemanticType.NUMERIC},
    )


async def run(data, variables=None, parameters=None, *, minimum=20, limit=7, seed=17):
    settings = Settings(_env_file=None, eda={"max_scatter_points": limit, "random_seed": seed})
    tool = LinearRegressionTool(await store_with(data), settings.eda, minimum)
    return await tool.execute(
        ToolRequest(
            dataset_id=data.dataset_id,
            method="linear_regression",
            variables=["x", "y"] if variables is None else variables,
            parameters=parameters or {},
        )
    )


def assert_no_metrics(result: AnalysisResult, status: str) -> None:
    assert result.status == status
    assert result.result is None
    assert result.sample_size is None
    assert result.p_value is None and result.effect_size is None
    assert result.warnings
    json.dumps(result.model_dump(mode="json"), allow_nan=False)


@pytest.mark.parametrize("slope,intercept", [(2.75, -4.5), (-3.25, 8.0)])
async def test_perfect_fit(slope: float, intercept: float) -> None:
    xs = np.tile([-4.0, -1.0, 0.0, 2.0, 5.0], 8)
    result = await run(dataset(xs, slope * xs + intercept))
    assert result.status == "SUCCESS"
    values = result.result
    # Well-scaled data: 1e-12 absolute/relative accommodates float64 roundoff.
    assert values["slope"] == pytest.approx(slope, rel=1e-12, abs=1e-12)
    assert values["intercept"] == pytest.approx(intercept, rel=1e-12, abs=1e-12)
    assert values["r_squared"] == pytest.approx(1.0, abs=1e-12)
    assert values["rmse"] == pytest.approx(0.0, abs=1e-12)
    assert values["observations_used"] == result.sample_size == 40
    assert values["observations_excluded"] == 0
    assert values["equation"] == f"ŷ = {slope:.12g} × X {intercept:+.12g}"
    assert all(abs(error) < 1e-12 for _, error in values["residual_diagnostics"]["points"])


async def test_metrics_match_exact_rational_reference_with_noise() -> None:
    xs, ys = [-2, -1, 0, 1, 2] * 6, [1, 0, 3, 4, 7] * 6
    n = len(xs)
    mean_x, mean_y = Fraction(sum(xs), n), Fraction(sum(ys), n)
    xx = sum((x - mean_x) ** 2 for x in xs)
    xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True))
    slope = xy / xx
    intercept = mean_y - slope * mean_x
    sse = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys, strict=True))
    sst = sum((y - mean_y) ** 2 for y in ys)
    result = await run(dataset(xs, ys))
    assert result.status == "SUCCESS"
    for key, expected in {
        "slope": float(slope),
        "intercept": float(intercept),
        "r_squared": float(1 - sse / sst),
        "rmse": sqrt(float(sse / n)),
    }.items():
        assert result.result[key] == pytest.approx(expected, rel=1e-12, abs=1e-12)


async def test_seeded_noise_matches_independent_lstsq_on_all_valid_rows() -> None:
    rng = np.random.default_rng(91)
    xs = rng.normal(5, 2, 500)
    ys = 1.7 * xs - 2.3 + rng.normal(0, 1.2, len(xs))
    design = np.column_stack((xs, np.ones(len(xs))))
    slope, intercept = np.linalg.lstsq(design, ys, rcond=None)[0]
    sse = np.sum((ys - design @ [slope, intercept]) ** 2)
    sst = np.sum((ys - ys.mean()) ** 2)
    result = await run(dataset(xs, ys), limit=3)
    assert result.status == "SUCCESS"
    # Independent solvers on this well-conditioned matrix agree within 1e-10.
    for key, expected in {
        "slope": slope,
        "intercept": intercept,
        "r_squared": 1 - sse / sst,
        "rmse": np.sqrt(sse / len(xs)),
    }.items():
        assert result.result[key] == pytest.approx(expected, rel=1e-10, abs=1e-12)
    assert result.sample_size == 500
    assert len(result.result["chart"]["points"]) == 3
    assert any("in-sample" in note and "causation" in note for note in result.warnings)


async def test_small_coefficients_are_not_rounded_to_zero() -> None:
    xs = np.tile([-4.0, -1.0, 0.0, 2.0, 5.0], 8)
    result = await run(dataset(xs, 1e-10 * xs + 2e-9))
    assert result.status == "SUCCESS"
    assert result.result["slope"] == pytest.approx(1e-10, rel=1e-12, abs=0)
    assert result.result["intercept"] == pytest.approx(2e-9, rel=1e-12, abs=0)
    assert result.result["chart"]["trend"]["slope"] == result.result["slope"]


async def test_joint_filter_excludes_missing_nan_and_both_infinities_once_per_row() -> None:
    xs = [float(i % 5) for i in range(40)]
    ys = [2 * x + 1 for x in xs]
    for index, x, y in [
        (0, None, 9),
        (3, 9, None),
        (7, None, None),
        (11, np.nan, 8),
        (15, np.inf, 8),
        (19, 9, -np.inf),
        (23, -np.inf, np.inf),
    ]:
        xs[index], ys[index] = x, y
    result = await run(dataset(xs, ys), limit=100)
    assert result.status == "SUCCESS"
    values = result.result
    assert values["observations_used"] == result.sample_size == 33
    assert values["observations_excluded"] == 7
    assert values["slope"] == pytest.approx(2)
    assert values["intercept"] == pytest.approx(1)
    assert values["r_squared"] == pytest.approx(1)
    assert values["rmse"] == pytest.approx(0, abs=1e-12)
    assert all(y == 2 * x + 1 for x, y in values["chart"]["points"])
    assert any("Excluded 7 rows" in note for note in result.warnings)
    json.dumps(result.model_dump(mode="json"), allow_nan=False)


@pytest.mark.parametrize("size", [0, 1, 19])
async def test_insufficient_sample(size: int) -> None:
    assert_no_metrics(await run(dataset(range(size), range(size))), "SKIPPED")


async def test_minimum_applies_after_filtering() -> None:
    result = await run(dataset(list(range(19)) + [None] * 20, range(39)))
    assert_no_metrics(result, "SKIPPED")
    assert "19 complete observations" in result.warnings[0]


async def test_configured_minimum_is_respected_including_two_point_fit() -> None:
    data = dataset([0, 2], [1, 5])
    assert_no_metrics(await run(data, minimum=3), "SKIPPED")
    result = await run(data, minimum=2)
    assert result.status == "SUCCESS" and result.sample_size == 2
    assert result.result["rmse"] == 0


@pytest.mark.parametrize("constant", ["x", "y", "both", "after_filter"])
async def test_constant_variables_are_skipped(constant: str) -> None:
    xs, ys = list(range(30)), list(range(30))
    if constant in ("x", "both"):
        xs = [2] * 30
    if constant in ("y", "both"):
        ys = [3] * 30
    if constant == "after_filter":
        xs, ys = [2] * 25 + list(range(5)), list(range(25)) + [None] * 5
    result = await run(dataset(xs, ys))
    assert_no_metrics(result, "SKIPPED")
    assert "non-constant" in result.warnings[0]


@pytest.mark.parametrize("role", [SemanticType.CATEGORICAL, SemanticType.IDENTIFIER])
async def test_non_numeric_semantic_columns_are_skipped(role: SemanticType) -> None:
    data = make_dataset(
        {"x": ["a", "b"] * 15, "y": list(range(30))}, {"x": role, "y": SemanticType.NUMERIC}
    )
    assert_no_metrics(await run(data), "SKIPPED")


@pytest.mark.parametrize("invalid", ["3", True])
async def test_invalid_values_in_numeric_column_are_not_coerced(invalid) -> None:
    assert_no_metrics(await run(dataset([invalid] + list(range(29)), range(30))), "SKIPPED")


@pytest.mark.parametrize(
    "variables,parameters",
    [
        ([], {}),
        (["x"], {}),
        (["x", "y", "z"], {}),
        (["x", "x"], {}),
        (["unknown", "y"], {}),
        (["x", "y"], {"fit_intercept": False}),
    ],
)
async def test_invalid_requests_fail_without_metrics(variables, parameters) -> None:
    assert_no_metrics(await run(dataset(range(30), range(30)), variables, parameters), "FAILED")


async def test_inconsistent_column_lengths_fail() -> None:
    assert_no_metrics(await run(dataset(range(30), range(29))), "FAILED")


@pytest.mark.parametrize(
    "xs,ys",
    [
        ([1e308, -1e308] * 15, [1, -1] * 15),
        ([1, 2] * 15, [1e-200, 2e-200] * 15),
    ],
)
async def test_non_representable_calculation_fails_without_invented_metrics(xs, ys) -> None:
    assert_no_metrics(await run(dataset(xs, ys)), "FAILED")


async def test_sampling_is_reproducible_and_does_not_change_fit() -> None:
    rng = np.random.default_rng(4)
    xs = rng.normal(size=100)
    data = dataset(xs, 2 * xs + rng.normal(size=100))
    first, again = await run(data), await run(data)
    other_seed = await run(data, seed=18)
    complete = await run(data, limit=100)
    assert first.status == again.status == other_seed.status == complete.status == "SUCCESS"
    assert first.result == again.result
    chart = ScatterChart.model_validate(first.result["chart"])
    assert chart.sampled and len(chart.points) == 7 and chart.total_points == 100
    assert first.result["chart"]["points"] != other_seed.result["chart"]["points"]
    assert not complete.result["chart"]["sampled"]
    for key in ("slope", "intercept", "r_squared", "rmse"):
        assert first.result[key] == other_seed.result[key] == complete.result[key]
    assert chart.trend.slope == first.result["slope"]
    assert chart.trend.intercept == first.result["intercept"]
    assert set(chart.points).issubset(set(zip(data.values("x"), data.values("y"), strict=True)))


async def test_swapping_variables_changes_the_direction_of_the_fit() -> None:
    data = dataset([-2, -1, 0, 1, 2] * 6, [1, 0, 3, 4, 7] * 6)
    forward, reverse = await run(data), await run(data, ["y", "x"])
    assert forward.variables == ["x", "y"] and reverse.variables == ["y", "x"]
    assert forward.result["slope"] == pytest.approx(1.6)
    assert reverse.result["slope"] == pytest.approx(16 / 30)
    assert reverse.result["chart"]["x"] == reverse.result["x"] == "y"
    assert reverse.result["chart"]["y"] == reverse.result["y"] == "x"


@pytest.mark.parametrize("outcome", ["success", "skipped", "failed", "calculation_failed"])
async def test_dataset_is_preserved_for_every_outcome(outcome: str) -> None:
    xs = [None] + list(range(30))
    ys = [0] + ([1] * 30 if outcome == "skipped" else list(range(30)))
    if outcome == "calculation_failed":
        xs, ys = [0] + [1e308, -1e308] * 15, [0] + [1, -1] * 15
    data = dataset(xs, ys)
    before_columns = copy.deepcopy(data.dataset.table.columns)
    before_profile = data.profile.model_dump()
    before_schema = data.dataset.schema.model_dump()
    variables = ["missing", "y"] if outcome == "failed" else ["x", "y"]
    result = await run(data, variables)
    expected = {
        "success": "SUCCESS",
        "skipped": "SKIPPED",
        "failed": "FAILED",
        "calculation_failed": "FAILED",
    }
    assert result.status == expected[outcome]
    assert data.dataset.table.columns == before_columns
    assert data.profile.model_dump() == before_profile
    assert data.dataset.schema.model_dump() == before_schema
    assert data.dataset.row_count == 31


def test_regression_is_not_registered_in_the_automatic_analysis_workflow() -> None:
    assert "linear_regression" not in build_statistical_tool_registry(DatasetRegistry()).names()


async def test_residuals_and_estimates_match_independent_least_squares() -> None:
    rng = np.random.default_rng(53)
    xs = rng.normal(2, 3, 120)
    ys = -1.7 * xs + 4.2 + rng.normal(0, 0.8, len(xs))
    design = np.column_stack((xs, np.ones(len(xs))))
    coefficients = np.linalg.lstsq(design, ys, rcond=None)[0]
    expected = design @ coefficients
    result = await run(dataset(xs, ys), limit=200)
    assert result.status == "SUCCESS"
    diagnostic = result.result["residual_diagnostics"]
    assert diagnostic["kind"] == "residuals" and diagnostic["x"] == "x" and diagnostic["y"] == "y"
    assert diagnostic["total_points"] == 120 and diagnostic["sampled"] is False
    actual = np.asarray(diagnostic["points"])
    np.testing.assert_allclose(actual[:, 0], expected, rtol=1e-10, atol=1e-12)
    np.testing.assert_allclose(actual[:, 1], ys - expected, rtol=1e-10, atol=1e-12)
    assert np.sqrt(np.mean(actual[:, 1] ** 2)) == pytest.approx(result.result["rmse"])
    assert actual[:, 1].mean() == pytest.approx(0, abs=1e-12)


async def test_diagnostic_sampling_matches_the_legacy_chart_and_preserves_all_metrics() -> None:
    rng = np.random.default_rng(8)
    xs = rng.normal(size=100)
    data = dataset(xs, 3 * xs - 2 + rng.normal(size=100))
    first = await run(data, limit=5, seed=9)
    again = await run(data, limit=5, seed=9)
    other = await run(data, limit=5, seed=10)
    full = await run(data, limit=100)
    assert first.result["residual_diagnostics"] == again.result["residual_diagnostics"]
    assert first.result["residual_diagnostics"] != other.result["residual_diagnostics"]
    diagnostic = first.result["residual_diagnostics"]
    assert len(diagnostic["points"]) == 5 and diagnostic["sampled"] is True
    assert diagnostic["total_points"] == first.sample_size == 100
    slope, intercept = first.result["slope"], first.result["intercept"]
    for (x, y), (estimate, error) in zip(
        first.result["chart"]["points"], diagnostic["points"], strict=True
    ):
        assert estimate == slope * x + intercept
        assert error == y - estimate
    for key in ("slope", "intercept", "r_squared", "rmse", "equation", "observations_used"):
        assert first.result[key] == other.result[key] == full.result[key]


async def test_diagnostics_exclude_non_finite_pairs_without_losing_alignment() -> None:
    xs = [None, np.inf] + list(range(30))
    ys = [4, 5] + [2 * x + 1 for x in range(30)]
    result = await run(dataset(xs, ys), limit=40)
    diagnostic = result.result["residual_diagnostics"]
    assert diagnostic["total_points"] == 30
    assert result.result["observations_excluded"] == 2
    assert len(diagnostic["points"]) == 30
    np.testing.assert_allclose(diagnostic["points"], [[float(y), 0.0] for y in ys[2:]], atol=1e-12)
    json.dumps(result.model_dump(mode="json"), allow_nan=False)
