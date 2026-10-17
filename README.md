# Multiagent Data Analyst

Base inicial en Python 3.12+ para un sistema multiagente de análisis de datos.
El objetivo es comprender datasets, planificar análisis, ejecutar herramientas
determinísticas, criticar evidencias y producir insights y reportes trazables.

**Estado: intake CSV/TSV/TXT/JSON/JSONL, EDA/Associations, Planner/Analysis deterministas, Critic,
insights, persistencia, evaluación y reportes integrados.**

Validación de la combinación main/develop y limitaciones conocidas:
[docs/integracion-main-final.md](docs/integracion-main-final.md).

Comenzar con [LEEME_INTEGRANTE5.md](LEEME_INTEGRANTE5.md). Incluye demo independiente,
API, persistencia, evaluación, guía de integración y patch de cambios.

## Probar tus datasets desde el navegador

La interfaz React vive en `frontend/`, junto al backend. Incluye **New Analysis** y
**Dataset Overview**, junto con **Associations** (`/associations`) e
**Insights y evidencia** (`/report`): carga CSV/TSV, diccionario JSON opcional,
separador/encoding, exploración, gráficos, métricas y descargas JSON/Markdown.

Desde la raíz, en una terminal:

```powershell
uv sync --locked
uv run python run.py
```

En otra terminal, dentro de `frontend/` (Node 20.19+):

```powershell
npm.cmd ci
npm.cmd run dev
```

Abre **http://localhost:5173**. Vite reenvía `/api` a FastAPI en el puerto 8000.
El backend procesa los archivos en su entorno local Python; los archivos subidos
son temporales y se eliminan después del intake. El navegador no necesita conocer
rutas locales del servidor.

Consistencia de los cinco módulos y formatos tabulares admitidos: [docs/format-consistency-contract.md](docs/format-consistency-contract.md).

Guía de interfaz, contratos y tests: [docs/frontend.md](docs/frontend.md).

## Principios

- El LLM razona e interpreta; Python calcula.
- Los datasets completos permanecen locales y no se incluyen en el contexto LLM.
- Monolito modular con arquitectura hexagonal y contratos Pydantic.
- Fuentes, proveedores y persistencia se sustituyen mediante puertos.
- Las técnicas estadísticas son tools, no agentes.

## Arquitectura y módulos

| Módulo | Responsabilidad |
|---|---|
| `app/domain` | Modelos, enums e invariantes, sin infraestructura |
| `app/application` | DTO, configuración efectiva y caso de uso |
| `app/ports` | Protocols para agentes, fuentes, tools, LLM y workflow |
| `app/adapters` | CSV/TSV locales, store de datasets, datos de gráficos, LLM desactivado y factorías SQLAlchemy |
| `app/agents` | DataUnderstanding, Planner, Analysis, Critic e Insight |
| `app/analytics` | Registry y tools determinísticas de profiling y asociación |
| `app/orchestration` | Estado serializable y grafo LangGraph |
| `app/evaluation` | Contratos experimentales y registro monotónico de tiempos |
| `app/config` | Settings y defaults TOML |
| `app/observability` | Logging con identificadores de ejecución |
| `app/api` | FastAPI y adaptación HTTP |
| `app/bootstrap.py` | Inyección de dependencias |
| `frontend` | React/TypeScript, navegación y presentación de resultados |

Detalles y límites de dependencia: [docs/architecture.md](docs/architecture.md).
Guía del intake: [docs/data-intake.md](docs/data-intake.md).
Motor EDA y de asociación: [docs/eda-association.md](docs/eda-association.md).

## Flujo conceptual

```text
Data Understanding → Planner → Analysis → Critic
                                  ↑         │
                                  └─────────┤ falta evidencia
                                            ↓ evidencia suficiente
                                         Insight → Report
```

El grafo inicial implementa el recorrido lineal
`START → DataUnderstanding → Planner → Analysis → Critic → Insight → END`.
El ciclo del crítico y los análisis paralelos son extensiones futuras.

## Instalación

