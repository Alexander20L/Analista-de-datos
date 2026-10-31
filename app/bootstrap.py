from collections.abc import Callable

from app.modules.analysis.adapters.analytics.correlation import PartialCorrelationTool
from app.modules.analysis.adapters.analytics.factory import build_statistical_tool_registry
from app.modules.analysis.adapters.analytics.mixed import AnovaGroupProfiler
from app.modules.analysis.adapters.orchestration.graph import LangGraphWorkflow
from app.modules.analysis.application.agents.analyst import AnalysisAgent
from app.modules.analysis.application.agents.association import AssociationAgent
from app.modules.analysis.application.agents.planner import PlannerAgent
from app.modules.analysis.application.use_cases.analyze_dataset import AnalyzeDataset
from app.modules.analysis.ports.agent import Agent
from app.modules.critical_review.adapters.partial_correlation_intake import (
    PartialCorrelationIntakeAdapter,
)
from app.modules.critical_review.application.agents.critic import CriticAgent
from app.modules.data_intake.adapters.datasource.csv_source import CsvDataSource
from app.modules.data_intake.adapters.datasource.dataset_preview import PandasDatasetPreviewReader
from app.modules.data_intake.adapters.datasource.dataset_quality import PandasDatasetQualityReader
from app.modules.data_intake.adapters.datasource.dataset_store import InMemoryDatasetStore
from app.modules.data_intake.adapters.datasource.router import DataSourceRouter
from app.modules.data_intake.adapters.datasource.tsv_source import TsvDataSource
from app.modules.data_intake.adapters.datasource.upload_storage import TemporaryUploadStorage
from app.modules.data_intake.application.agents.data_understanding import DataUnderstandingAgent
from app.modules.data_intake.application.services.data_understanding import DataUnderstandingService
from app.modules.data_intake.application.services.registering_understanding import (
    RegisteringDataUnderstanding,
)
from app.modules.data_intake.application.services.stored_understanding import (
    StoredDataUnderstanding,
)
from app.modules.data_intake.application.use_cases.evaluate_dataset_quality import (
    EvaluateDatasetQuality,
)
from app.modules.data_intake.application.use_cases.intake_uploaded_dataset import (
    IntakeUploadedDataset,
)
from app.modules.data_intake.application.use_cases.preview_dataset import PreviewDataset
from app.modules.data_intake.ports.data_understanding import DataUnderstanding
from app.modules.data_intake.ports.dataset_provider import DatasetProvider, DatasetStore
from app.modules.data_intake.ports.datasource import DataSource
from app.modules.exploration.adapters.analytics.association.linear_regression import (
    LinearRegressionTool,
)
from app.modules.exploration.adapters.analytics.association.matrix import CorrelationMatrixTool
from app.modules.exploration.adapters.analytics.association.ranking import RelationshipRankingTool
from app.modules.exploration.adapters.analytics.association.tools import (
    AnovaTool,
    ChiSquareTool,
    CramersVTool,
    KruskalWallisTool,
    MutualInformationTool,
    PearsonTool,
    SpearmanTool,
)
from app.modules.exploration.adapters.analytics.base import DatasetTool
from app.modules.exploration.adapters.analytics.clustering.kmeans import KMeansClusteringTool
from app.modules.exploration.adapters.analytics.profiling.tools import (
    CardinalityTool,
    DescriptiveStatisticsTool,
    DistributionTool,
    GroupedSummaryTool,
    MissingValuesTool,
    OutliersTool,
)
from app.modules.exploration.adapters.relationship_screening import RelationshipScreeningAdapter
from app.modules.exploration.adapters.visualization.charts import (
    BoxPlotTool,
    ContingencyTool,
    CorrelationHeatmapTool,
    HistogramTool,
    ScatterTool,
)
from app.modules.exploration.adapters.workflow_kruskal import WorkflowKruskalTool
from app.modules.exploration.application.use_cases.explore_dataset import ExploreDataset
from app.modules.reporting.application.agents.insight import InsightAgent
from app.shared.adapters.llm.disabled import DisabledLLMProvider
from app.shared.adapters.observability.telemetry import (
    InstrumentedAnalyticsTool,
    InstrumentedLLMProvider,
)
from app.shared.application.dataset_registry import DatasetRegistry
from app.shared.application.errors import LLMDisabledError
from app.shared.application.tool_registry import ToolRegistry
from app.shared.config.settings import EdaSettings, Settings
from app.shared.ports.llm_provider import LLMProvider


