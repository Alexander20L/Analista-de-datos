> Contrato transversal vigente: [formatos y consistencia de los cinco módulos](format-consistency-contract.md). Las notas de entrega inicial se conservan como contexto histórico.


# Critic & Spurious Relationship Detection

## 1. Objetivo

Evaluar la robustez de asociaciones estadísticas e
identificar señales de posibles relaciones espurias.

El Critic interpreta resultados calculados por las
herramientas analíticas. No calcula correlaciones
directamente sobre el dataset.

## 2. Entradas

El Critic recibe AgentContext, principalmente:

- associations: lista de AssociationResult.
- analysis_results: lista de AnalysisResult.
- evidence: evidencias existentes.
- relationship_assessments: evaluaciones existentes.

## 3. Contratos estadísticos

### Correlaciones originales

AssociationResult:
- method: "pearson" o "pearson_correlation"
- variables: [variable_x, variable_y]
- strength: coeficiente de correlación

También se admiten asociaciones Spearman.

### Correlación parcial

AnalysisResult:
- method: "partial_correlation"
- variables: [variable_x, variable_y]
- effect_size: correlación parcial
- metadata.control_variables: lista de controles

### Análisis sin outliers

AnalysisResult:
- method: "correlation_without_outliers"
- variables: [variable_x, variable_y]
- effect_size: correlación sin outliers
- metadata.outlier_method: método utilizado
- metadata.removed_count: observaciones excluidas

### Análisis por subgrupos

AnalysisResult:
- method: "analyze_subgroups"
- result.group_by: variable de agrupación
- result.groups: lista de grupos con:
  - group
  - correlation
  - sample_size

### Análisis temporal

AnalysisResult:
- method: "analyze_temporal"
- result.time_column: columna temporal
- result.periods: lista cronológica con:
  - period
  - correlation
  - sample_size

El análisis temporal es una extensión opcional
que requiere coordinación con el Analyst.

## 4. Reglas provisionales

- Debilitamiento: original >= 0.50 en magnitud,
  ajustada < 0.30 en magnitud y reducción >= 70 %.
- Cambio de signo relevante: magnitudes >= 0.30.
- Impacto de outliers: diferencia >= 0.30.
- Heterogeneidad de subgrupos: diferencia >= 0.50.
- Variación temporal: diferencia >= 0.50.

Los umbrales son heurísticos y requieren validación.

## 5. Salidas

El agente devuelve AgentResult con:

- status: SUCCESS cuando genera evaluaciones.
- status: SKIPPED sin evidencia evaluable.
- update.evidence: lista de Evidence.
- update.relationship_assessments: lista de
  RelationshipAssessment.

potentially_spurious:
- True: alerta activada por correlación parcial.
- None: evidencia insuficiente para clasificar.

Las alertas de outliers, subgrupos y temporalidad
se registran en la justificación, pero no activan
por sí solas potentially_spurious=True.

## 6. Limitaciones

- No demuestra causalidad ni espuriedad.
- No calcula intervalos de confianza.
- No comprueba la existencia real de todas las columnas.
- Presupone periodos ordenados cronológicamente.
- Depende de resultados estadísticos del Analyst.
- Los contratos de las herramientas deben confirmarse
  durante la integración del equipo.

## 7. Pruebas

Ejecutar:

uv run pytest tests/unit/test_critic.py tests/unit/test_critic_robustness.py -q

Validación global:

uv run pytest -q
uv run ruff check .
uv run ruff format --check .

## Compatibilidad de integración

Critic también utiliza resultados exitosos de Pearson y
Spearman recibidos en analysis_results, tomando el
coeficiente de effect_size cuando no existe una asociación
equivalente.

Para correlación parcial admite metadata.control_variable
como texto cuando no se proporciona control_variables.
Se conservan las validaciones de las variables de control.

## Revisión con evidencia calculada

Consulta [Critic e Insight con evidencia calculada](critic-evidence-pipeline.md) para el catálogo ampliado, planificación automática, clasificación indeterminada y condiciones de omisión.
