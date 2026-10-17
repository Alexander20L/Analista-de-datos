# Consistencia de formatos y cinco módulos

Los mismos valores tabulares, nombres, pregunta, diccionario y configuración deben producir los mismos tipos semánticos, métodos, estadísticas, evaluaciones e insights, independientemente del archivo. IDs de dataset, ejecución, análisis y evidencia, timestamps y duraciones identifican cada ejecución y pueden cambiar. Cambiar datos, su significado o configuración puede cambiar los resultados.

## Los cinco contratos

1. Entrada y comprensión: [data-intake.md](data-intake.md). CSV, TSV, TXT delimitado, JSON tabular y JSONL se normalizan a LoadedDataset y LocalTable mediante la misma inferencia conservadora. Los datos quedan locales.
2. EDA y asociaciones: [eda-association.md](eda-association.md). DatasetProvider resuelve el dataset_id; las herramientas calculan resultados tipados sobre los mismos valores, sin depender de la extensión.
3. Planificación y análisis: [planner-analysis-contracts.md](planner-analysis-contracts.md). El plan usa perfil, diccionario, pregunta y límites. Analysis ejecuta las herramientas autorizadas y conserva sus resultados.
4. Crítica: [critic-contract.md](critic-contract.md). Critic revisa resultados exitosos y crea evidencia enlazada. La clasificación indeterminada no se fuerza a positiva o negativa.
5. Insights y reporte: [integrante5-integracion.md](integrante5-integracion.md). Insight explica evidencia válida sin recalcular estadísticas. Los reportes conservan referencias y se recuperan por run_id.

## Formatos de entrada

- CSV: delimitador configurado; TSV: tabulación; TXT: tabla con encabezado y delimitador seleccionado. No interpreta prosa arbitraria.
- JSON: lista de objetos, o un objeto con una única clave records o data que contiene esa lista.
- JSONL: un objeto por línea no vacía.
- JSON solo admite celdas escalares: texto, número finito, booleano o null. Claves ausentes se interpretan como nulos. Se rechazan estructuras anidadas y claves duplicadas o vacías, sin aplanar ni perder campos silenciosamente.
- Se preservan códigos con ceros iniciales y números cuya conversión perdería precisión. Vacíos y espacios se consideran nulos; NA, NULL y NaN textuales no se convierten en nulos.
- Un JSON de perfil o reporte descargado no es un dataset. El run_id recupera el reporte; dataset_id identifica datos para EDA.
- Otros formatos como XLSX, PDF, imágenes, archivos binarios o conexiones SQL requieren adaptadores específicos. La aplicación informa qué formatos acepta.

No todos los datasets permiten todas las pruebas: columnas constantes, muestras insuficientes, ausencia de variables compatibles o presupuesto cero pueden producir SKIPPED justificado. No se crean estadísticas o insights para forzar SUCCESS.

## Verificación

La prueba test_format_equivalence.py recorre CSV, TSV, TXT, JSON lista, JSON records, JSON data y JSONL con orden de claves invertido. Compara perfiles por columna, EDA, resultados numéricos, evaluaciones e insights, y valida las referencias y recuperación del reporte. Incluye números JSON nativos, booleanos, precisión, ausentes, reportes y entradas malformadas. La interfaz prueba carga CSV y JSON hasta el reporte.
