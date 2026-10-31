# EDA & Association Engine

Motor exploratorio y de descubrimiento inicial de relaciones. Responde a:
"encontré estas relaciones; ahora investiguemos cuáles realmente tienen sentido".
Las relaciones son **candidatas estadísticas**: el Critic decide si son espurias.

## Acceso a datos: `DatasetProvider`

Las tools reciben un `ToolRequest` con `dataset_id`, no filas. El puerto
`DatasetProvider` (`app/modules/data_intake/ports/dataset_provider.py`) resuelve ese id a un
`RegisteredDataset`: datos locales (`LoadedDataset`) más su `DatasetProfile`, que
aporta el tipo semántico de cada columna.

- `DatasetStore` extiende el puerto con `register` y `discard`.
- `InMemoryDatasetStore` es un LRU acotado por `eda.max_cached_datasets`.
- `RegisteringDataUnderstanding` decora el puerto `DataUnderstanding`: tras el
  intake publica el dataset en el store. `build_use_case` lo conecta; el agente
  y el servicio de intake no cambian.
- La API comparte un store entre `/intake` y la exploración: el archivo temporal se
  borra, pero el dataset ya cargado queda en memoria y se resuelve por
  `profile.dataset_id`. Reiniciar el backend o superar `max_cached_datasets` lo
  descarta; el cliente recibe 404 `DATASET_NOT_FOUND` y pide volver a subirlo.

## Tools

Todas implementan `AnalyticsTool`, heredan de `DatasetTool` y se registran en
`build_tool_registry`. El cálculo corre en un hilo (`asyncio.to_thread`).