Desde la raíz del proyecto, con [uv](https://docs.astral.sh/uv/) instalado:

```powershell
uv sync --locked
```

Esto crea `.venv` y usa `uv.lock`. Para configurar opciones locales:

```powershell
Copy-Item .env.example .env
```

Alternativamente, Python 3.12+ permite instalar el paquete con pip en un entorno
virtual: `python -m pip install -e .`. Las herramientas de desarrollo y versiones
reproducibles se gestionan con `uv sync --locked`.

## Tests y calidad

```powershell
uv run python -m pytest
uv run python -m ruff check .
uv run python -m ruff format --check .
```

Las pruebas usan fixtures, SQLite temporal/en memoria y HTTP local.
No requieren proveedor LLM, red ni datasets grandes.

## Levantar FastAPI

```powershell
uv run python run.py
```

Para desarrollo con recarga:

```powershell
uv run uvicorn app.api.main:app --reload
```

- API: `http://127.0.0.1:8000`
- OpenAPI: `http://127.0.0.1:8000/docs`
- `GET /health`: `200 {"status": "ok"}`; indica liveness.
- `POST /intake`: recibe archivo CSV/TSV y diccionario JSON opcional mediante multipart;
  devuelve perfil, resumen, completitud, advertencias y tiempo. Errores: 400/413/422.
- `GET /tools` y `POST /datasets/{dataset_id}/tools/{tool_name}`: exploración EDA.
- `POST /analysis`: ejecuta el flujo actual y guarda el reporte. Etapas pendientes: SKIPPED.
- `POST /analysis/upload`: ejecuta desde un CSV/TSV subido.
- `GET /reports/{run_id}`: recupera reportes; sufijos `/metrics` y `/markdown` disponibles.
- Entrada JSON inválida: **422**.
- Cada respuesta incluye `X-Request-ID` para correlación HTTP.

Ejemplo de cuerpo válido para `/analysis`:

```json
{
  "source": {"kind": "csv", "path": "tests/fixtures/sample.csv"},
  "schema": null,
  "data_dictionary": {
    "entries": [
      {"column_name": "age", "description": "Edad", "source": "manual", "unit": "años"}
    ]
  },
  "user_question": "¿Qué relaciones merecen analizarse?",
  "configuration": {"analysis": {"max_tool_calls": 3}}
}
```

El endpoint `/analysis` ahora ejecuta el grafo. La interfaz conserva `/intake` y
añade `/report` para ejecutar `/analysis/upload` y recuperar reportes.

## Configuración

Precedencia: defaults empaquetados < TOML externo opcional < `.env` < variables
de entorno < argumentos explícitos de Settings. Ejemplo:

```powershell
$env:MDA_ANALYSIS__MAX_TOOL_CALLS = "4"
```

Para TOML externo, usar `load_settings(Path(...))` y pasar el resultado a
`create_app(settings)` o `build_use_case(settings)`.

Los overrides por análisis solo permiten opciones de `analysis` y `performance`.
Los defaults fast son: 3 hipótesis, 8 tools, 1 ciclo crítico, muestra mínima 20,
timeout 15 segundos y `parallel_tools=true`.

Planner aplica tamaño mínimo, presupuesto de hipótesis y de herramientas; Analysis
valida el plan y limita las invocaciones reales. El timeout global protege etapas
cooperativas, pero no interrumpe cálculos CPU-bound. El flag de paralelismo, los
reintentos LLM y el ciclo crítico no habilitan esas capacidades todavía.

SQLite usa memoria de forma predeterminada. Para recuperar reportes tras reiniciar:

```powershell
$env:MDA_PERSISTENCE__DATABASE_URL = "sqlite:///./analysis_reports.db"
```

## Ejecutar el workflow desde Python

```python
import asyncio

from app.application.dto.analysis_input import AnalysisInput
from app.bootstrap import build_use_case
from app.config.settings import Settings


async def main() -> None:
    use_case = build_use_case(Settings())
    report = await use_case.execute(
        AnalysisInput(source={"kind": "csv", "path": "tests/fixtures/sample.csv"})
    )
    print(report.model_dump_json(indent=2))
    if report.dataset_profile is not None and report.data_dictionary is not None:
        print(report.dataset_profile.summary(report.data_dictionary).model_dump_json(indent=2))


asyncio.run(main())
```

DataUnderstanding lee el CSV/TSV y entrega perfil y diccionario. Planner propone
un plan acotado y Analysis ejecuta herramientas locales; Critic e Insight requieren
evidencia suficiente. El reporte es `FAILED` ante errores, `SUCCESS` si todas las
etapas registradas finalizan correctamente y `SKIPPED` cuando quedan etapas
pendientes. Analysis puede estar en `SUCCESS` con Critic/Insight en `SKIPPED`.
Una fuente inválida detiene el grafo antes de Planner. Los tiempos son reales,
incluido `profiling_time`; las métricas sin medición permanecen null.

## Estado actual

Implementado: lectura estricta CSV/TSV y clasificación de columnas, EDA y gráficos,
planificación determinista, seis herramientas estadísticas autorizadas, registros
por ejecución con liberación de recursos, Critic basado en evidencia, InsightAgent,
reportes Markdown/JSON, persistencia SQLite, telemetría, evaluación y API.

Pendiente: adaptadores SQL/TXT, proveedor LLM productivo y redacción libre,
ciclo Critic → Planner, paralelismo real y validación experimental de los umbrales
de Critic. Planner omite ANOVA con grupos insuficientes antes de asignar presupuesto;
ver [validación de grupos](docs/anova-group-validation.md). CSV con comillas internas
mal escapadas se rechaza sin omitir filas.
Las asociaciones y evaluaciones preliminares no prueban causalidad.

El catálogo EDA y el registro estadístico del workflow se construyen explícitamente;
los datos de exploración se conservan separados de los recursos temporales del
análisis. El proveedor LLM está deshabilitado y no genera respuestas simuladas.

## Contribuir

- `main`: entregas estables.
- `develop`: integración del equipo.
- `feature/*`: desarrollo de capacidades.
- Prefijos de commit: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`.
- Pull requests pequeños, con typing, tests rápidos y Ruff correcto.
- Cambios de contratos requieren revisión compartida y coordinación entre módulos.
- No crear agentes por algoritmo; registrar tools con `AnalyticsTool`.
- Leer [Definition of Done](docs/definition-of-done.md) y
  [responsabilidades del equipo](docs/team-ownership.md).

Estas convenciones documentan el flujo de trabajo; el scaffolding no crea ramas
ni commits automáticamente.


## Revisión con evidencia calculada

Consulta [Critic e Insight con evidencia calculada](docs/critic-evidence-pipeline.md) para el catálogo ampliado, planificación automática, clasificación indeterminada y condiciones de omisión.
