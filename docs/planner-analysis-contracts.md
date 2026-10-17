> Contrato transversal vigente: [formatos y consistencia de los cinco módulos](format-consistency-contract.md). Las notas de entrega inicial se conservan como contexto histórico.

# Contratos de Planner y Analysis

## 1. Objetivo del módulo

El módulo Planner & Analysis debe convertir una pregunta de análisis y el resumen
del dataset en un plan reproducible de solicitudes estadísticas, ejecutar esas
solicitudes sobre los datos locales y entregar resultados trazables al flujo común.

Actualmente `PlannerAgent` construye planes determinísticos y `AnalysisAgent` los
ejecuta en el workflow de LangGraph mediante recursos locales aislados por corrida.
No hay proveedor LLM activo; Critic e Insight continúan siendo etapas separadas y
no se consideran una conclusión final de negocio.

## 2. Responsabilidades de Planner Agent

### Existente

- `PlannerAgent` está en `app/agents/planner.py`, conserva el puerto LLM para
  compatibilidad futura y no lo invoca mientras el proveedor siga deshabilitado.
- `DeterministicAnalysisPlanner`, en
  `app/application/services/analysis_planning.py`, construye planes reproducibles
  sólo a partir de `AgentContext`, perfil, diccionario y configuración efectiva.
- Genera hipótesis exploratorias sin conclusiones causales y devuelve
  `AnalysisPlan` mediante `AgentUpdate.analysis_plan` cuando tiene pasos válidos.
- Prioriza columnas mencionadas en la pregunta; los empates se resuelven por tipo
  y nombre de columna para mantener orden estable.
- En FAST MODE limita la exploración a una hipótesis por familia compatible
  (numérica, categórica o ANOVA), además de respetar `max_hypotheses` y
  `max_tool_calls`.
- Antes de formar pares, el Planner usa un pool acotado por tipo: cuatro columnas
  en FAST MODE y entre cuatro y doce en otros modos, según `max_hypotheses`.
  Las coincidencias exactas de la pregunta se colocan antes del orden alfabético;
  así una variable mencionada al final del nombre no queda desplazada por el
  recorte. Esta política evita materializar combinaciones cuadráticas de perfiles
  amplios.

Reglas implementadas: dos numéricas proponen `pearson` y `spearman`; dos
categóricas proponen `chi_square` y `cramers_v`; una categórica seguida de una
numérica propone `anova_one_way`. `partial_correlation` se añade sólo si la
pregunta nombra exactamente una única variable numérica de control después de un
indicador de control/ajuste. No se aceptan subcadenas dentro de otras palabras ni
referencias ambiguas. El plan nunca ejecuta una tool ni accede a filas.

El Planner devuelve `SKIPPED` con advertencia si faltan metadatos, no hay variables
compatibles, el presupuesto de tools es cero o el perfil tiene menos filas que
`minimum_sample_size`. Un identificador inconsistente entre contexto y perfil se
trata como fallo real de planificación.

### Propuesto para una implementación posterior

- Incorporar un proveedor LLM inyectado para enriquecer propuestas, manteniendo el
  plan determinístico como fallback y sin enviar filas completas.
- Coordinar la selección de análisis adicionales con Critic y la ejecución real
  con Analysis Agent.

## 3. Responsabilidades de Analysis Agent

### Existente

- `AnalysisAgent` está en `app/agents/analyst.py`.
- Recibe un `ToolRegistry` explícito además del proveedor LLM.
- Ejecuta un `AnalysisPlan` sólo cuando supera validaciones de IDs de paso únicos,
  hipótesis y dependencias válidas, grafo acíclico, dataset coherente y límite de
  hipótesis. Ordena los pasos topológicamente de forma estable.
- Ejecuta secuencialmente sólo tools autorizadas mediante `ToolRegistry.resolve()`.
  Conserva éxitos si otro paso falla; dependencias fallidas o presupuesto agotado
  producen `SKIPPED`, mientras que tools desconocidas, incompatibles o erróneas
  producen `FAILED` sin estadísticas ficticias.
- Añade `step_id` y, cuando existe, `hypothesis_id` a los metadatos de cada
  resultado. Mide `analytics_time` y cuenta exclusivamente invocaciones reales en
  `tool_calls`. No llama al proveedor LLM.
