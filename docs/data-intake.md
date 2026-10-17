> Contrato transversal vigente: [formatos y consistencia de los cinco módulos](format-consistency-contract.md). Las notas de entrega inicial se conservan como contexto histórico.

# Data Intake & Understanding

> Actualización del integrante 5: ver [guía de integración](integrante5-integracion.md).
> Las descripciones del skeleton de análisis reflejan la base original; la API de
> análisis y reporting se extendió en esta entrega.

## Uso directo

Desde la raíz del proyecto:

```python
import asyncio

from app.application.dto.analysis_input import AnalysisInput
from app.bootstrap import build_data_understanding
from app.config.settings import Settings


async def main() -> None:
    service = build_data_understanding(Settings())
    result = await service.understand(
        AnalysisInput(source={"kind": "tsv", "path": "tests/fixtures/sample.tsv"})
    )
    print(result.summary().model_dump_json(indent=2))


asyncio.run(main())
```

Para el fixture de tres filas, el resumen contiene `rows=3`, `columns=5`,
`numeric_columns=["amount"]`, `categorical_columns=["segment", "active"]`,
`temporal_columns=["created_at"]` e `identifiers=["customer_id"]`. También expone
`text_columns`, `unknown_columns` y `data_dictionary`. Estos datos provienen de
la lectura y clasificación del fixture.

## Lectura

- CSV acepta delimitador y encoding en su contrato; TSV usa tabulador.
- Se valida archivo legible, encabezado no vacío, nombres únicos y anchura exacta
  de filas, incluidas filas con campos faltantes. Las líneas completamente vacías
  se omiten. Encabezados se normalizan quitando espacios externos y BOM UTF-8.
- Se rechazan fuentes sin filas y fuentes completamente vacías de valores.
- Solo campos vacíos o de espacios se tratan como nulos. `NA`, `NULL` y `NaN`
  permanecen como texto; no se presupone una convención de valores faltantes.
- Enteros/decimales y booleanos textuales true/false se detectan conservadoramente.
  Códigos con ceros iniciales y conversiones numéricas que perderían precisión
  permanecen como texto. Fechas conservan sus valores originales.
- SQL y TXT devuelven un error de adaptador no configurado.

## Tipos y roles

`data_type` registra el tipo físico observado. `semantic_type` usa:
`numeric`, `categorical`, `temporal`, `identifier`, `text`, `unknown`.

- IDs: nombre explícito y valores discretos, UUID o códigos con ceros iniciales
  suficientemente únicos. Un número continuo único sigue siendo numérico.
- IDs repetidos siguen siendo candidatos; se advierte que pueden ser claves
  foráneas. La clasificación no garantiza una clave primaria válida.
- Fechas: formato configurado y proporción mínima de valores reconocidos. El
  default exige coincidencia de todos los valores no nulos con un mismo formato.
  Fechas ambiguas como `01/02/2026` no son temporales sin configurar su formato.
- Booleanos son categóricos. Números de baja cardinalidad permanecen numéricos
  salvo un rol explícito y compatible en el diccionario.
- Texto corto con cardinalidad configurada es categórico; nombres de texto libre
  y cadenas fuera de esa política se clasifican como texto.
- Columnas sin valores observados son desconocidas.

Los umbrales están en `[data_intake]` de `defaults.toml`; se sobrescriben mediante
TOML externo o `MDA_DATA_INTAKE__...`. Esta política es global al servicio; los
overrides por análisis siguen limitados a analysis/performance. Los nombres de
tokens se configuran en minúsculas. No se ejecuta EDA estadístico avanzado ni LLM.

## Diccionario y esquema suministrados

El diccionario se recibe como `AnalysisInput.data_dictionary` y se valida con
Pydantic. No se añade un formato de archivo distinto al contrato compartido.

- Entradas originales conservan source, descripción, unidad y confianza.
- Columnas omitidas reciben entradas `inferred`.
- Campos faltantes de entradas originales se completan y se identifican en
  `inferred_fields`; eso no convierte su source original en official.
- `inference_reason` explica el fundamento estructural. Las descripciones inferidas
  indican que el significado de negocio no está verificado. No se inventan unidades
  ni puntuaciones de confianza: confidence queda en None si no fue suministrada.
- Un rol explícito compatible tiene prioridad. Numeric y temporal se contrastan
  con valores observados. Las discrepancias y roles no soportados producen warnings;
  se conserva la declaración original y el perfil refleja los valores observados.
- Las entradas de columnas inexistentes se excluyen del diccionario efectivo con
  una advertencia. La entrada original no se modifica.
- Un esquema con columnas diferentes falla. Tipos físicos declarados distintos
  generan advertencias, sin forzar conversiones silenciosas. Nulos en columnas
  declaradas no-nullables causan un error de validación.

## Integración y contratos compartidos

`DataUnderstandingAgent` recibe el puerto `DataUnderstanding`, no un lector CSV
concreto ni un LLM. Devuelve SUCCESS con `AgentUpdate.dataset_id`, perfil,
diccionario y métricas. Fallos esperados de entrada devuelven FAILED y frenan el
grafo. Las cuatro etapas posteriores continúan como skeletons.

El resultado del servicio contiene `LoadedDataset` únicamente para uso local.
No se incluye la tabla en AgentContext, AgentState, AnalysisReport ni LLMRequest.
La futura ejecución de tools deberá administrar su ciclo de vida local de forma
explícita; `dataset_id` por sí solo no implementa un almacén de datos.

Cambios compartidos para el equipo:

- `DatasetProfile` mantiene row_count y columns; añade invariantes y `summary()`.
- `ColumnProfile.semantic_type` se restringe a los seis roles; añade procedencia,
  explicación y warnings. Semánticas específicas de negocio se mantienen en
  DataDictionaryEntry, no se confunden con estos roles estructurales.
- `DataDictionaryEntry` añade inferred_fields e inference_reason opcionales.
- `AgentUpdate` añade dataset_id y metrics; `AnalysisReport` añade perfil y diccionario.
- `build_agents` ahora requiere un puerto DataUnderstanding inyectado.
- Settings añade data_intake; sus valores provienen de defaults.toml.

`profiling_time` mide lectura, validación y clasificación básicas. El reporte global
continúa SKIPPED hasta implementar el análisis completo. `/analysis` permanece en
501 y `/health` en 200, según el contrato inicial de la API.