| Tool | Variables | Resultado |
|---|---|---|
| `descriptive_statistics` | 0+ (num/cat) | media, std, cuartiles, IQR, CV, asimetría, curtosis; moda y frecuencias |
| `missing_values` | 0+ | nulos por columna, celdas y filas completas |
| `distribution` | 0+ (num/cat) | histograma, forma, normalidad (D'Agostino n≥20, Shapiro n<20); frecuencias |
| `cardinality` | 0+ | únicos, ratio y flags `constant`, `binary`, `high_cardinality`, `near_unique` |
| `outliers` | 0+ (num) | vallas IQR de Tukey y z robusto con MAD |
| `grouped_summary` | num + cat | por categoría existente: filas, nulos, n, media, mediana, std, cuartiles, IQR, mín/máx y `small_sample`; grupos ordenados por tamaño y limitados por `parameters.max_groups` (≤ `eda.max_summary_groups`), con `omitted` (grupos/filas omitidos), `missing_group` (filas sin categoría) y `overall` |
| `pearson`, `spearman` | 2 num | r/ρ, p-value, IC 95 % (Pearson) |
| `chi_square`, `cramers_v` | 2 cat | χ², gl, p-value, V de Cramér; aviso si >20 % de frecuencias esperadas < 5 |
| `anova`, `kruskal_wallis` | num + cat | F/H, p-value, η²/ε², supuestos (Shapiro por grupo, Levene) |
| `mutual_information` | 2 num/cat | MI en nats (kNN, semilla fija); sin p-value |
| `correlation_matrix` | 0 o 2+ num | matriz, p-values y n por par; `parameters.method`: `pearson`/`spearman` |
| `relationship_ranking` | 0 o 2+ num/cat | `top_relationships` (ver abajo) |

Sin variables, las tools por columna usan todas las columnas compatibles.
Identificadores, texto y temporales se excluyen de la asociación.

### Estados

- `SUCCESS`: resultado calculado.
- `SKIPPED`: petición válida pero no aplicable (tipo semántico incorrecto, columna
  constante, menos de `analysis.minimum_sample_size` observaciones completas).
- `FAILED`: petición inválida (columna desconocida, número de variables, método no
  soportado, dataset no registrado).

## Ranking de relaciones

`relationship_ranking` evalúa cada par de columnas elegibles:

| Par | Prueba principal | Apoyo |
|---|---|---|
| num – num | el mejor de Pearson y Spearman | MI |
| cat – cat | V de Cramér (p-value de χ²) | MI |
| num – cat | ANOVA si los grupos son normales con varianzas iguales; si no, Kruskal-Wallis | MI |

El `score` está en [0, 1] y es comparable entre métodos: |r|, |ρ|, V, η = √η²,
√ε². Los p-values de todas las pruebas se corrigen con Benjamini-Hochberg y solo
se devuelven pares con `adjusted_p_value <= significance_level`, ordenados por
`score`. Parámetros opcionales: `top_k`, `significance_level`.

```json
{
  "top_relationships": [
    {
      "x": "MONTO_DEVENGADO", "y": "MONTO_GIRADO", "method": "pearson",
      "score": 0.91, "strength": 0.91, "p_value": 0.0, "adjusted_p_value": 0.0,
      "sample_size": 299,
      "supporting": [{"method": "spearman", "variables": ["MONTO_DEVENGADO", "MONTO_GIRADO"], "strength": 0.9, "p_value": 0.0}],
      "warnings": []
    }
  ],
  "evaluated_pairs": 21, "significant_pairs": 4, "skipped_pairs": [],
  "excluded_columns": {"constante": "constant or empty column"},
  "significance_level": 0.05, "correction": "benjamini-hochberg"
}
```

Avisos por relación para el Critic: Pearson y Spearman discrepan más de 0.2
(outliers o no linealidad) o MI supera claramente a la prueba principal.

Limitación: MI no tiene p-value, por lo que una dependencia no monótona sin
correlación significativa (p. ej. `y = x²`) no entra al ranking; solo se usa la
MI como evidencia de apoyo.

## Gráficos: Python calcula, el frontend dibuja

`app/modules/exploration/adapters/visualization/charts.py` devuelve especificaciones tipadas en
`AnalysisResult.result` con campo `kind`. Nunca incluyen el dataset completo.

| Tool | `kind` | Contenido |
|---|---|---|
| `chart_correlation_heatmap` | `heatmap` | columnas, matriz, p-values, n |
| `chart_scatter` | `scatter` | puntos (muestra aleatoria reproducible de `max_scatter_points`), recta de tendencia |
| `chart_histogram` | `histogram` | `edges` (n+1) y `counts` (n) |
| `chart_boxplot` | `boxplot` | por grupo opcional: bigotes, cuartiles, mediana, outliers acotados |
| `chart_contingency` | `contingency` | 2 cat: conteos, totales, frecuencias esperadas por celda y contadores de diagnóstico (ver AUD-021) |

### AUD-021 — Tabla de contingencia

`chart_contingency` reutiliza `contingency_table` y las frecuencias esperadas de
`chi2_contingency` (sin corrección de Yates, como `chi_square` y `cramers_v`) y
el límite `eda.max_categories`. Filas = primera variable, columnas = segunda,
ordenadas por total descendente. Si un eje supera `eda.top_categories`, sus
categorías menos frecuentes se agrupan en la última posición (`folded_rows` /
`folded_columns` indican cuántas); `cells`, `expected_below_5`,
`expected_below_1`, `min_expected` y `empty_cells` se calculan siempre sobre la
tabla completa. `excluded_rows` cuenta las filas sin valor en alguna de las dos
columnas. No calcula p-values: la prueba sigue siendo `chi_square`/`cramers_v`.

## Configuración

Sección `[eda]` de `app/shared/config/defaults.toml`, sobreescribible con
`MDA_EDA__<CLAVE>`: nivel de significancia, `top_relationships`, límites de pares,
categorías, bins, puntos y outliers, umbrales IQR/MAD, `normality_alpha`, vecinos
de MI y `random_seed`.

## API

| Ruta | Descripción |
|---|---|
| `GET /tools` | nombres de las tools registradas |
| `POST /datasets/{dataset_id}/tools/{tool_name}` | cuerpo opcional `{"variables": [...], "parameters": {...}}`; devuelve `AnalysisResult` |

SKIPPED y FAILED de una tool se devuelven con 200: son resultados de análisis.
404 `DATASET_NOT_FOUND` si el dataset ya no está en memoria y `TOOL_NOT_FOUND` si
la tool no existe; 422 para cuerpos inválidos.

## Interfaz: Associations

`frontend/src/features/associations/` muestra el ranking, el detalle del par
seleccionado (scatter para num–num, boxplot para num–cat), la matriz de correlación
(clic en una celda para inspeccionar el par) y la distribución de una columna
numérica (histograma, boxplot opcionalmente agrupado y outliers). Los gráficos son
SVG propios en `frontend/src/components/charts/`, sin dependencias nuevas.

`AnalysisResult.result` es JSON libre en OpenAPI, por lo que las formas de ranking y
gráficos se replican a mano en `frontend/src/types/exploration.ts`; actualizar ambos
lados juntos.

### Sprint 2 — Regresión lineal simple

Asociaciones incorpora un panel independiente de **Regresión lineal** después de
la distribución de columna. Seleccionar X independiente e Y dependiente no
ejecuta solicitudes: el usuario pulsa **Ejecutar regresión**, con dos columnas
numéricas distintas. El panel reutiliza `runTool` y la cola HTTP. El scatter del
ranking se conserva; el panel del modelo muestra un diagnóstico de residuos.

La solicitud usa el endpoint existente:

```text
POST /datasets/{dataset_id}/tools/linear_regression
{"variables": ["columna_x", "columna_y"], "parameters": {}}
```

`LinearRegressionTool` hereda de `DatasetTool` y se registra únicamente en
`EDA_TOOLS`, fuera del workflow automático. Python ajusta mínimos cuadrados con
intercepto sobre todos los pares finitos completos, respetando el mínimo de
muestra configurado. Devuelve `slope`, `intercept`, `r_squared` (1 − SSE/SST),
`rmse` (√(SSE/n)), `observations_used`, `observations_excluded`, `equation` y
`chart` dentro de `result`; el envelope conserva `sample_size`. Solo los puntos
del gráfico se muestrean según `max_scatter_points` y `random_seed`.
`chart.trend` conserva exactamente los coeficientes del ajuste, sin redondearlos.
El dataset original no se modifica.

#### Modelo y diagnóstico de residuos

El panel distingue la exploración de asociaciones de la evaluación del ajuste:
presenta una ecuación destacada, tarjetas R²/RMSE/pendiente/intercepto con sus
definiciones, observaciones utilizadas/excluidas y nombres de X/Y. La sección
**Interpretación del modelo** usa reglas deterministas de presentación: signo
de la pendiente, proporción de variación recogida por R² y error en unidades de
Y. Describe la muestra y no afirma causalidad ni rendimiento predictivo.

El resultado incorpora de forma aditiva el campo opcional
`residual_diagnostics`. Python calcula Ŷ = pendiente × X + intercepto y residuo
= Y observado − Ŷ usando los mismos pares finitos del ajuste. Su estructura es:

```json
{
  "kind": "residuals",
  "x": "columna_x",
  "y": "columna_y",
  "points": [[5.0, 0.2], [8.0, -0.1]],
  "total_points": 120,
  "sampled": true
}
```

Cada punto contiene `[Y_estimado, residuo]`, sin filas completas ni índices del
dataset. Se aplican exactamente los mismos índices de muestreo reproducible,
límite y semilla que al `chart` existente. El ajuste y las métricas siguen
usando todos los pares válidos. El campo `chart` se conserva para compatibilidad
con consumidores anteriores, pero no se dibuja de nuevo en el panel del modelo.

`ResidualPlot` dibuja los residuos recibidos frente a Ŷ, con una referencia
horizontal en cero. Solo calcula geometría de pantalla; no calcula errores ni
estadísticas. Ajusta su viewBox mediante ResizeObserver para conservar etiquetas
legibles en móvil. El diagnóstico es descriptivo y puede mostrar una muestra;
no sustituye pruebas de supuestos ni valida predicción fuera de la muestra.

Antes de generar ejes, el diagnóstico comprueba que la escala permite avanzar
en precisión float64. Si el rango es demasiado estrecho respecto a su magnitud
o la geometría desborda, muestra un aviso y conserva las métricas. Esto evita
bloquear el panel con estimaciones próximas a 1e16 separadas por pocas unidades.
La protección es local a `ResidualPlot`; no cambia los generadores de ejes
compartidos ni los gráficos de asociaciones anteriores.

El contrato local `linear-regression-contract.ts` valida método, orden X/Y,
completitud, métricas finitas, contadores y gráfico antes de mostrar resultados.
Comprueba que el tamaño válido y las exclusiones suman las filas del dataset
activo, y que la recta del gráfico coincide con los coeficientes recibidos.
El frontend presenta las estadísticas recibidas; no las recalcula. El formato
numérico conserva los coeficientes pequeños sin convertirlos en cero.
Si el diagnóstico opcional está presente, también se validan variables,
contadores, muestreo y coordenadas finitas. Las respuestas anteriores sin ese
campo conservan sus métricas y muestran que el diagnóstico no está disponible;
no se usa el scatter como reemplazo. Un diagnóstico malformado no se dibuja.

`AnalysisResult` no incluye `dataset_id`: la respuesta se vincula al contexto
capturado por la solicitud, no se identifica el dataset por nombres de columnas.
Cambiar variables cancela y limpia la ejecución; cambiar dataset, columnas
disponibles o cantidad de filas reinicia el formulario. Las respuestas tardías
de solicitudes anteriores se descartan incluso si el transporte ignora abort.
Cada instancia de `ScatterPlot` usa un identificador SVG propio.

`SKIPPED` explica muestras insuficientes o variables constantes; `FAILED`, errores
HTTP y respuestas inválidas no muestran estadísticas parciales. Los reintentos
son explícitos. Dataset expirado pide volver a subirlo. R² describe el ajuste y
RMSE el error dentro de la muestra en unidades de Y; no se afirma causalidad ni
rendimiento predictivo.

Pruebas de componente/contrato: `LinearRegressionPanel.test.tsx`,
`linear-regression-contract.test.ts`, `linear-regression-interpretation.test.ts`,
`ResidualPlot.test.tsx` y `ScatterPlot.test.tsx`, incluyendo convivencia con
ranking, matriz y distribución. Las pruebas backend contrastan estimaciones y
residuos con mínimos cuadrados independientes, verifican residuos próximos a
cero en ajustes perfectos y coherencia del muestreo. Una comparación local de
tres resultados anteriores conservó exactamente todos sus campos previos.

#### Validación E2E

`frontend/e2e/linear-regression.spec.ts` utiliza intake y backend reales. Su CSV
sintético reproducible contiene 60 observaciones, con X = i − 30 y residuos
repetidos [-1, 1, 1, -1]. La referencia independiente es pendiente 2.5, intercepto
−3, RMSE 1 y R² = 89975/90023. Comprueba el orden X/Y, métricas, ecuación,
estimaciones, residuos, referencia cero y gráficos previos. Verifica un solo
scatter en el ranking, ninguno duplicado en el panel y ejecución manual.

Los cuatro casos cubren también variables iguales, cambio de dataset con una
sola columna numérica, constantes, muestra insuficiente y cambio de selección
durante una solicitud. Solo en este último caso se demora la entrega de una
respuesta calculada por Python; no se sustituyen sus valores por un mock.

El caso HTTP agota la cuota real con solicitudes secuenciales económicas,
comprueba el 429 y que un reintento anticipado no envía otra petición. Después
del plazo `Retry-After`, un nuevo reintento manual obtiene SUCCESS. No se cambian
cuotas, guardas, tamaño mínimo ni comportamiento estadístico.

Se verifican 1440, 768 y 390 px: controles utilizables, valores numéricos sin
cortes de línea, ecuación sin desbordamiento, residuos visibles y tabla anterior
con desplazamiento horizontal. Las tarjetas usan cuatro columnas en escritorio,
dos en tableta y una en móvil estrecho, conservando la precisión presentada.
`UI_SCREENSHOT_DIR` permite guardar capturas fuera del repositorio; el reporte
de Playwright adjunta también CSV, respuesta real y diagnóstico de red.

Desde `frontend/`, ejecutar cada archivo en un proceso nuevo para aislar el
store y las cuotas, con los servidores de `playwright.config.ts` y
`reuseExistingServer: false`:

```text
npm run test:e2e -- e2e/linear-regression.spec.ts
npm run test:e2e -- e2e/intake.spec.ts
npm run test:e2e -- e2e/associations.spec.ts
```

Validación local del 31/10/2026: 4 E2E de regresión y los 2 E2E existentes de
Intake/Asociaciones aprobados con Edge (`PLAYWRIGHT_CHANNEL=msedge`). El Chromium
local falló al iniciarse con `spawn UNKNOWN`, antes de ejecutar aserciones;
esta evidencia no acredita Chromium Linux ni CI remota.

Validación del rediseño y diagnóstico: frontend con 437 pruebas aprobadas,
typecheck, ESLint y build correctos. Backend: 56 pruebas específicas de regresión
aprobadas; suite completa con 780 aprobadas
y el fallo previo `test_timeout_preserves_completed_snapshot_and_failed_stage`
(timeout de 20 ms). Checker de arquitectura y Ruff correctos. Se mantiene esa
limitación explícita sin alterar pruebas ni agentes ajenos al alcance.

#### Auditoría previa a la integración

La ejecución final sobre `109886843ea8e51d83ae90ec07734d5629281e1b` con este
incremento aprobó 781 pruebas backend; la exportación intacta de esa base,
ejecutada con las mismas dependencias, aprobó 725. Las 38 pruebas unitarias de
regresión y las 18 de integración HTTP aprobaron también por separado. Los
tres snapshots anteriores al diagnóstico conservan exactamente sus campos
previos, métricas, ecuación, puntos, tamaño de muestra y advertencias.

El frontend aprobó 441 pruebas en 35 archivos, incluido el control de escalas
extremas; typecheck, ESLint y build finalizaron correctamente. Los 24 tests de
arquitectura aprobaron; el checker verificó 179 archivos Python, Ruff no
encontró incidencias y 294 archivos cumplieron el formato.

El fallo de timeout sigue siendo una limitación intermitente, no una corrección
de esta entrega. Tanto la prueba aislada original como ambas suites completas
aprobaron en la última ejecución. Sin embargo, una repetición controlada con
los agentes originales y el timeout de 20 ms produjo en la base uno de cinco
reportes sin la etapa `Analysis: FAILED`; los cinco de la rama conservaron esa
etapa. La prueba, el workflow y la telemetría son idénticos a la base. El código
registra la etapa fallida cuando la cancelación ocurre dentro de su nodo; una
cancelación entre nodos es una explicación compatible con la traza observada,
no una causa demostrada mediante instrumentación. El reporte conserva el
dataset y el error global de timeout, pero puede quedar incompleta la traza de
etapas. Si reaparece en pytest, el job correspondiente de CI fallará. No se
modificaron agentes, workflow ni aserciones para ocultarlo.

La validación local no acredita integración con el `develop` remoto posterior
`8ee2eb7ede2e974648b6dae4f07b9371a9f5d367`, que incorpora K-Means en dos commits.
El único archivo de cambios compartido es `app/bootstrap.py`. Una comparación
textual de tres versiones, normalizando finales de línea y sin aplicar cambios,
conserva ambos registros sin conflictos. Es necesario actualizar la base de
forma autorizada y repetir las validaciones antes de afirmar compatibilidad
integral. No se cambiaron Patrones, clustering, contratos comunes ni agentes.

#### Validación conjunta sobre develop con K-Means

La integración posterior parte de `develop`
`8ee2eb7ede2e974648b6dae4f07b9371a9f5d367`, con PR #54 incorporado, en un
checkout independiente. Se trasladan únicamente los 19 archivos de regresión.
El único archivo cambiado en ambas bases es `app/bootstrap.py`: se añaden la
importación y el registro de `LinearRegressionTool` conservando
`KMeansClusteringTool`. Los otros 16 archivos del incremento de K-Means
permanecen idénticos, incluidas configuración, validaciones, contratos,
Patrones y pruebas. No se cambian agentes ni el workflow automático.

| Verificación local | Develop sin regresión | Integración |
| --- | --- | --- |
| Suite backend completa | 739 aprobadas | 795 aprobadas |
| Suite frontend, dos workers | 306 aprobadas en 31 archivos | 444 aprobadas en 36 archivos |
| Regresión: unitarias / HTTP | No incluida | 38 / 18 aprobadas |
| K-Means: unitarias / HTTP | Incluidas en la suite | 12 / 2 aprobadas |
| Arquitectura | Base conservada | 24 aprobadas; checker correcto sobre 181 archivos |
| Ruff / formato | Base conservada | Correctos; 298 archivos con formato válido |
| TypeScript / ESLint / build | Base conservada | Correctos |
| E2E con Edge y backend real | Pruebas existentes conservadas | 4 regresión, 1 K-Means, 1 Patrones, 1 Intake y 1 Asociaciones aprobadas |

Vitest se ejecutó con `--maxWorkers=2`; no se reprodujo un problema de
concurrencia ni fue necesario un reintento secuencial. Cada archivo E2E inició
sus propios servidores con `reuseExistingServer: false`, store y cuotas
aislados. Se verificó la regresión a 1440, 768 y 390 px; K-Means a 1440 y
390 px y los flujos existentes con sus resoluciones previas. Esta ejecución
local con Edge no sustituye la validación remota de Chromium Linux.

Una comprobación HTTP sobre una misma aplicación confirmó las dos herramientas
en un catálogo de 23 entradas únicas. Ejecutar regresión, K-Means y nuevamente
regresión sobre el mismo dataset devolvió SUCCESS en los tres casos, mantuvo
exactamente los resultados de regresión y preservó el preview. Las métricas
coincidieron con una referencia independiente de mínimos cuadrados; K-Means
recuperó los dos grupos sintéticos de 30 observaciones. Los tres snapshots
anteriores al diagnóstico también conservan todos sus campos previos.

El timeout intermitente documentado arriba no apareció en las suites de esta
base ni de la integración. No se considera resuelto: su prueba, el workflow y
la telemetría siguen idénticos a develop. Se conservan el antecedente y el
riesgo de fallo de CI si vuelve a ocurrir. Las evidencias locales permanecen
fuera del repositorio; no forman parte de los archivos de entrega.

## AUD-017 — Detalle MAD en `outliers`

`mad` conserva `threshold`, `count` y `percentage` y añade, de forma aditiva:

| Campo | Contenido |
|---|---|
| `median`, `mad` | mediana y desviación absoluta mediana de los valores observados |
| `lower_bound`, `upper_bound` | límites en unidades de la variable equivalentes a \|z robusto\| > `threshold`: mediana ∓ `threshold`·MAD/0.6745 |
| `examples` | valores marcados por MAD, de mayor a menor \|z robusto\|, hasta `eda.max_outlier_examples` |
| `example_rows` | `{row_index, value, robust_z}` por ejemplo, con la posición original como en AUD-018 |

Con MAD = 0 (columna constante o mitad o más de los valores iguales a la mediana)
`count`, `percentage` y los límites son `null` y los ejemplos quedan vacíos. La
prueba congelada de AUD-018 excluye solo estos campos nuevos: los anteriores no
cambian.

## AUD-018 — Referencias originales en ejemplos IQR

`POST /datasets/{dataset_id}/tools/outliers` conserva `iqr.examples` como lista
de números, en su mismo orden, y añade `iqr.example_rows`:

```json
{
  "examples": [500.0, 500.0, -400.0],
  "example_rows": [
    {"row_index": 1, "value": 500.0},
    {"row_index": 44, "value": 500.0},
    {"row_index": 45, "value": -400.0}
  ]
}
```

Este fragmento pertenece a `result.<columna>.iqr`; los demás campos de la respuesta
se mantienen. `row_index` es una posición basada en cero dentro del dataset
registrado, coherente con `preview.offset` de AUD-009. La interfaz muestra
**Registro row_index + 1**. No es un identificador de negocio, una etiqueta del
índice interno del DataFrame ni una línea física del CSV/TSV. Las líneas vacías
omitidas en intake y los campos con saltos de línea pueden cambiar esa última
relación; no cambian la posición dentro del dataset.

### Correspondencia y compatibilidad

El cambio backend se limita a `profiling/measures.py`, dentro del adaptador de
Exploration. Antes de eliminar nulos se obtiene el vector de posiciones mediante
la misma máscara de observados. Las posiciones recorren la misma máscara IQR y
la misma selección estable por distancia descendente a la mediana que los valores.
No se busca ningún valor con index(), no se reconstruyen posiciones por igualdad
y no se ejecuta otro análisis para recuperarlas. Empates y valores repetidos
conservan el orden original; registros distintos conservan posiciones distintas.

Ambos arreglos tienen la misma longitud y orden, acotados por
`eda.max_outlier_examples` (20 por defecto; cero desactiva ejemplos sin cambiar
conteos). Se preservan las vallas de Tukey, multiplicador, umbral MAD, cuartiles,
mediana, conteos, porcentajes y criterios de no evaluabilidad. Los valores usan
la misma normalización `finite()` de los ejemplos anteriores: redondeo a seis
decimales y null para valores no finitos. Por ello son valores estadísticos
normalizados, no una nueva representación exacta del archivo original. El
frontend identifica un null como «Valor no representable» sin inventar un número.

La herramienta conserva `minimum_sample_size` (20 por defecto). Una columna sin
observaciones suficientes sigue devolviendo `skipped: insufficient observations`
dentro de un resultado global SUCCESS; no se crean ejemplos. Los resultados
globales SKIPPED/FAILED mantienen sus contratos anteriores. Las columnas
constantes y los casos sin atípicos no generan referencias ficticias.

No cambia `AnalysisResult`, que ya contiene JSON libre en `result`, ni sus rutas,
OpenAPI, puertos o contratos compartidos. No se regenera `types/api.ts`. Los
consumidores anteriores pueden continuar usando `iqr.examples` sin interpretar
el campo nuevo; no se transforma esa lista en objetos. No se incluyen filas
completas, datos de columnas no solicitadas ni identificadores nuevos.

La complejidad estadística y el ordenamiento existentes se conservan. Se añade
un vector temporal de enteros O(n) para las posiciones de la columna; la salida
sigue acotada por el límite de ejemplos. No hay copia persistente, relectura del
archivo, nuevo store, consulta externa o modificación del dataset. Se conservan
las protecciones HTTP de solicitudes y capacidad.

### Integración puntual con el explorador existente

ColumnExplorer muestra «Ejemplos de valores atípicos», registro, valor e IQR.
Aclara que un atípico puede ser válido y no debe eliminarse automáticamente.
Respuestas anteriores sin example_rows muestran que las posiciones no están
disponibles; no se infieren desde examples. Se validan posiciones enteras dentro
del total de filas, ausencia de posiciones duplicadas y correspondencia con la
lista numérica existente antes de presentar referencias.

Los ejemplos esperan las solicitudes de histograma y descriptivas dependientes
de la columna, evitando sumar otra operación simultánea sin crear una cola
global. Cambiar solo la agrupación del boxplot no repite outliers. Un rechazo
por capacidad o fallo de red ofrece reintentar la misma solicitud, sin parámetros
analíticos artificiales. Mientras cambia columna/dataset se ocultan los ejemplos
anteriores. useTool descarta también respuestas exitosas de solicitudes abortadas;
AssociationsPage reinicia el explorador con key del dataset y aporta su total
de filas. Se conservan los gráficos y su comportamiento previo de estado stale.

Archivos de integración del módulo del Integrante 2 modificados por esta extensión:
measures.py (posiciones), ColumnExplorer.tsx (presentación), useTool.ts (descarte
de respuestas canceladas y reintento explícito), AssociationsPage.tsx (ciclo de
vida por dataset) y types/exploration.ts (campo opcional y columnas no evaluables).
OutlierExamples.tsx concentra la presentación/validación de referencias; los
estilos son locales. No se modifican correlación, ranking, algoritmos de gráficos,
Planner, Critic o Reporting. «Anomalías» permanece Próximamente; esta entrega no
crea una pantalla de anomalías ni limpieza de registros.

### Pruebas y evidencia reproducible

```powershell
uv run python -m pytest tests/unit/test_outlier_row_references.py -q
uv run python -m pytest tests/integration/test_outlier_row_references_api.py -q
uv run python -m pytest tests/unit/test_eda_tools.py tests/integration/test_exploration_api.py -q
uv run python scripts/check_architecture.py
uv run python -m pytest tests/architecture -q
```

La fixture `outliers_before_aud018.json` conserva nueve resultados sintéticos
obtenidos **antes** de modificar el algoritmo, desde la base
`29d5ae78895da52c328714291a3bb4e3404eb2ec`. La prueba compara íntegramente todos
los campos anteriores, excluyendo solo example_rows. Otras pruebas verifican
nulos iniciales/intercalados/consecutivos/finales, repeticiones, empates,
positivos/negativos, orden no ordenado, límites, muestras pequeñas, constantes,
múltiples columnas e índice del DataFrame con etiquetas repetidas, sin mutación.

La integración carga CSV y TSV reales con una línea física vacía y un campo
multilínea, consulta outliers y verifica cada referencia contra preview. El
archivo original no se relee. Ejemplo sintético reproducible en PowerShell, con
el backend iniciado en otra terminal mediante `uv run uvicorn app.api.main:app`:

```powershell
$csvPath = Join-Path (Split-Path (Get-Location) -Parent) 'aud018-synthetic.csv'
$values = @($null, 500) + @(-20..20) + @($null, 500, -400, $null)
$lines = @('code,measure', '')
for ($i = 0; $i -lt $values.Count; $i++) { $lines += "r$i,$($values[$i])" }
[IO.File]::WriteAllText($csvPath, ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
$loaded = curl.exe -sS -F "file=@$csvPath" http://127.0.0.1:8000/intake | ConvertFrom-Json
$datasetId = $loaded.profile.dataset_id
$body = @{ variables = @('measure') } | ConvertTo-Json
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $body `
    "http://127.0.0.1:8000/datasets/$datasetId/tools/outliers" | ConvertTo-Json -Depth 12
Invoke-RestMethod "http://127.0.0.1:8000/datasets/$datasetId/preview?offset=44&limit=2" |
    ConvertTo-Json -Depth 8
```

Esperado: ejemplos 500, 500 y -400, posiciones 1, 44 y 45; registros visibles
2, 45 y 46. Las posiciones 44/45 del preview contienen 500/-400. Las capturas y
la respuesta HTTP se guardan fuera del repositorio en `aud018-evidence`.

### Validación local de AUD-018

Worktree aislado `Analista-de-datos-aud018`, rama
`feat/aud-018-outlier-row-references`, base exclusiva origin/develop
`29d5ae78895da52c328714291a3bb4e3404eb2ec`, con PR #37 incorporado.

| Verificación | Línea base | Con AUD-018 |
| --- | --- | --- |
| Tests existentes test_eda_tools.py | 11 aprobadas | 11 aprobadas, sin cambiar aserciones |
| Tests existentes test_exploration_api.py | 3 aprobadas | 3 aprobadas |
| Unitarias nuevas de trazabilidad | No existían | 31 aprobadas |
| Integración HTTP nueva | No existía | 4 aprobadas |
| Suite backend completa | 563 aprobadas, 4 fallos | 598 aprobadas, los mismos 4 fallos |
| AST / arquitectura | 172 archivos correctos / 24 aprobadas | Igual |
| Ruff general | 2 errores previos | Los mismos 2 errores |
| Ruff de archivos AUD-018 | No aplica | Correcto |
| Formato Python | 264 archivos correctos | 266 archivos correctos |
| Unitarias frontend nuevas | No existían | 20 aprobadas |
| Nuevas más AssociationsPage existentes | 3 existentes | 23 aprobadas; pruebas anteriores intactas |
| Suite frontend completa | 138 aprobadas, 1 fallo | 158 aprobadas, el mismo fallo |
| E2E nuevos con Edge/backend real | No existían | 2 aprobados |
| E2E completos | 6 aprobados, 4 fallos | 8 aprobados, los mismos 4 fallos |
| TypeScript / build | Correctos | Correctos |
| ESLint general | 1 error previo | El mismo error |
| ESLint de AUD-018 | No aplica | Correcto |
| OpenAPI y tipos generados | Contrato existente | Intactos; no se regeneran |
| git diff --check | Correcto | Correcto |

Fallos backend preexistentes reconfirmados antes y después:
`test_fast_mode_uses_next_valid_anova_after_omitting_sparse_pair`,
`test_default_csv_produces_measured_critic_and_insights_without_a_question`,
`test_critic_reports_significant_results_without_robustness_as_preliminary` y
`test_critic_skips_when_no_result_is_significant`. Ruff conserva F841 unranked
en analysis_planning.py:273 y F401 AssociationResult en test_planner_agent.py:10.

Frontend conserva el fallo de ReportPage `null metrics stay unmeasured and no
insights are invented` y ESLint mantiene methodLabel sin uso en ReportPage.tsx:6.
Los E2E fallidos siguen siendo el de associations.spec.ts y los tres de
report.spec.ts; no se modificaron sus aserciones ni implementaciones para ocultarlos.
Las suites generales no están completamente aprobadas. No se identificaron
regresiones nuevas en las validaciones ejecutadas.

Evidencias locales fuera del repositorio en `aud018-evidence`: las seis capturas
del flujo, `outliers-http.txt` con respuestas reales de TestClient contrastadas
con preview, y logs de unitarias, integración, suites, E2E, tipos, build y
arquitectura. Capturas de escritorio y móvil revisadas visualmente. Los datos
utilizados son sintéticos. Resultados locales, no CI de GitHub. Cambios pendientes
de revisión; sin staging, commit, push, PR, merge ni rebase durante esta entrega.

## Pendiente

- Vista de contingencia para pares categórico–categórico.
- Selección de tools por el Planner/Analysis (integrante 3) y liberación del
  dataset del store al terminar una ejecución.
