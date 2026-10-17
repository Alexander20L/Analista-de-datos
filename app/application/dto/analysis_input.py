from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    ConfigDict,
    Field,
    JsonValue,
    SerializerFunctionWrapHandler,
    model_serializer,
    model_validator,
)

from app.config.settings import AnalysisSettings, PerformanceSettings, Settings
from app.domain.models.base import DomainModel
from app.domain.models.data_dictionary import DataDictionary
from app.domain.models.dataset import DatasetSchema


class CsvSourceSpec(DomainModel):
    kind: Literal["csv"] = "csv"
    path: Path
    delimiter: str = Field(default=",", min_length=1, max_length=1)
    encoding: str = "utf-8"


class TsvSourceSpec(DomainModel):
    kind: Literal["tsv"] = "tsv"
    path: Path
    encoding: str = "utf-8"


class JsonSourceSpec(DomainModel):
    kind: Literal["json", "jsonl"] = "json"
    path: Path
    encoding: str = "utf-8"


class TextSourceSpec(DomainModel):
    kind: Literal["txt"] = "txt"
    path: Path
    delimiter: str = Field(min_length=1, max_length=1)
    encoding: str = "utf-8"


class SqlSourceSpec(DomainModel):
    kind: Literal["sql"] = "sql"
    connection_ref: str = Field(min_length=1)
    table: str = Field(min_length=1)


SourceSpec = Annotated[
    CsvSourceSpec | TsvSourceSpec | JsonSourceSpec | TextSourceSpec | SqlSourceSpec,
    Field(discriminator="kind"),
]


class PartialOverrides(DomainModel):
    """Serialize absent options as absent, preserving round-trip validation."""

    @model_serializer(mode="wrap")
    def serialize_present(self, handler: SerializerFunctionWrapHandler) -> dict[str, JsonValue]:
        return {key: value for key, value in handler(self).items() if value is not None}


class AnalysisOverrides(PartialOverrides):
    mode: Literal["fast", "standard"] | None = None
    max_hypotheses: int | None = Field(default=None, ge=1)
    max_tool_calls: int | None = Field(default=None, ge=0)
    max_critic_cycles: int | None = Field(default=None, ge=0)
    minimum_sample_size: int | None = Field(default=None, ge=2)


class PerformanceOverrides(PartialOverrides):
    timeout_seconds: float | None = Field(default=None, gt=0)
    parallel_tools: bool | None = None


class AnalysisConfiguration(DomainModel):
    analysis: AnalysisOverrides = Field(default_factory=AnalysisOverrides)
    performance: PerformanceOverrides = Field(default_factory=PerformanceOverrides)

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "AnalysisConfiguration":
        for section in (self.analysis, self.performance):
            if any(getattr(section, field) is None for field in section.model_fields_set):
                raise ValueError("Overrides must contain concrete values, not null")
        return self


class EffectiveConfiguration(DomainModel):
    analysis: AnalysisSettings
    performance: PerformanceSettings


class AnalysisInput(DomainModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    source: SourceSpec
    dataset_schema: DatasetSchema | None = Field(default=None, alias="schema")
    data_dictionary: DataDictionary | None = None
    user_question: str | None = None
    configuration: AnalysisConfiguration = Field(default_factory=AnalysisConfiguration)


def resolve_configuration(
    settings: Settings, overrides: AnalysisConfiguration
) -> EffectiveConfiguration:
    """Resolve only allowlisted run-level overrides."""
    return EffectiveConfiguration(
        analysis=AnalysisSettings.model_validate(
            settings.analysis.model_dump() | overrides.analysis.model_dump(exclude_unset=True)
        ),
        performance=PerformanceSettings.model_validate(
            settings.performance.model_dump() | overrides.performance.model_dump(exclude_unset=True)
        ),
    )
