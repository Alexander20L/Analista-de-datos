"""Exercise the existing HTTP tools endpoint against real intake and storage."""

import csv
import io
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app
from app.shared.config.settings import Settings


@pytest.fixture
def regression_client():
    with TestClient(create_app(Settings(_env_file=None, eda={"max_scatter_points": 5}))) as client:
        yield client


def upload(client: TestClient, rows=60, *, missing=False) -> str:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["x", "y", "category", "constant"])
    for index in range(rows):
        x = index % 30
        y = 2.5 * x - 3
        if missing and index in (0, 3):
            x = None
        if missing and index in (3, 7):
            y = None
        writer.writerow([x, y, "AB"[index % 2], 4])
    response = client.post(
        "/intake", files={"file": ("regression.csv", stream.getvalue().encode(), "text/csv")}
    )
    assert response.status_code == 200
    return response.json()["profile"]["dataset_id"]


def execute(client: TestClient, dataset_id: str, body=None):
    return client.post(
        f"/datasets/{dataset_id}/tools/linear_regression",
        json={"variables": ["x", "y"], "parameters": {}} if body is None else body,
    )


def test_catalog_adds_regression_and_preserves_previous_tools(regression_client):
    response = regression_client.get("/tools")
    assert response.status_code == 200
    names = response.json()["tools"]
    assert len(names) == len(set(names))
    assert {
        "linear_regression",
        "descriptive_statistics",
        "missing_values",
        "distribution",
        "cardinality",
        "outliers",
        "grouped_summary",
        "pearson",
        "spearman",
        "chi_square",
        "cramers_v",
        "anova",
        "kruskal_wallis",
        "mutual_information",
        "correlation_matrix",
        "relationship_ranking",
        "chart_correlation_heatmap",
        "chart_scatter",
        "chart_histogram",
        "chart_boxplot",
        "chart_contingency",
        "partial_correlation",
    } <= set(names)


def test_regression_uses_loaded_dataset_without_rereading_or_mutating_it(
    regression_client, monkeypatch
):
    client = regression_client
    dataset_id = upload(client)
    stored = client.portal.call(client.app.state.datasets.get, dataset_id)
    before_frame = stored.dataset.table.frame.copy(deep=True)
    before_profile = stored.profile.model_dump()
    before_schema = stored.dataset.schema.model_dump()
    before_preview = client.get(f"/datasets/{dataset_id}/preview").json()

    def forbidden(*args, **kwargs):
        raise AssertionError("Regression must not re-read the uploaded source")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "open", forbidden)
        response = execute(client, dataset_id)
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "SUCCESS" and payload["method"] == "linear_regression"
    assert payload["variables"] == ["x", "y"]
    assert payload["p_value"] is None and payload["effect_size"] is None
    values = payload["result"]
    assert values["slope"] == pytest.approx(2.5, abs=1e-12)
    assert values["intercept"] == pytest.approx(-3, abs=1e-12)
    assert values["r_squared"] == pytest.approx(1, abs=1e-12)
    assert values["rmse"] == pytest.approx(0, abs=1e-12)
    assert values["equation"] == "ŷ = 2.5 × X -3"
    assert values["observations_used"] == payload["sample_size"] == 60
    assert values["observations_excluded"] == 0
    chart = values["chart"]
    assert chart["kind"] == "scatter" and chart["x"] == "x" and chart["y"] == "y"
    assert chart["sampled"] and len(chart["points"]) == 5 and chart["total_points"] == 60
    assert chart["trend"] == {"slope": values["slope"], "intercept": values["intercept"]}
    diagnostic = values["residual_diagnostics"]
    assert diagnostic["kind"] == "residuals"
    assert diagnostic["x"] == "x" and diagnostic["y"] == "y"
    assert diagnostic["sampled"] is True and diagnostic["total_points"] == 60
    assert len(diagnostic["points"]) == len(chart["points"]) == 5
    for (x, y), (estimate, error) in zip(chart["points"], diagnostic["points"], strict=True):
        assert estimate == values["slope"] * x + values["intercept"]
        assert error == y - estimate
        assert error == pytest.approx(0, abs=1e-12)
    assert "category" not in values and "constant" not in values
    assert execute(client, dataset_id).json()["result"] == values
    pd.testing.assert_frame_equal(before_frame, stored.dataset.table.frame)
    assert stored.profile.model_dump() == before_profile
    assert stored.dataset.schema.model_dump() == before_schema
    assert client.get(f"/datasets/{dataset_id}/preview").json() == before_preview


