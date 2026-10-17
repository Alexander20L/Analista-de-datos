import asyncio

from app.adapters.datasource.delimited_source import read_delimited
from app.application.dto.analysis_input import SourceSpec, TextSourceSpec
from app.application.dto.datasource import LoadedDataset
from app.application.errors import DataSourceError


class TextDataSource:
    async def read(self, source: SourceSpec) -> LoadedDataset:
        if not isinstance(source, TextSourceSpec):
            raise DataSourceError("TextDataSource supports only delimited TXT sources")
        return await asyncio.to_thread(
            read_delimited, source.path, source.delimiter, source.encoding
        )
