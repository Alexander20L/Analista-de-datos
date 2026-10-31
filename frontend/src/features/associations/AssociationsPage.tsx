import { ArrowRight, Info, LoaderCircle, ScanSearch, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CorrelationHeatmap } from "../../components/charts/CorrelationHeatmap";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { PRIORITY } from "../../lib/api-client";
import { formatNumber } from "../../lib/utils";
import type { HeatmapChart, RankedRelationship, RelationshipRanking } from "../../types/exploration";
import { useIntake } from "../data-intake/IntakeProvider";
import { ColumnExplorer } from "./ColumnExplorer";
import { LinearRegressionPanel } from "./LinearRegressionPanel";
import { RelationshipDetail } from "./RelationshipDetail";
import { relationshipKey, RelationshipTable } from "./RelationshipTable";
import { explainNote } from "./notes";
import { ToolNotice } from "./ToolNotice";
import { useTool, type ToolError } from "./useTool";

export function AssociationsPage() {
  const { result } = useIntake();
  const datasetId = result?.profile.dataset_id;
  const numeric = result?.summary.numeric_columns ?? [];
  const categorical = result?.summary.categorical_columns ?? [];
  const ranking = useTool(datasetId, "relationship_ranking", [], {}, { priority: PRIORITY.primary });
  const heatmap = useTool(datasetId, "chart_correlation_heatmap", numeric.length >= 2 ? [] : null, {}, { priority: PRIORITY.primary });
  const [picked, setPicked] = useState<{ x: string; y: string } | null>(null);

  if (!result || !datasetId) return <Card className="empty-state"><span className="upload-icon"><ScanSearch size={28} /></span>
    <h1>Aún no hay dataset</h1><p>Primero sube un CSV o TSV. Las asociaciones se calculan sobre el dataset que queda en memoria tras la ingesta.</p>
    <Button asChild><Link to="/">Subir dataset <ArrowRight size={15} /></Link></Button>
  </Card>;

  const expired = ranking.error?.expired || heatmap.error?.expired;
  if (expired) return <Card className="empty-state"><span className="upload-icon"><TriangleAlert size={28} /></span>
    <h1>El dataset ya no está disponible</h1>
    <p>El servidor guarda una cantidad limitada de datasets en memoria y los olvida al reiniciarse. Vuelve a subir {result.filename} para explorarlo.</p>
    <Button asChild><Link to="/">Volver a subir <ArrowRight size={15} /></Link></Button>
  </Card>;

  const data = ranking.data?.status === "SUCCESS" ? ranking.data.result as unknown as RelationshipRanking : null;
  const relationships = data?.top_relationships ?? [];
  const byKey = new Map(relationships.map((item) => [relationshipKey(item), item]));
  const pair = picked ?? relationships[0] ?? null;
  const selectedKey = pair ? relationshipKey(pair) : null;
  const heatmapChart = heatmap.data?.status === "SUCCESS" && validHeatmap(heatmap.data.result) ? heatmap.data.result : null;
  const excluded = Object.entries(data?.excluded_columns ?? {});

  return <div className="associations-page">
    <div className="provenance-bar"><Badge tone="info">Calculado en Python</Badge>
      <span>Estadística determinista · sin interpretación de LLM</span></div>
    <div className="page-heading"><p className="eyebrow">Exploración / Asociaciones</p><h1>Asociaciones</h1>
      <p>Relaciones candidatas entre columnas de {result.filename}, ordenadas por un puntaje de fuerza comparable.</p></div>

    <div className="info-note candidates-note"><Info size={16} /><div><strong>Son candidatas estadísticas, no hallazgos.</strong>
      <ul className="claim-levels" aria-label="Cómo leer estos resultados">
        <li><strong>Descripción:</strong> el puntaje y el tamaño del efecto miden cuán marcada es la covariación en estos datos.</li>
        <li><strong>Asociación:</strong> las columnas varían juntas en este dataset; cada par se evalúa con el método adecuado a sus tipos.</li>
        <li><strong>Significancia:</strong> los valores p se corrigen por comparaciones múltiples ({data?.correction ?? "Benjamini-Hochberg"}) y solo
          se listan los pares con p ajustado ≤ α = {data?.significance_level ?? 0.05}. Un p bajo indica que la asociación es poco compatible
          con el azar; no mide su magnitud, su robustez ni si es espuria.</li>
        <li><strong>Causalidad:</strong> nunca se infiere aquí. La revisión de robustez y posibles confusores está en{" "}
          <Link to="/relations">Relaciones</Link> y <Link to="/report">Hallazgos</Link>.</li>
      </ul></div></div>

    {ranking.loading && !ranking.data && <div className="processing-panel" role="status"><LoaderCircle size={16} className="spin" />
      <div><strong>Evaluando pares de columnas…</strong><p>Ejecutando pruebas de correlación, de grupos y de contingencia en cada par elegible.</p></div></div>}
    {ranking.error && <ErrorPanel error={ranking.error} onRetry={ranking.retry} />}
    {ranking.data && ranking.data.status !== "SUCCESS" && <div className="info-note"><Info size={16} /><div>
      <strong>No se pudieron evaluar asociaciones.</strong><p>{explainNote(ranking.data.warnings?.[0] ?? "")}</p></div></div>}

    {data && <>
      <div className="metrics-grid associations-metrics">
        <Metric label="Pares evaluados" value={formatNumber(data.evaluated_pairs)} note="Columnas numéricas y categóricas" />
        <Metric label="Candidatas significativas" value={formatNumber(data.significant_pairs)} note={`p ajustado ≤ ${data.significance_level}`} />
        <Metric label="Mostradas" value={formatNumber(relationships.length)} note="Las de mayor puntaje" />
        <Metric label="Columnas excluidas" value={formatNumber(excluded.length)} note="Constantes o con demasiadas categorías" />
      </div>

      <Card className="ranking-card"><div className="card-heading"><div><h2>Relaciones ordenadas</h2>
        <p>El puntaje (0 a 1) hace comparables |r|, |ρ|, V de Cramér, η y √ε²; el tamaño del efecto es el valor del propio método.
          Ambos describen magnitud, no causalidad. Selecciona una fila para inspeccionarla.</p></div>
        <Badge>{relationships.length} candidatas</Badge></div>
        {relationships.length > 0
          ? <RelationshipTable relationships={relationships} selected={selectedKey}
            onSelect={(item: RankedRelationship) => setPicked({ x: item.x, y: item.y })} />
          : <p className="muted">Ningún par alcanzó significancia tras la corrección. Esto no demuestra que no haya asociación:
            puede faltar tamaño de muestra o la relación puede no ser detectable con estos métodos.</p>}
        {pair && <RelationshipDetail key={selectedKey} datasetId={datasetId} x={pair.x} y={pair.y}
          ranked={byKey.get(selectedKey!)} numeric={numeric} />}
      </Card>
    </>}

    {numeric.length >= 2 && <Card className="heatmap-card"><div className="card-heading"><div><h2>Matriz de correlación</h2>
      <p>r de Pearson entre columnas numéricas, con filas completas por par. Selecciona una celda para inspeccionar el par.
        Los valores p de la matriz no están corregidos por comparaciones múltiples: no equivalen a candidatas significativas.</p></div></div>
      {heatmapChart ? <CorrelationHeatmap chart={heatmapChart} stale={heatmap.stale}
        onSelect={(x, y) => setPicked({ x, y })} />
        : <ToolNotice tool={heatmap} loadingLabel="Calculando matriz…"
          emptyLabel={heatmap.data?.status === "SUCCESS" ? "La matriz recibida no es válida. No se muestra." : undefined} />}
    </Card>}

    {numeric.length > 0 && <ColumnExplorer key={datasetId} datasetId={datasetId} totalRows={result.profile.row_count} numeric={numeric} categorical={categorical} />}

    <LinearRegressionPanel datasetId={datasetId} numeric={numeric} totalRows={result.profile.row_count} />

    {(excluded.length > 0 || (data?.skipped_pairs.length ?? 0) > 0) && <Card className="warnings-card">
      <div className="card-heading"><h2><TriangleAlert size={17} />No evaluado</h2></div>
      <ul>
        {excluded.map(([name, reason]) => <li key={name}><strong>{name}</strong>: {explainNote(reason)}</li>)}
        {data?.skipped_pairs.map((item) => <li key={`${item.x}-${item.y}`}><strong>{item.x} ↔ {item.y}</strong>: {explainNote(item.reason)}</li>)}
      </ul>
    </Card>}
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <Card className="metric-card"><p>{label}</p><strong>{value}</strong><small>{note}</small></Card>;
}

function ErrorPanel({ error, onRetry }: { error: ToolError; onRetry?: () => void }) {
  return <div className="error-panel" role="alert"><TriangleAlert size={16} /><div><strong>{error.message}</strong>
    {error.requestId && <small>ID de solicitud: {error.requestId}</small>}
    {onRetry && !error.expired && <Button variant="outline" size="small" onClick={onRetry}>Reintentar</Button>}</div></div>;
}

/** Square, size-consistent matrix; anything else would render a broken chart. */
function validHeatmap(value: unknown): value is HeatmapChart {
  if (!value || typeof value !== "object") return false;
  const chart = value as Partial<HeatmapChart>;
  const n = Array.isArray(chart.columns) ? chart.columns.length : 0;
  const square = (matrix: unknown) => Array.isArray(matrix) && matrix.length === n
    && matrix.every((row) => Array.isArray(row) && row.length === n);
  return n >= 2 && square(chart.values) && square(chart.p_values) && square(chart.sample_sizes);
}