- El registry permite registrar instancias, consultar nombres, resolver una
  solicitud compatible y ejecutar solo tools autorizadas; rechaza nombres vacíos,
  registros duplicados, tools desconocidas y solicitudes no compatibles.
- `AnalyticsTool` define `name`, `supports(request)` y `execute(request)`.
- `build_statistical_tool_registry(datasets)`, en `app/analytics/factory.py`, crea
  un registry nuevo e inyecta el mismo `DatasetRegistry` en las seis tools:
  `pearson`, `spearman`, `partial_correlation`, `chi_square`, `cramers_v` y
  `anova_one_way`. No hay registry global ni datasets compartidos entre ejecuciones.

### Propuesto para una implementación posterior

- Ejecutar tools en paralelo cuando la configuración y la semántica de dependencias
  lo permitan, y definir la coordinación de cancelación y timeouts CPU-bound.

## 4. Contratos existentes y ubicación real

- `Hypothesis`, `ToolRequest`, `AnalysisStep`, `AnalysisPlan`, `AnalysisResult` y
  `AssociationResult`: `app/domain/models/analysis.py`.
- `AgentContext`, `AgentUpdate` y `AgentResult`: `app/application/dto/agent.py`.
- `AgentState`: `app/orchestration/state.py`.
- `AnalyticsTool`: `app/ports/analytics_tool.py`.
- `ToolRegistry`: `app/analytics/registry.py`.
- Puerto común de agentes: `app/ports/agent.py`.
- Configuración efectiva y overrides por ejecución:
  `app/config/settings.py` y `app/application/dto/analysis_input.py`.
- Grafo y adaptación de contexto/updates: `app/orchestration/graph.py`.

`AnalysisResult` solo permite valores estadísticos calculados cuando el estado es
`SUCCESS`; incluye método, variables, tamaño de muestra, warnings, duración y
metadatos. Los estados se definen en `app/domain/enums/statuses.py`.

## 5. Flujo de información entre módulos

El flujo actual es:

```text
DataUnderstanding → Planner → Analysis → Critic → Insight
```

`AgentState` contiene el estado serializable del workflow. Para cada nodo,
`app/orchestration/graph.py` construye un `AgentContext` explícito y aplica solo
los campos presentes en `AgentUpdate`. El contexto no contiene `LocalTable`, una
sesión de persistencia ni filas crudas.

El intake local usa `LoadedDataset` y `LocalTable` en
`app/application/dto/datasource.py`; `PandasLocalTable` vive en
`app/adapters/datasource/delimited_source.py`. `DatasetRegistry`, en
`app/application/services/dataset_registry.py`, mantiene por instancia las
referencias de datasets ya validados. Registra IDs únicos, verifica que cada
columna declarada esté disponible con el número de filas esperado y permite
recuperar, liberar o limpiar referencias. No es serializable ni global, por lo
que cada ejecución puede usar una instancia aislada y liberar sus datos al final.

`build_use_case(settings)` configura una fábrica de recursos por llamada a
`LangGraphWorkflow.run()`. Cada corrida crea un `DatasetRegistry`, un `ToolRegistry`
con las seis tools y una lista nueva de agentes. `DataUnderstandingAgent` registra
exactamente el `LoadedDataset` que `DataUnderstandingService` ya cargó y validó; no
vuelve a abrir ni perfilar el archivo. Sólo dataset_id, perfil y diccionario cruzan
`AgentState`. El workflow libera referencias con `DatasetRegistry.clear()` en un
`finally`, incluso ante fallo, timeout o cancelación.

La misma instancia de `AnalyzeDataset` puede usarse en corridas secuenciales o
concurrentes: no comparte datasets, tools o resultados entre ellas. Las cargas HTTP
se procesan mediante `AnalyzeUploadedDataset`, que libera los archivos temporales
al terminar y conserva el reporte mediante el repositorio configurado.

Los `analysis_results` quedan en `AgentState` y son visibles para Critic mediante
el siguiente `AgentContext`. Critic usa Pearson/Spearman exitosos si no existe una
asociación equivalente y obtiene su coeficiente de `effect_size`. La correlación
parcial admite `metadata.control_variable` como texto cuando falta
`metadata.control_variables`, conservando la validación del formato plural.
Critic entrega `Evidence` y `RelationshipAssessment` a Insight; el ciclo de
solicitudes adicionales aún no está implementado.

