import csv
import io
import json

import pytest

from app.application.dto.analysis_input import AnalysisInput
from app.bootstrap import build_datasource


def uploads():
    rows = [
        {
            "id": f"{i:03}",
            "date": f"{i % 20 + 1:02}/01/2026",
            "district": "A" if i % 2 else "B",
            "tax": round(500 + i * 10.13, 2),
            "interest": round((i % 5) * 2.11 + (i % 2) * 0.37, 2),
            "total": round(500 + i * 10.13 + (i % 5) * 2.11, 2),
        }
        for i in range(60)
    ]
    for kind, delimiter in [("csv", ","), ("tsv", "\t"), ("txt", "|")]:
        stream = io.StringIO()
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), delimiter=delimiter)
        writer.writeheader()
        writer.writerows(rows)
        yield kind, stream.getvalue(), {"delimiter": delimiter}
    yield "json", json.dumps(rows), {}
    yield "json", json.dumps({"records": rows}), {}
    yield "json", json.dumps({"data": rows}), {}
    yield "jsonl", "\n".join(json.dumps(dict(reversed(list(r.items())))) for r in rows), {}


def measurements(report):
    return [
        {
            key: r[key]
            for key in (
                "method",
                "variables",
                "status",
                "result",
                "sample_size",
                "effect_size",
                "p_value",
                "warnings",
            )
        }
        for r in report["analysis_results"]
    ]


def test_all_five_contracts_are_equivalent_across_formats(client):
    baseline = None
    for kind, content, options in uploads():
        files = {"file": (f"dataset.{kind}", content.encode())}
        intake = client.post("/intake", files=files, data=options)
        assert intake.status_code == 200, intake.text
        profile = intake.json()["profile"]
        columns = {c["column_name"]: c for c in profile["columns"]}
        assert columns["id"]["semantic_type"] == "identifier"
        assert columns["date"]["semantic_type"] == "temporal"
        eda = client.post(
            f"/datasets/{profile['dataset_id']}/tools/correlation_matrix",
            json={"variables": ["tax", "interest", "total"]},
        )
        assert eda.status_code == 200 and eda.json()["status"] == "SUCCESS"
        response = client.post("/analysis/upload", files=files, data=options)
        assert response.status_code == 200, response.text
        report = response.json()
        assert set(report["stage_statuses"].values()) == {"SUCCESS"}, (
            kind,
            report["errors"],
            report["warnings"],
        )
        results = {r["analysis_id"] for r in report["analysis_results"] if r["status"] == "SUCCESS"}
        evidence = {e["evidence_id"]: e for e in report["evidence"]}
        assert all(e["analysis_id"] in results for e in evidence.values())
        assert all(set(i["evidence_ids"]) <= evidence.keys() for i in report["insights"])
        assert client.get("/reports/" + report["run_id"]).json() == report
        actual = {
            "columns": columns,
            "eda": eda.json()["result"],
            "measured": measurements(report),
            "assessments": [
                {k: a[k] for k in ("variables", "potentially_spurious", "rationale", "limitations")}
                for a in report["relationship_assessments"]
            ],
            "insights": [
                {k: i[k] for k in ("statement", "limitations")} for i in report["insights"]
            ],
        }
        if baseline is None:
            baseline = actual
        else:
            assert actual == baseline, kind


@pytest.mark.parametrize(
    "content",
    [
        "[]",
        "{}",
        "[1,2]",
        "[{}]",
        '[{"a":1,"a":2}]',
        '[{"a":1," a ":2}]',
        '[{"a":{"nested":1}}]',
        '[{"a":[1,2]}]',
        '[{"a":NaN}]',
        '[{"a":Infinity}]',
        '[{"a":null}]',
        '{"run_id":"saved","insights":[]}',
        '{"records":[],"extra":1}',
    ],
)
def test_invalid_or_report_json_is_rejected_at_intake(client, content):
    response = client.post("/intake", files={"file": ("bad.json", content.encode())})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "INTAKE_VALIDATION_FAILED"


async def test_json_preserves_codes_missing_literals_booleans_and_numeric_precision(tmp_path):
    path = tmp_path / "types.json"
    path.write_text(
        '[{"id":"001","value":9007199254740993,"flag":true,"label":"NA"},'
        '{"id":"002","value":1.5,"flag":false}]',
        encoding="utf8",
    )
    dataset = await build_datasource().read(
        AnalysisInput(source={"kind": "json", "path": path}).source
    )
    assert dataset.table.column("id") == ["001", "002"]
    assert dataset.table.column("value") == ["9007199254740993", "1.5"]
    assert dataset.table.column("flag") == [True, False]
    assert dataset.table.column("label") == ["NA", None]
