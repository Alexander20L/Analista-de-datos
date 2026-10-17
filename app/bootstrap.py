from collections.abc import Callable

from app.adapters.datasource.csv_source import CsvDataSource
from app.adapters.datasource.dataset_store import InMemoryDatasetStore
from app.adapters.datasource.json_source import JsonDataSource
from app.adapters.datasource.router import DataSourceRouter
from app.adapters.datasource.text_source import TextDataSource
from app.adapters.datasource.tsv_source import TsvDataSource
from app.adapters.datasource.upload_storage import TemporaryUploadStorage
from app.adapters.llm.disabled import DisabledLLMProvider
from app.adapters.visualization.charts import (
    BoxPlotTool,
    CorrelationHeatmapTool,
    HistogramTool,
    ScatterTool,
)
from app.agents.analyst import AnalysisAgent
from app.agents.critic import CriticAgent
from app.agents.data_understanding import DataUnderstandingAgent
from app.agents.insight import InsightAgent
from app.agents.planner import PlannerAgent
from app.analytics.association.matrix import CorrelationMatrixTool
from app.analytics.association.ranking import RelationshipRankingTool
from app.analytics.association.tools import (
    AnovaTool,
    ChiSquareTool,
    CramersVTool,
    KruskalWallisTool,
    MutualInformationTool,
    PearsonTool,
    SpearmanTool,
)
from app.analytics.base import DatasetTool
from app.analytics.factory import build_statistical_tool_registry
from app.analytics.profiling.tools import (
    CardinalityTool,
    DescriptiveStatisticsTool,
    DistributionTool,
    MissingValuesTool,
    OutliersTool,
)
from app.analytics.registry import ToolRegistry
from app.analytics.statistics.mixed import AnovaGroupProfiler
from app.application.errors import LLMDisabledError
from app.application.services.data_understanding import DataUnderstandingService
from app.application.services.dataset_registry import DatasetRegistry
from app.application.services.registering_understanding import RegisteringDataUnderstanding
from app.application.use_cases.analyze_dataset import AnalyzeDataset
from app.application.use_cases.explore_dataset import ExploreDataset
from app.application.use_cases.intake_uploaded_dataset import IntakeUploadedDataset
from app.config.settings import Settings
from app.orchestration.graph import LangGraphWorkflow
from app.ports.agent import Agent
from app.ports.data_understanding import DataUnderstanding
from app.ports.dataset_provider import DatasetProvider, DatasetStore
from app.ports.datasource import DataSource
from app.ports.llm_provider import LLMProvider


def build_llm(settings: Settings) -> LLMProvider:
    if settings.llm.provider != "disabled":
        raise LLMDisabledError("Only the disabled provider adapter exists in this skeleton")
    return DisabledLLMProvider()


def build_datasource() -> DataSource:
    return DataSourceRouter(
        {
            "csv": CsvDataSource(),
            "tsv": TsvDataSource(),
            "txt": TextDataSource(),
            "json": JsonDataSource(),
            "jsonl": JsonDataSource(),
        }
    )


def build_data_understanding(settings: Settings) -> DataUnderstanding:
    return DataUnderstandingService(build_datasource(), settings.data_intake)


EDA_TOOLS: tuple[type[DatasetTool], ...] = (
    DescriptiveStatisticsTool,
    MissingValuesTool,
    DistributionTool,
    CardinalityTool,
    OutliersTool,
    PearsonTool,
    SpearmanTool,
    ChiSquareTool,
    CramersVTool,
    AnovaTool,
    KruskalWallisTool,
    MutualInformationTool,
    CorrelationMatrixTool,
    RelationshipRankingTool,
    CorrelationHeatmapTool,
    ScatterTool,
    HistogramTool,
    BoxPlotTool,
)


def build_dataset_store(settings: Settings) -> DatasetStore:
    return InMemoryDatasetStore(settings.eda.max_cached_datasets)


def build_tool_registry(settings: Settings, datasets: DatasetProvider) -> ToolRegistry:
    registry = ToolRegistry()
    for tool in EDA_TOOLS:
        registry.register(tool(datasets, settings.eda, settings.analysis.minimum_sample_size))
    return registry


def build_intake_use_case(
    settings: Settings, datasets: DatasetStore | None = None
) -> IntakeUploadedDataset:
    """With a store, intake datasets stay resolvable for exploration tools."""
    understanding = build_data_understanding(settings)
    if datasets is not None:
        understanding = RegisteringDataUnderstanding(understanding, datasets)
    return IntakeUploadedDataset(
        understanding,
        TemporaryUploadStorage(
            settings.uploads.chunk_size_bytes, settings.uploads.temporary_directory
        ),
        settings.uploads.max_dataset_bytes,
        settings.uploads.max_dictionary_bytes,
    )


def build_agents(
    llm: LLMProvider,
    tools: ToolRegistry,
    understanding: DataUnderstanding,
    datasets: DatasetRegistry | None = None,
) -> list[Agent]:
    return [
        DataUnderstandingAgent(understanding, datasets),
        PlannerAgent(
            llm,
            summarize_anova=AnovaGroupProfiler(datasets).summarize
            if datasets is not None
            else None,
        ),
        AnalysisAgent(llm, tools),
        CriticAgent(llm),
        InsightAgent(llm),
    ]


def build_exploration_use_case(settings: Settings, datasets: DatasetProvider) -> ExploreDataset:
    return ExploreDataset(datasets, build_tool_registry(settings, datasets))


def build_use_case(settings: Settings) -> AnalyzeDataset:
    build_llm(settings)

    def build_run() -> tuple[list[Agent], Callable[[], None]]:
        datasets = DatasetRegistry()
        return (
            build_agents(
                build_llm(settings),
                build_statistical_tool_registry(datasets),
                build_data_understanding(settings),
                datasets,
            ),
            datasets.clear,
        )

    return AnalyzeDataset(LangGraphWorkflow(settings, run_factory=build_run))


def build_repository(settings: Settings):
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from app.adapters.persistence.report_repository import SqlAlchemyAnalysisRepository

    url = settings.persistence.database_url
    options = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {}
    if url in {"sqlite://", "sqlite:///:memory:"}:
        options["poolclass"] = StaticPool
    repository = SqlAlchemyAnalysisRepository(create_engine(url, **options))
    repository.initialize()
    return repository
