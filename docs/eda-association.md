> Contrato transversal vigente: [formatos y consistencia de los cinco módulos](format-consistency-contract.md). Las notas de entrega inicial se conservan como contexto histórico.

# EDA & Association Engine

Motor exploratorio y de descubrimiento inicial de relaciones. Responde a:
"encontré estas relaciones; ahora investiguemos cuáles realmente tienen sentido".
Las relaciones son **candidatas estadísticas**: el Critic decide si son espurias.

## Acceso a datos: `DatasetProvider`

Las tools reciben un `ToolRequest` con `dataset_id`, no filas. El puerto
`DatasetProvider` (`app/ports/dataset_provider.py`) resuelve ese id a un
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

`app/adapters/visualization/charts.py` devuelve especificaciones tipadas en
`AnalysisResult.result` con campo `kind`. Nunca incluyen el dataset completo.

| Tool | `kind` | Contenido |
|---|---|---|
| `chart_correlation_heatmap` | `heatmap` | columnas, matriz, p-values, n |
| `chart_scatter` | `scatter` | puntos (muestra aleatoria reproducible de `max_scatter_points`), recta de tendencia |
| `chart_histogram` | `histogram` | `edges` (n+1) y `counts` (n) |
| `chart_boxplot` | `boxplot` | por grupo opcional: bigotes, cuartiles, mediana, outliers acotados |

## Configuración

Sección `[eda]` de `app/config/defaults.toml`, sobreescribible con
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

## Pendiente

- Vista de contingencia para pares categórico–categórico.
- Selección de tools por el Planner/Analysis (integrante 3) y liberación del
  dataset del store al terminar una ejecución.