def test_http_joint_missing_pair_counts(regression_client):
    dataset_id = upload(regression_client, missing=True)
    response = execute(regression_client, dataset_id)
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "SUCCESS"
    assert payload["sample_size"] == payload["result"]["observations_used"] == 57
    assert payload["result"]["observations_excluded"] == 3
    assert payload["result"]["slope"] == pytest.approx(2.5)
    assert payload["result"]["rmse"] == pytest.approx(0, abs=1e-12)


def test_http_preserves_the_independent_and_dependent_variable_order(regression_client):
    dataset_id = upload(regression_client)
    response = execute(regression_client, dataset_id, {"variables": ["y", "x"]})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "SUCCESS" and payload["variables"] == ["y", "x"]
    assert payload["result"]["slope"] == pytest.approx(0.4)
    assert payload["result"]["intercept"] == pytest.approx(1.2)
    assert payload["result"]["x"] == payload["result"]["chart"]["x"] == "y"
    assert payload["result"]["y"] == payload["result"]["chart"]["y"] == "x"


@pytest.mark.parametrize("variables", [["constant", "y"], ["x", "constant"], ["x", "category"]])
def test_http_non_applicable_columns_return_skipped(regression_client, variables):
    dataset_id = upload(regression_client)
    response = execute(regression_client, dataset_id, {"variables": variables})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "SKIPPED"
    assert payload["result"] is None and payload["sample_size"] is None
    assert payload["warnings"]


def test_http_insufficient_sample_is_skipped(regression_client):
    dataset_id = upload(regression_client, rows=19)
    response = execute(regression_client, dataset_id)
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "SKIPPED" and payload["result"] is None
    assert "at least 20" in payload["warnings"][0]


@pytest.mark.parametrize(
    "body",
    [
        {"variables": []},
        {"variables": ["x"]},
        {"variables": ["x", "y", "constant"]},
        {"variables": ["x", "x"]},
        {"variables": ["unknown", "y"]},
        {"variables": ["x", "y"], "parameters": {"unknown": 1}},
    ],
)
def test_http_invalid_tool_requests_return_failed(regression_client, body):
    dataset_id = upload(regression_client)
    response = execute(regression_client, dataset_id, body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "FAILED" and payload["result"] is None
    assert payload["p_value"] is None and payload["effect_size"] is None
    assert payload["warnings"]


def test_http_missing_dataset_and_invalid_body_keep_existing_status_codes(regression_client):
    response = execute(regression_client, "not-registered")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "DATASET_NOT_FOUND"
    dataset_id = upload(regression_client)
    response = execute(regression_client, dataset_id, {"variables": ["x", "y"], "extra": 1})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "name,variables",
    [
        ("pearson", ["x", "y"]),
        ("chart_scatter", ["x", "y"]),
        ("descriptive_statistics", ["x"]),
    ],
)
def test_existing_tools_return_identical_results_before_and_after_regression(
    regression_client, name, variables
):
    dataset_id = upload(regression_client)
    path = f"/datasets/{dataset_id}/tools/{name}"
    before = regression_client.post(path, json={"variables": variables})
    assert execute(regression_client, dataset_id).json()["status"] == "SUCCESS"
    after = regression_client.post(path, json={"variables": variables})
    assert before.status_code == after.status_code == 200
    for key in ("status", "variables", "result", "sample_size", "warnings"):
        assert before.json()[key] == after.json()[key]
