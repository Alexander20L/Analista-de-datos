"""Strict tabular JSON, normalized through the same inference as CSV/TSV."""

import asyncio
import json
from decimal import Decimal

from app.adapters.datasource.delimited_source import build_loaded_dataset
from app.application.dto.analysis_input import JsonSourceSpec, SourceSpec
from app.application.dto.datasource import LoadedDataset
from app.application.errors import DataSourceError


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _constant(value):
    raise ValueError(f"Non-finite JSON number: {value}")


def _decode(text):
    return json.loads(
        text, parse_float=Decimal, object_pairs_hook=_object, parse_constant=_constant
    )


def _read(source: JsonSourceSpec) -> LoadedDataset:
    try:
        text = source.path.read_text(encoding=source.encoding).removeprefix("\ufeff")
        if source.kind == "jsonl":
            records = [_decode(line) for line in text.splitlines() if line.strip()]
        else:
            records = _decode(text)
            if isinstance(records, dict):
                if "run_id" in records or "dataset_profile" in records or "profile" in records:
                    raise ValueError(
                        "This JSON is a report/profile, not a dataset. "
                        "Use run_id to retrieve a report, or upload tabular records."
                    )
                if len(records) != 1 or not ({"records", "data"} & records.keys()):
                    raise ValueError("Use an array of records or {records: [...]} / {data: [...]}")
                records = next(iter(records.values()))
        if not isinstance(records, list) or not records:
            raise ValueError("JSON dataset must contain a non-empty array of records")
        header, normalized = [], []
        for index, record in enumerate(records, 1):
            if not isinstance(record, dict) or not record:
                raise ValueError(f"Record {index} must be a non-empty object")
            row = {}
            for name, value in record.items():
                column = name.strip().removeprefix("\ufeff")
                if not column or column in row:
                    raise ValueError(f"Empty or duplicate column in record {index}")
                if isinstance(value, (dict, list)):
                    raise ValueError(
                        f"Record {index}, column '{column}': nested values "
                        "are not tabular; flatten them explicitly"
                    )
                if value is None:
                    cell = None
                elif isinstance(value, bool):
                    cell = "true" if value else "false"
                elif isinstance(value, (str, int, Decimal)):
                    cell = str(value)
                    cell = cell if cell.strip() else None
                else:
                    raise ValueError(f"Unsupported value in record {index}, column '{column}'")
                row[column] = cell
                if column not in header:
                    header.append(column)
            normalized.append(row)
        columns = [[row.get(name) for row in normalized] for name in header]
        if not any(value is not None for column in columns for value in column):
            raise ValueError("Source contains only missing values")
        return build_loaded_dataset(header, columns)
    except (OSError, UnicodeError, LookupError, ValueError, RecursionError) as error:
        raise DataSourceError(f"Unable to read tabular JSON: {error}") from error


class JsonDataSource:
    async def read(self, source: SourceSpec) -> LoadedDataset:
        if not isinstance(source, JsonSourceSpec):
            raise DataSourceError("JsonDataSource supports only JSON/JSONL sources")
        return await asyncio.to_thread(_read, source)
