from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlparse

from pydantic import Field, model_validator
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    TomlConfigSettingsSource,
)

from app.shared.domain.models.base import DomainModel
from app.shared.domain.models.dataset import ProfilingOptions


class AnalysisSettings(DomainModel):
    mode: Literal["fast", "standard"]
    max_hypotheses: int = Field(ge=1)
    max_tool_calls: int = Field(ge=0)
    max_critic_cycles: int = Field(ge=0)
    minimum_sample_size: int = Field(ge=2)


class PerformanceSettings(DomainModel):
    timeout_seconds: float = Field(gt=0)
    parallel_tools: bool


class LLMSettings(DomainModel):
    provider: str
    model: str | None = None
    temperature: float = Field(ge=0, le=2)
    max_retries: int = Field(ge=0)


class EvaluationSettings(DomainModel):
    repetitions: int = Field(ge=1)


class PersistenceSettings(DomainModel):
    database_url: str = Field(min_length=1)
    postgres_sslmode: Literal["require", "verify-ca", "verify-full", "disable"] = "require"

    def effective_postgres_sslmode(self) -> str:
        """Resolve the configured mode without allowing the URL to silently override it."""
        values = parse_qs(urlparse(self.database_url).query, keep_blank_values=True).get("sslmode")
        if not values:
            return self.postgres_sslmode
        if len(values) != 1:
            raise ValueError("persistence.database_url must not define sslmode more than once")
        if values[0] != self.postgres_sslmode:
            raise ValueError("persistence.database_url sslmode must match postgres_sslmode")
        return values[0]


class UploadSettings(DomainModel):
    max_dataset_bytes: int = Field(
        ge=0, description="Dataset upload limit in bytes; 0 is unlimited"
    )
    max_dictionary_bytes: int = Field(gt=0)
    chunk_size_bytes: int = Field(gt=0)
    temporary_directory: Path | None = None


class DeploymentSettings(DomainModel):
    """HTTP-facing safeguards; production is opt-in and validated explicitly."""

    environment: Literal["development", "production"] = "development"
    cors_allowed_origins: list[str] = Field(default_factory=list)
    allow_local_analysis: bool = True
    rate_limit_window_seconds: int = Field(default=60, gt=0)
    max_upload_requests: int = Field(default=20, gt=0)
    max_exploration_requests: int = Field(default=60, gt=0)
    max_report_requests: int = Field(default=120, gt=0)
    max_concurrent_operations: int = Field(default=2, gt=0)
    max_tracked_clients: int = Field(default=1000, gt=0)


class EdaSettings(DomainModel):
    """Policy for exploratory profiling, association screening and chart data."""

    significance_level: float = Field(gt=0, lt=1)
    top_relationships: int = Field(ge=1)
    max_pairs: int = Field(ge=1)
    max_categories: int = Field(ge=2)
    max_cached_datasets: int = Field(ge=1)
    top_categories: int = Field(ge=1)
    max_histogram_bins: int = Field(ge=1)
    outlier_iqr_multiplier: float = Field(gt=0)
    outlier_mad_threshold: float = Field(gt=0)
    max_outlier_examples: int = Field(ge=0)
    normality_alpha: float = Field(gt=0, lt=1)
    mutual_information_neighbors: int = Field(ge=1)
    mutual_information_max_rows: int = Field(ge=2)
    max_scatter_points: int = Field(ge=2)
    max_box_outliers: int = Field(ge=0)
    max_summary_groups: int = Field(ge=1)
    kmeans_max_rows: int = Field(ge=2)
    kmeans_max_plot_points: int = Field(ge=6)
    kmeans_silhouette_max_rows: int = Field(ge=2)
    kmeans_n_init: int = Field(ge=1)
    kmeans_max_iter: int = Field(ge=1)
    random_seed: int = Field(ge=0)


class Settings(BaseSettings):
    """Defaults < external TOML < dotenv < environment < constructor."""

    model_config = SettingsConfigDict(
        env_prefix="MDA_",
        env_nested_delimiter="__",
        env_file=".env",
        extra="forbid",
        toml_file=Path(__file__).with_name("defaults.toml"),
    )
    analysis: AnalysisSettings
    performance: PerformanceSettings
    llm: LLMSettings
    evaluation: EvaluationSettings
    persistence: PersistenceSettings
    data_intake: ProfilingOptions
    uploads: UploadSettings
    eda: EdaSettings
    deployment: DeploymentSettings = Field(default_factory=DeploymentSettings)

    @model_validator(mode="after")
    def validate_deployment_safety(self) -> "Settings":
        deployment = self.deployment
        invalid_origins = [
            origin
            for origin in deployment.cors_allowed_origins
            if not _is_explicit_origin(origin, production=deployment.environment == "production")
        ]
        if invalid_origins:
            raise ValueError(
                "CORS origins must be explicit http(s) origins without wildcards or paths"
            )
        if deployment.environment != "production":
            return self

        problems: list[str] = []
        if not deployment.cors_allowed_origins:
            problems.append("deployment.cors_allowed_origins must not be empty")
        if deployment.allow_local_analysis:
            problems.append("deployment.allow_local_analysis must be false")
        if not 0 < self.uploads.max_dataset_bytes <= 2_097_152:
            problems.append("uploads.max_dataset_bytes must be between 1 and 2097152 in production")
        if self.uploads.max_dictionary_bytes > 262_144:
            problems.append("uploads.max_dictionary_bytes must not exceed 262144 in production")
        if not self.persistence.database_url.startswith("postgresql+psycopg://"):
            problems.append("persistence.database_url must use postgresql+psycopg:// in production")
        try:
            effective_sslmode = self.persistence.effective_postgres_sslmode()
        except ValueError as error:
            problems.append(str(error))
        else:
            if effective_sslmode not in {"require", "verify-ca", "verify-full"}:
                problems.append("persistence effective sslmode must require TLS in production")
        if problems:
            raise ValueError("Unsafe production configuration: " + "; ".join(problems))
        return self

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            TomlConfigSettingsSource(settings_cls),
            TomlConfigSettingsSource(
                settings_cls, toml_file=Path(__file__).with_name("defaults.toml")
            ),
        )


def load_settings(config_path: Path | None = None) -> Settings:
    """Load an optional external file without losing packaged defaults."""
    if config_path is None:
        return Settings()

    class ExternalSettings(Settings):
        model_config = SettingsConfigDict(toml_file=config_path)

    if not config_path.is_file():
        raise FileNotFoundError(f"Configuration file not found: {config_path}")
    return ExternalSettings()


def _is_explicit_origin(origin: str, *, production: bool) -> bool:
    parsed = urlparse(origin)
    if "*" in origin or parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    if parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment:
        return False
    if parsed.username or parsed.password:
        return False
    return not production or parsed.scheme == "https"
