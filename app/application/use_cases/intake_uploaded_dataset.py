from pydantic import ValidationError

from app.application.dto.analysis_input import AnalysisInput
from app.application.dto.intake import DatasetCompleteness, IntakeOptions, IntakeResponse
from app.application.errors import DataSourceError, UploadValidationError
from app.domain.models.data_dictionary import DataDictionary
from app.ports.data_understanding import DataUnderstanding
from app.ports.upload_storage import UploadedContent, UploadStorage


class IntakeUploadedDataset:
    """Adapt uploaded content to the existing understanding service."""

    def __init__(
        self,
        understanding: DataUnderstanding,
        storage: UploadStorage,
        dataset_limit: int,
        dictionary_limit: int,
    ) -> None:
        self.understanding = understanding
        self.storage = storage
        self.dataset_limit = dataset_limit
        self.dictionary_limit = dictionary_limit

    async def execute(
        self,
        file: UploadedContent,
        options: IntakeOptions,
        dictionary_file: UploadedContent | None = None,
    ) -> IntakeResponse:
        filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
        suffix = "." + filename.rsplit(".", 1)[-1].lower()
        if suffix not in {".csv", ".tsv", ".txt", ".json", ".jsonl"}:
            raise UploadValidationError(
                "Choose a CSV, TSV, delimited TXT, tabular JSON or JSONL dataset"
            )
        dictionary: DataDictionary | None = None
        if dictionary_file is not None:
            content = await self.storage.read(dictionary_file, self.dictionary_limit)
            try:
                dictionary = DataDictionary.model_validate_json(content)
            except ValidationError as error:
                details = "; ".join(
                    f"{'.'.join(map(str, item['loc'])) or 'dictionary'}: {item['msg']}"
                    for item in error.errors()
                )
                raise UploadValidationError(f"Invalid data dictionary: {details}") from error
        async with self.storage.stage(file, suffix, self.dataset_limit) as path:
            source = {"kind": suffix[1:], "path": path, "encoding": options.encoding}
            if suffix in {".csv", ".txt"}:
                source["delimiter"] = options.delimiter
            try:
                result = await self.understanding.understand(
                    AnalysisInput(source=source, data_dictionary=dictionary)
                )
            except DataSourceError as error:
                raise DataSourceError(str(error).replace(str(path), filename)) from error
            rows = result.profile.row_count
            total = rows * result.profile.column_count
            missing = sum(column.missing_count or 0 for column in result.profile.columns)
            return IntakeResponse(
                filename=filename,
                profile=result.profile,
                summary=result.summary(),
                completeness=DatasetCompleteness(
                    missing_cells=missing,
                    total_cells=total,
                    missing_percentage=100 * missing / total if total else 0,
                    column_missing_percentages={
                        column.column_name: 100 * (column.missing_count or 0) / rows if rows else 0
                        for column in result.profile.columns
                    },
                ),
                warnings=result.warnings,
                profiling_time=result.profiling_time,
            )