## 6. Herramientas estadísticas para el MVP

Las tools determinísticas de correlación están en
`app/analytics/statistics/correlation.py` y reciben un `DatasetRegistry` por
inyección. Sus métodos autorizados son:

- `pearson`: dos variables numéricas distintas en `ToolRequest.variables`.
- `spearman`: dos variables numéricas distintas en `ToolRequest.variables`; SciPy
  calcula rangos y maneja empates.
- `partial_correlation`: dos variables numéricas distintas en `variables` y una
  variable de control numérica en
  `parameters={"control_variable": "nombre_columna"}`.

Cada tool obtiene únicamente las columnas requeridas desde el dataset local por
`dataset_id`. Trabaja con observaciones completas, registra tamaño muestral,
coeficiente, valor p y tiempo de ejecución. La correlación parcial calcula
residuos lineales frente a una única variable de control e informa esa variable y
los grados de libertad en metadatos.

Las tools rechazan datasets o columnas desconocidos, valores no numéricos o
infinitos, muestras insuficientes, columnas constantes, controles sin variación y
resultados no finitos. En esos casos devuelven `AnalysisResult` con `FAILED`, sin
estadísticos calculados. Los resultados exitosos incluyen una advertencia explícita:
asociación estadística no demuestra causalidad.

Las tools estadísticas mixtas están en `app/analytics/statistics/mixed.py` y usan
la misma inyección local de `DatasetRegistry`. Sus métodos autorizados son:

- `chi_square`: dos variables categóricas distintas en `variables`. Construye una
  tabla de contingencia y devuelve estadístico Chi-cuadrado, valor p, grados de
  libertad, dimensiones y tamaño muestral. Usa `chi2_contingency` sin corrección
  de continuidad; advierte si hay frecuencias esperadas menores de cinco.
- `cramers_v`: dos variables categóricas distintas en `variables`. Reutiliza la
  misma tabla y Chi-cuadrado sin corrección de continuidad, y devuelve V de Cramér
  estándar (sin corrección por sesgo), valor p y dimensiones de la tabla.
- `anova_one_way`: `variables[0]` es la categoría de grupo y `variables[1]` el
  resultado numérico. Devuelve F, valor p, eta cuadrado, número de grupos y grados
  de libertad entre y dentro de grupos.

Las categorías admitidas son texto no vacío o códigos enteros; no se discretizan
variables continuas automáticamente. Las tres tools excluyen observaciones con
valores faltantes. También rechazan etiquetas ambiguas, tablas/categorías
insuficientes, valores numéricos no finitos, muestras insuficientes y resultados
degenerados. ANOVA exige al menos dos observaciones por grupo válido, no realiza
post-hoc y advierte que sus supuestos no se evalúan automáticamente.

`ToolRegistry.execute(request)` resuelve la tool por el método de `ToolRequest` y
exige que `supports(request)` sea verdadero antes de delegar la ejecución. El
workflow crea y registra las tools por ejecución; no hay registry global.

El motor EDA conserva sus herramientas de profiling, asociación y gráficos,
independientes de las seis herramientas del flujo Planner/Analysis.

## 7. Límites de ejecución y FAST MODE

Los límites ya modelados son `max_hypotheses`, `max_tool_calls`,
`max_critic_cycles`, `minimum_sample_size`, `timeout_seconds` y
`parallel_tools`. Los defaults empaquetados están en
`app/config/defaults.toml`; el modo por defecto es `fast`.

Planner consume `minimum_sample_size`, `max_hypotheses`, `max_tool_calls` y `mode`
para construir un plan acotado; no incrementa métricas porque no ejecuta tools.
Analysis valida de nuevo el límite de hipótesis y aplica `max_tool_calls`: los pasos
posteriores se marcan `SKIPPED` al agotarse el presupuesto. Conserva
`ExperimentMetrics.analytics_time`; solicitudes rechazadas y pasos omitidos no
incrementan `tool_calls`.

El ejecutor no añade un timeout local: las tools son cálculos CPU-bound y un timeout
de `asyncio` no garantiza interrumpirlos mientras bloquean el hilo. Tampoco ejecuta
tools en paralelo: `parallel_tools` no está operativo aún. El timeout global del
workflow sí protege etapas cooperativas y el `finally` libera los recursos, pero no
promete interrupción fuerte de SciPy/Pandas CPU-bound.

