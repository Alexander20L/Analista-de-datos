from pydantic import ValidationError

from app.application.dto.analysis_input import AnalysisInput
from app.application.dto.intake import IntakeOptions
from app.application.errors import DataSourceError, UploadValidationError
from app.application.use_cases.analyze_dataset import AnalyzeDataset
from app.domain.models.data_dictionary import DataDictionary
from app.domain.models.report import AnalysisReport
from app.ports.upload_storage import UploadedContent, UploadStorage


class AnalyzeUploadedDataset:
    """Keep staged tabular uploads alive for the whole workflow; never expose its local path."""

    def __init__(
        self,
        analysis: AnalyzeDataset,
        storage: UploadStorage,
        dataset_limit: int,
        dictionary_limit: int,
    ) -> None:
        self.analysis = analysis
        self.storage = storage
        self.dataset_limit = dataset_limit
        self.dictionary_limit = dictionary_limit

    async def execute(
        self,
        file: UploadedContent,
        options: IntakeOptions,
        dictionary_file: UploadedContent | None = None,
        user_question: str | None = None,
    ) -> AnalysisReport:
        filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
        suffix = "." + filename.rsplit(".", 1)[-1].lower()
        if suffix not in {".csv", ".tsv", ".txt", ".json", ".jsonl"}:
            raise UploadValidationError(
                "Choose a CSV, TSV, delimited TXT, tabular JSON or JSONL dataset"
            )
        dictionary = None
        if dictionary_file is not None:
            content = await self.storage.read(dictionary_file, self.dictionary_limit)
            try:
                dictionary = DataDictionary.model_validate_json(content)
            except ValidationError as error:
                raise UploadValidationError("Invalid data dictionary JSON") from error
        async with self.storage.stage(file, suffix, self.dataset_limit) as path:
            source = {"kind": suffix[1:], "path": path, "encoding": options.encoding}
            if suffix in {".csv", ".txt"}:
                source["delimiter"] = options.delimiter
            try:
                report = await self.analysis.workflow.run(
                    AnalysisInput(
                        source=source,
                        data_dictionary=dictionary,
                        user_question=user_question,
                    )
                )
            except DataSourceError as error:
                raise DataSourceError(str(error).replace(str(path), filename)) from error

            # Only the returned metadata is persisted, never a staged path that will disappear.
            def sanitize(value):
                if isinstance(value, str):
                    return value.replace(str(path), filename)
                if isinstance(value, list):
                    return [sanitize(item) for item in value]
                if isinstance(value, dict):
                    return {key: sanitize(item) for key, item in value.items()}
                return value

            report = AnalysisReport.model_validate(sanitize(report.model_dump(mode="json")))
            if self.analysis.repository is not None:
                await self.analysis.repository.save(report)
            return report
