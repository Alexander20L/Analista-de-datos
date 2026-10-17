> Contrato transversal vigente: [formatos y consistencia de los cinco módulos](format-consistency-contract.md). Las notas de entrega inicial se conservan como contexto histórico.

# Integración del módulo del integrante 5

## Entrada independiente

`FinalizationInput` permite recibir resultados de los compañeros sin releer datos
ni ejecutar sus agentes. Usa los modelos de dominio existentes:

- run_id, user_question, dataset_profile y data_dictionary.
- analysis_results: lista de AnalysisResult.
- evidence: lista de Evidence.
- relationship_assessments: lista de RelationshipAssessment.
- metrics y warnings.

Ejemplo ejecutable: `examples/integrante5_input.json` y
`uv run python scripts/demo_integrante5.py`.

`FinalizeAnalysis.execute(packet)` genera, valida y guarda el reporte.
El contexto común requiere una fuente: este caso de uso utiliza un marcador de
ruta que nunca lee. El estado y los tiempos de este caso describen la finalización;
no demuestran que otras etapas se ejecutaron.

## Entrada dentro del workflow

InsightAgent recibe AgentContext y devuelve AgentResult con AgentUpdate(insights, metrics).
No modifica plan, resultados ni clasificación. Se preserva el registro existente en
bootstrap. El ensamblador conserva evidencia, evaluaciones, configuración y métricas.

Cada Evidence.analysis_id debe referenciar un AnalysisResult exitoso. Cada
RelationshipAssessment.evidence_ids debe apuntar a Evidence existente. Las variables
objetivo deben estar incluidas en las variables de cada resultado utilizado.
Referencias desconocidas, resultados fallidos y resultados sin valores calculados no
producen insights. Las evidencias originales siguen visibles para revisión del equipo.

## Integrante 1

Mantener DatasetProfile y DataDictionary. No se requieren filas crudas para insights.
El endpoint /analysis/upload vuelve a subir el archivo para ejecutar el flujo completo;
no presupone que /intake conserve una tabla. Acordar con el integrante 3 el futuro
acceso de tools a las tablas locales durante la ejecución.

## Integrante 2

Entregar AnalysisResult con method, variables, status, result, sample_size, advertencias,
p_value y effect_size cuando corresponda. No convertir p-values en score comparable
con coeficientes. Se conservan las cifras calculadas, sin recalcularlas en módulo 5.

## Integrante 3

Mantener el puerto AnalysisWorkflow.run y AnalyzeDataset.execute. Cambios puntuales
realizados en graph.py/state.py: ensamblado completo de reportes, timestamp de ejecución,
tiempo al primer insight, alcance de telemetría y preservación de contadores medidos.
No se añade ciclo crítico, paralelismo, tools ni planificación.

InstrumentedLLMProvider y InstrumentedAnalyticsTool decoran los protocolos existentes.
El wrapper se coloca al inyectar cada proveedor/tool; telemetry_scope pertenece a la
invocación, mediante ContextVar, sin compartir métricas entre ejecuciones concurrentes.
Cada llamada intentada cuenta, incluidos reintentos si atraviesan el wrapper.
Las excepciones cuentan como fallos. Si falta consumo de tokens en alguna llamada,
el total de tokens queda nulo, evitando presentar un total parcial como completo.

El registry continúa vacío y el proveedor desactivado en producción. Los límites de
hipótesis, tools y ciclos corresponden al integrante 3. El campo started_monotonic sirve
para la invocación actual; si se añaden checkpoints reanudables, redefinir la medición
para excluir o identificar el tiempo de espera y no reutilizar timestamps de otro proceso.
Los errores fatales del workflow aún no recuperan checkpoints de resultados parciales.

## Integrante 4

Se usa el contrato actual: potentially_spurious=True, False o None.
True: clasificación positiva suministrada por el crítico.
False: no marcado en las comprobaciones disponibles; no equivale a causalidad demostrada.
None: indeterminado.
El módulo 5 no decide por cuánto debe disminuir una correlación para clasificarla.
Si el equipo adopta un enum, modificar un adaptador de entrada y conservar None como
abstención explícita. Ground truth y criterios deben acordarse antes de experimentar.

## LLM

Por defecto no se hacen llamadas. InsightAgent(llm, use_llm=True) solicita únicamente
una permutación JSON de los IDs conocidos; permite priorizar sin introducir texto
estadístico inventado. Respuestas malformadas, IDs nuevos, repeticiones o fallos
conservan el orden determinístico y generan advertencia.
Para paráfrasis libre se necesita otro contrato y controles sobre afirmaciones,
unidades, clasificación y cifras; no se habilita silenciosamente.

## API

POST /analysis: entrada JSON con una fuente local; orientado al desarrollo local.
POST /analysis/upload: CSV/TSV multipart, diccionario opcional y pregunta.
GET /reports/{run_id}: reporte persistido.
GET /reports/{run_id}/metrics: métricas disponibles.
GET /reports/{run_id}/markdown: descarga Markdown.
GET /health y POST /intake se conservan.

No hay trabajos en segundo plano ni polling de progreso: los POST esperan al workflow.
No se expone finalización de fixtures como endpoint público.
Una ejecución válida puede devolver un reporte FAILED o SKIPPED con HTTP 200;
los errores de archivo/contrato HTTP tienen respuestas 400/413/422 según su origen.

## Próxima integración

Al recibir avances, comparar primero los ejemplos reales de AgentUpdate y AnalysisResult.
Revisar si cambian nombres, IDs, estructura de result, clasificación o acceso a datasets.
Adaptar en DTO/adaptadores de entrada, conservar los cálculos originales y ejecutar
las pruebas de regresión. No reescribir los algoritmos de los compañeros para hacerlos
encajar en la presentación.
