import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app
from app.config.settings import Settings


def test_csv_upload_with_dictionary(client: TestClient) -> None:
    dictionary = {"entries": [{"column_name": "amount", "source": "official", "unit": "PEN"}]}
    response = client.post(
        "/intake",
        files={
            "file": ("sales.csv", b"id,amount\n001,10\n002,\n", "text/csv"),
            "data_dictionary": ("dictionary.json", json.dumps(dictionary), "application/json"),
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["summary"]["rows"] == 2
    assert result["summary"]["identifiers"] == ["id"]
    assert result["completeness"]["missing_percentage"] == 25
    assert result["completeness"]["column_missing_percentages"]["amount"] == 50
    entry = result["summary"]["data_dictionary"]["entries"][1]
    assert entry["source"] == "official"
    assert entry["unit"] == "PEN"
    assert result["profiling_time"] >= 0
    assert "table" not in result
    assert response.headers["X-Request-ID"]


@pytest.mark.parametrize(
    "filename, content, options",
    [
        ("sales.tsv", b"id\tvalue\n001\t2\n", {}),
        (
            "sales.csv",
            "id;label\n001;café\n".encode("cp1252"),
            {"delimiter": ";", "encoding": "cp1252"},
        ),
    ],
)
def test_tsv_and_csv_options(
    client: TestClient, filename: str, content: bytes, options: dict[str, str]
) -> None:
    response = client.post("/intake", files={"file": (filename, content)}, data=options)
    assert response.status_code == 200
    assert response.json()["summary"]["columns"] == 2


@pytest.mark.parametrize(
    "files, expected",
    [
        ({"file": ("sales.xlsx", b"id\n1\n")}, "CSV, TSV"),
        ({"file": ("sales.csv", b"a,b\n1\n")}, "Invalid row"),
        ({"file": ("sales.csv", b"")}, "empty"),
        (
            {"file": ("sales.csv", b"id\n1\n"), "data_dictionary": ("d.json", b"bad")},
            "Invalid data dictionary",
        ),
    ],
)
def test_invalid_uploads(
    client: TestClient, files: dict[str, tuple[str, bytes]], expected: str
) -> None:
    response = client.post("/intake", files=files)
    assert response.status_code == 400
    assert expected in response.json()["detail"]["message"]


def test_upload_limits_and_cleanup(tmp_path: Path) -> None:
    settings = Settings(
        uploads={
            "temporary_directory": tmp_path,
            "max_dataset_bytes": 12,
            "max_dictionary_bytes": 8,
            "chunk_size_bytes": 4,
        },
        _env_file=None,
    )
    with TestClient(create_app(settings)) as client:
        for content, status in ((b"a\n1\n", 200), (b"a,b\n1\n", 400), (b"a\n" + b"1\n" * 20, 413)):
            response = client.post("/intake", files={"file": ("data.csv", content)})
            assert response.status_code == status
            assert list(tmp_path.iterdir()) == []
        response = client.post(
            "/intake",
            files={
                "file": ("data.csv", b"a\n1\n"),
                "data_dictionary": ("d.json", b"x" * 9),
            },
        )
        assert response.status_code == 413
        assert list(tmp_path.iterdir()) == []


def test_required_file_and_invalid_delimiter(client: TestClient) -> None:
    assert client.post("/intake").status_code == 422
    response = client.post(
        "/intake", files={"file": ("a.csv", b"a\n1\n")}, data={"delimiter": "::"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize("filename, separator", [("data.csv", ","), ("data.tsv", "\t")])
def test_unlimited_dataset_upload_and_cleanup(
    tmp_path: Path, filename: str, separator: str
) -> None:
    settings = Settings(
        uploads={"max_dataset_bytes": 0, "temporary_directory": tmp_path, "chunk_size_bytes": 4},
        _env_file=None,
    )
    content = f"id{separator}value\n001{separator}10\n002{separator}20\n".encode()
    with TestClient(create_app(settings)) as client:
        response = client.post("/intake", files={"file": (filename, content)})
        assert response.status_code == 200
        assert response.json()["summary"]["rows"] == 2
        assert list(tmp_path.iterdir()) == []
        invalid = client.post("/intake", files={"file": (filename, b"")})
        assert invalid.status_code == 400
        assert list(tmp_path.iterdir()) == []
