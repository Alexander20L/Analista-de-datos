import { ArrowRight, Info, Layers, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatValue } from "../../components/charts/chart-utils";
import { PRIORITY } from "../../lib/api-client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ToolNotice } from "../associations/ToolNotice";
import { useTool } from "../associations/useTool";
import { useIntake } from "../data-intake/IntakeProvider";
import { GroupRangeChart } from "./GroupRangeChart";
import { KMeansExplorer } from "./KMeansExplorer";
import { limitations, readGroupedSummary, type PatternGroup } from "./patterns-contract";

const GROUP_LIMITS = [5, 10, 20];

export function PatternsPage() {
  const { result } = useIntake();
  const datasetId = result?.profile.dataset_id;
  const numeric = result?.summary.numeric_columns ?? [];
  const categorical = result?.summary.categorical_columns ?? [];

  if (!result || !datasetId) return <Card className="empty-state"><span className="upload-icon"><Layers size={28} /></span>
    <h1>Aún no hay dataset</h1><p>Primero sube un CSV o TSV. Los patrones se calculan sobre el dataset que queda en memoria tras la ingesta.</p>
    <Button asChild><Link to="/">Subir dataset <ArrowRight size={15} /></Link></Button>
  </Card>;

  return <div className="patterns-page">
    <div className="provenance-bar"><Badge tone="info">Calculado en Python</Badge>
      <span>Estadística descriptiva determinista · sin interpretación de LLM</span></div>
    <div className="page-heading"><p className="eyebrow">Exploración / Patrones</p><h1>Patrones por grupo</h1>
      <p>Compara cómo se distribuye una variable numérica de {result.filename} entre las categorías de una columna.</p></div>
    {numeric.length && categorical.length
      ? <GroupExplorer key={datasetId} datasetId={datasetId} numeric={numeric} categorical={categorical} />
      : <div className="info-note"><Info size={16} /><div><strong>No hay columnas suficientes para comparar grupos.</strong>
        <p>Se necesita al menos una columna numérica y una categórica. Este dataset tiene {numeric.length} numérica(s) y {categorical.length} categórica(s).</p></div></div>}
    <KMeansExplorer key={`kmeans-${datasetId}`} datasetId={datasetId} numeric={numeric} />
  </div>;
}

function GroupExplorer({ datasetId, numeric, categorical }: { datasetId: string; numeric: string[]; categorical: string[] }) {
  const [column, setColumn] = useState(numeric[0]);
  const [groupBy, setGroupBy] = useState(categorical[0]);
  const [maxGroups, setMaxGroups] = useState(10);
  const tool = useTool(datasetId, "grouped_summary", [column, groupBy], { max_groups: maxGroups }, { priority: PRIORITY.primary });
  const reading = readGroupedSummary(tool, column, groupBy);
  const view = reading.kind === "ready" ? reading.view : null;

  return <>
    <div className="info-note candidates-note"><Info size={16} /><div>
      <strong>Los grupos son categorías existentes, no clusters.</strong>
      <p>Cada grupo corresponde a un valor ya registrado en «{groupBy}». El sistema no descubre ni crea segmentos.
        Las cifras describen los grupos: no prueban que las diferencias sean significativas ni que una categoría cause los valores.</p>
    </div></div>

    <Card className="patterns-card">
      <div className="card-heading"><div><h2>Resumen por grupo</h2>
        <p>Observaciones, valores nulos, centro y dispersión de la variable en cada categoría.</p></div>
        <div className="explorer-controls">
          <div className="field"><label htmlFor="patterns-column">Variable</label>
            <select id="patterns-column" value={column} onChange={(event) => setColumn(event.target.value)}>
              {numeric.map((name) => <option key={name}>{name}</option>)}</select></div>
          <div className="field"><label htmlFor="patterns-group">Categoría</label>
            <select id="patterns-group" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              {categorical.map((name) => <option key={name}>{name}</option>)}</select></div>
          <div className="field"><label htmlFor="patterns-limit">Grupos mostrados</label>
            <select id="patterns-limit" value={maxGroups} onChange={(event) => setMaxGroups(Number(event.target.value))}>
              {GROUP_LIMITS.map((limit) => <option key={limit} value={limit}>Hasta {limit}</option>)}</select></div>
        </div>
      </div>

      {reading.kind === "invalid" && <div className="chart-placeholder" role="alert">
        La respuesta recibida no corresponde a la selección actual o está incompleta. No se muestran grupos.</div>}
      {!view && reading.kind !== "invalid" && <ToolNotice tool={tool} loadingLabel="Calculando grupos…" />}

      {view && <>
        <dl className="stat-strip patterns-strip">
          <div><dt>Grupos en «{view.groupBy}»</dt><dd>{view.totalGroups}</dd></div>
          <div><dt>Mostrados</dt><dd>{view.groups.length}</dd></div>
          <div><dt>Observaciones</dt><dd>{formatValue(view.overall.observed, 0)}</dd></div>
          <div><dt>Nulos en «{view.column}»</dt><dd>{formatValue(view.overall.missing, 0)}</dd></div>
          <div><dt>Mediana global</dt><dd>{formatValue(view.overall.median)}</dd></div>
          <div><dt>Media global</dt><dd>{formatValue(view.overall.mean)}</dd></div>
        </dl>
        <Limitations notes={limitations(view)} />
        {view.groups.length > 0 ? <>
          <h3 className="chart-title">Distribución de {view.column} por {view.groupBy}</h3>
          <GroupRangeChart column={view.column} groupBy={view.groupBy} groups={view.groups} stale={tool.stale} />
          <p className="chart-note">Línea: mínimo a máximo · Caja: Q1 a Q3 · Marca: mediana · n: observaciones con valor.</p>
          <GroupTable column={view.column} groups={view.groups} />
        </> : <p className="muted">«{view.groupBy}» no tiene categorías registradas.</p>}
      </>}
    </Card>
  </>;
}

function Limitations({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return <div className="warnings-card patterns-limitations" role="note" aria-label="Limitaciones del resumen">
    <h3><TriangleAlert size={15} />Limitaciones</h3>
    <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul>
  </div>;
}

function GroupTable({ column, groups }: { column: string; groups: PatternGroup[] }) {
  return <div className="table-scroll" role="region" aria-label="Tabla de grupos" tabIndex={0}>
    <table className="ranking-table patterns-table"><caption className="sr-only">Resumen de {column} por grupo</caption>
      <thead><tr>
        <th scope="col">Grupo</th><th scope="col">Filas</th><th scope="col">Observaciones</th><th scope="col">Nulos</th>
        <th scope="col">Media</th><th scope="col">Mediana</th><th scope="col">Desv. estándar</th><th scope="col">IQR</th>
        <th scope="col">Mín.</th><th scope="col">Máx.</th><th scope="col">Notas</th>
      </tr></thead>
      <tbody>{groups.map((group) => <tr key={group.label}>
        <th scope="row" className="variable-name">{group.label}</th>
        <td>{formatValue(group.rows, 0)}</td><td>{formatValue(group.observed, 0)}</td><td>{formatValue(group.missing, 0)}</td>
        <td>{formatValue(group.mean)}</td><td>{formatValue(group.median)}</td><td>{formatValue(group.std)}</td>
        <td>{formatValue(group.iqr)}</td><td>{formatValue(group.min)}</td><td>{formatValue(group.max)}</td>
        <td>{group.observed === 0 ? <Badge>Sin valores</Badge> : group.smallSample ? <Badge>Muestra pequeña</Badge> : null}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