def build_llm(settings: Settings) -> LLMProvider:
    if settings.llm.provider != "disabled":
        raise LLMDisabledError("Only the disabled provider adapter exists in this skeleton")
    return InstrumentedLLMProvider(DisabledLLMProvider())


def build_datasource() -> DataSource:
    return DataSourceRouter({"csv": CsvDataSource(), "tsv": TsvDataSource()})


def build_data_understanding(settings: Settings) -> DataUnderstanding:
    return DataUnderstandingService(build_datasource(), settings.data_intake)


EDA_TOOLS: tuple[type[DatasetTool], ...] = (
    DescriptiveStatisticsTool,
    MissingValuesTool,
    DistributionTool,
    CardinalityTool,
    OutliersTool,
    GroupedSummaryTool,
    KMeansClusteringTool,
    PearsonTool,
    SpearmanTool,
    LinearRegressionTool,
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
    ContingencyTool,
)


def build_dataset_store(settings: Settings) -> DatasetStore:
    return InMemoryDatasetStore(settings.eda.max_cached_datasets)


def build_preview_use_case(datasets: DatasetProvider) -> PreviewDataset:
    return PreviewDataset(datasets, PandasDatasetPreviewReader())


def build_quality_use_case(datasets: DatasetProvider) -> EvaluateDatasetQuality:
    return EvaluateDatasetQuality(datasets, PandasDatasetQualityReader())


def build_tool_registry(settings: Settings, datasets: DatasetProvider) -> ToolRegistry:
    registry = ToolRegistry()
    for tool in EDA_TOOLS:
        registry.register(tool(datasets, settings.eda, settings.analysis.minimum_sample_size))
    registry.register(PartialCorrelationIntakeAdapter(datasets, PartialCorrelationTool))
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
    eda: EdaSettings | None = None,
) -> list[Agent]:
    """Association screening needs local data, so it runs only with a dataset registry."""
    screening: list[Agent] = (
        [AssociationAgent(RelationshipScreeningAdapter(datasets, eda))]
        if datasets is not None and eda is not None
        else []
    )
    return [
        DataUnderstandingAgent(understanding, datasets),
        *screening,
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


def build_use_case(settings: Settings, stored: DatasetProvider | None = None) -> AnalyzeDataset:
    """With a provider, analyses can reuse datasets already understood by intake."""
    build_llm(settings)

    def build_run() -> tuple[list[Agent], Callable[[], None]]:
        datasets = DatasetRegistry()
        tools = build_statistical_tool_registry(datasets)
        tools.register(WorkflowKruskalTool(datasets))
        instrumented = ToolRegistry()
        for name in tools.names():
            instrumented.register(InstrumentedAnalyticsTool(tools.get(name)))
        understanding = build_data_understanding(settings)
        if stored is not None:
            understanding = StoredDataUnderstanding(understanding, stored)
        return (
            build_agents(
                build_llm(settings),
                instrumented,
                understanding,
                datasets,
                settings.eda,
            ),
            datasets.clear,
        )

    return AnalyzeDataset(LangGraphWorkflow(settings, run_factory=build_run))


def build_repository(settings: Settings):
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from app.modules.reporting.adapters.persistence.report_repository import (
        SqlAlchemyAnalysisRepository,
    )

    url = settings.persistence.database_url
    options = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {}
    if url in {"sqlite://", "sqlite:///:memory:"}:
        options["poolclass"] = StaticPool
    if url.startswith("postgresql+psycopg://"):
        options.update(
            connect_args={"sslmode": settings.persistence.effective_postgres_sslmode()},
            pool_pre_ping=True,
            pool_size=1,
            max_overflow=0,
            pool_recycle=300,
        )
    repository = SqlAlchemyAnalysisRepository(create_engine(url, **options))
    repository.initialize()
    return repository
