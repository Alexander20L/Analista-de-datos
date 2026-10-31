import numpy as np
from fastapi.testclient import TestClient

from app.shared.domain.models.analysis import AnalysisResult


def upload_clusters(client: TestClient) -> str:
    rng = np.random.default_rng(19)
    lines = ["x,y"]
    for center_x, center_y in ((-8.0, 100.0), (8.0, 900.0)):
        for _ in range(30):
            lines.append(f"{rng.normal(center_x, 0.2):.5f},{rng.normal(center_y, 3):.5f}")
    response = client.post(
        "/intake", files={"file": ("clusters.csv", "\n".join(lines).encode(), "text/csv")}
    )
    assert response.status_code == 200
    return response.json()["profile"]["dataset_id"]


def test_kmeans_is_catalogued_and_runs_against_an_intake_dataset(client: TestClient) -> None:
    assert "kmeans_clustering" in client.get("/tools").json()["tools"]
    dataset_id = upload_clusters(client)

    response = client.post(
        f"/datasets/{dataset_id}/tools/kmeans_clustering",
        json={"variables": ["x", "y"], "parameters": {"n_clusters": 2}},
    )

    assert response.status_code == 200
    result = AnalysisResult.model_validate(response.json())
    assert result.status == "SUCCESS"
    assert result.method == "kmeans_clustering" and result.variables == ["x", "y"]
    assert result.sample_size == 60
    assert isinstance(result.result, dict)
    assert result.result["observations_used"] == 60
    assert result.result["observations_excluded"] == 0
    assert sorted(cluster["count"] for cluster in result.result["clusters"]) == [30, 30]
    assert result.result["inertia"] >= 0
    assert result.result["silhouette"] is not None
    assert len(result.result["points"]) <= 200
    assert result.result["total_points"] == 60


def test_kmeans_reports_invalid_input_and_missing_datasets_through_existing_contracts(
    client: TestClient,
) -> None:
    dataset_id = upload_clusters(client)
    invalid_clusters = client.post(
        f"/datasets/{dataset_id}/tools/kmeans_clustering",
        json={"variables": ["x", "y"], "parameters": {"n_clusters": 7}},
    )
    assert invalid_clusters.status_code == 200
    assert invalid_clusters.json()["status"] == "FAILED"
    assert "between 2 and 6" in invalid_clusters.json()["warnings"][0]

    unknown_parameter = client.post(
        f"/datasets/{dataset_id}/tools/kmeans_clustering",
        json={"variables": ["x", "y"], "parameters": {"n_clusters": 2, "extra": 1}},
    )
    assert unknown_parameter.status_code == 200
    assert unknown_parameter.json()["status"] == "FAILED"

    malformed_body = client.post(
        f"/datasets/{dataset_id}/tools/kmeans_clustering", json={"unexpected": True}
    )
    assert malformed_body.status_code == 422

    missing = client.post(
        "/datasets/expired/tools/kmeans_clustering",
        json={"variables": ["x", "y"], "parameters": {"n_clusters": 2}},
    )
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "DATASET_NOT_FOUND"