El reporte conserva las métricas que actualiza Analysis: `tool_calls` es el número
de tools invocadas realmente, `analytics_time` mide la fase analítica,
`profiling_time` procede de Data Understanding y `total_response_time` mide toda la
corrida. `llm_calls` permanece en cero. El reporte es `FAILED` ante un fallo de
workflow o etapa, `SUCCESS` cuando todas las etapas registradas finalizaron con
éxito, y `SKIPPED` cuando quedan etapas pendientes. Analysis puede estar en
`SUCCESS` mientras Critic e Insight permanecen en `SKIPPED`; ambos estados se
comprueban por separado.

## 8. Dependencias con los demás integrantes

- **Integrante 1:** `DataSource`, `DatasetProfile`, `DatasetSchema`,
  `DataDictionary` y acceso local al dataset. Planner necesita sus metadatos; Analysis
  necesita una referencia local, no filas enviadas al LLM.
- **Integrante 2:** profiling, asociaciones y primeras tools estadísticas. Se
  requiere acordar nombres de tools, variables, parámetros y semántica de resultados.
- **Integrante 4:** `CriticAgent`, evidencia, evaluación de relaciones y solicitudes
  adicionales. El `AgentContext` ya tiene `analysis_results`, `evidence` y
  `relationship_assessments`, pero falta definir el contrato operativo del loop.
- **Integrante 5:** métricas, evidencia/reporting y API. Debe consumirse el
  `AnalysisResult` común y conservarse trazabilidad de duración, warnings y errores.

Los contratos compartidos permiten conexión básica sin cambios incompatibles.
Cualquier cambio de dominio, DTO o puerto requiere coordinación y revisión cruzada.

## 9. Componentes existentes reutilizables

- `SkeletonAgent` y el puerto `Agent` para el ciclo `AgentContext` → `AgentResult`.
- `ToolRegistry` para registro explícito de implementaciones.
- `AnalyticsTool` y `AnalysisResult` como frontera determinística.
- `AgentState`, `_agent_node` y `build_graph` para integración LangGraph.
- `EffectiveConfiguration` para overrides allowlisted por ejecución.
- `DataSourceRouter`, lectores CSV/TSV, `LocalTable` y `DatasetRegistry` para
  cálculo local aislado.
- `PearsonCorrelationTool`, `SpearmanCorrelationTool` y
  `PartialCorrelationTool` para asociación numérica determinística con SciPy.
- `ChiSquareIndependenceTool`, `CramersVTool` y `OneWayAnovaTool` para
  asociaciones categóricas y comparación unifactorial de medias con SciPy.
- Logging de etapas y `TimingRecorder` para trazabilidad y tiempos.

## 10. Coexistencia con EDA y reportes

`InMemoryDatasetStore`, `RegisteredDataset`, `build_tool_registry`,
`build_exploration_use_case` y `build_intake_use_case` conservan la exploración EDA.
El almacén EDA es independiente del `DatasetRegistry` creado por análisis; limpiar
una corrida no elimina datasets que continúan disponibles para exploración.

La API integra `/analysis`, `/analysis/upload` y consulta/descargas de reportes por
`run_id`, junto con intake y exploración. El frontend conserva `/associations` y
`/report`. SQLite en memoria sigue siendo el valor predeterminado; para recuperar
reportes tras reiniciar se configura
`MDA_PERSISTENCE__DATABASE_URL=sqlite:///./analysis_reports.db`.

El PR #7 fue cerrado porque sus cambios ya están en develop. La integración final
combina main y develop conservando recursos por corrida, evidencia, telemetría y
persistencia. Los detalles de validación local están en
[Integración final](integracion-main-final.md).

ANOVA se filtra antes de asignar presupuesto mediante conteos locales de casos
completos por pareja. Se requieren dos grupos con dos observaciones cada uno; ver
[validación de grupos](anova-group-validation.md).

Pendientes: CSV con comillas mal escapadas se rechaza estrictamente; umbrales de
Critic provisionales; proveedor LLM productivo, paralelismo y ciclo Critic → Planner
aún no implementados.


## Revisión con evidencia calculada

Consulta [Critic e Insight con evidencia calculada](critic-evidence-pipeline.md) para el catálogo ampliado, planificación automática, clasificación indeterminada y condiciones de omisión.
