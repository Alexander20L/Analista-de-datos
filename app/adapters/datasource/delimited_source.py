import csv
import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pandas as pd

from app.application.dto.datasource import LoadedDataset
from app.application.errors import DataSourceError
from app.domain.models.dataset import ColumnSchema, DatasetSchema

NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z")
LEADING_ZERO = re.compile(r"[+-]?0\d")


@dataclass(frozen=True)
class PandasLocalTable:
    """Keep pandas and raw values confined to the local data adapter."""

    frame: pd.DataFrame

    def column(self, name: str) -> list[object]:
        return [None if pd.isna(value) else value for value in self.frame[name].tolist()]


def _typed_column(values: list[str | None]) -> pd.Series:
    observed = [value.strip() for value in values if value is not None]
    column = pd.Series(values, dtype="string")
    if not observed:
        return column
    if all(value.lower() in {"true", "false"} for value in observed):
        return column.str.strip().str.lower().map({"true": True, "false": False}).astype("boolean")
    if all(NUMBER.fullmatch(value) and not LEADING_ZERO.match(value) for value in observed):
        try:
            numeric = pd.to_numeric(column.str.strip(), errors="raise").convert_dtypes()
            if all(
                Decimal(original.strip()) == Decimal(str(converted))
                for original, converted in zip(values, numeric.tolist(), strict=True)
                if original is not None
            ):
                return numeric
            return column
        except (ValueError, OverflowError):
            # Out-of-range values remain lossless strings, not silently truncated numbers.
            return column
    return column


def read_delimited(path: Path, delimiter: str, encoding: str) -> LoadedDataset:
    """Validate the original header and row widths before any pandas normalization."""
    try:
        with path.open("r", encoding=encoding, newline="") as stream:
            reader = csv.reader(stream, delimiter=delimiter, strict=True)
            raw_header = next(reader, None)
            if not raw_header:
                raise DataSourceError("Source is empty or has no header")
            header = [name.strip() for name in raw_header]
            header[0] = header[0].removeprefix("\ufeff")
            if any(not name for name in header):
                raise DataSourceError("Column names cannot be empty")
            if len(set(header)) != len(header):
                raise DataSourceError("Column names must be unique")
            columns: list[list[str | None]] = [[] for _ in header]
            for row in reader:
                if not row:
                    continue
                if len(row) != len(header):
                    raise DataSourceError(
                        f"Invalid row at line {reader.line_num}: "
                        f"expected {len(header)} fields, received {len(row)}"
                    )
                for column, value in zip(columns, row, strict=True):
                    column.append(value if value.strip() else None)
    except (OSError, UnicodeError, LookupError, csv.Error, ValueError) as error:
        raise DataSourceError(f"Unable to read delimited source: {path} ({error})") from error
    if not columns[0]:
        raise DataSourceError(f"Source contains no data rows: {path}")
    if not any(value is not None for column in columns for value in column):
        raise DataSourceError("Source contains only missing values")
    return build_loaded_dataset(header, columns)


def build_loaded_dataset(header: list[str], columns: list[list[str | None]]) -> LoadedDataset:
    """Use one lossless type inference policy for every tabular format."""
    frame = pd.DataFrame(
        {name: _typed_column(values) for name, values in zip(header, columns, strict=True)}
    )
    schema = DatasetSchema(
        columns=[
            ColumnSchema(
                name=name, data_type=str(frame[name].dtype), nullable=bool(frame[name].isna().any())
            )
            for name in header
        ]
    )
    return LoadedDataset(
        dataset_id=str(uuid4()), schema=schema, row_count=len(frame), table=PandasLocalTable(frame)
    )
