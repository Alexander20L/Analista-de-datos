import { Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { formatValue } from "../../components/charts/chart-utils";
import { PRIORITY } from "../../lib/api-client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ToolNotice } from "../associations/ToolNotice";
import { useTool } from "../associations/useTool";
import { KMeansScatterPlot } from "./KMeansScatterPlot";
import { readKMeans, type KMeansView } from "./kmeans-contract";
import type { KMeansCluster, KMeansResult } from "../../types/exploration";

const CLUSTER_OPTIONS = [2, 3, 4, 5, 6];

interface SubmittedKMeans {
  variables: string[];
  nClusters: number;
}

export function KMeansExplorer({ datasetId, numeric }: { datasetId: string; numeric: string[] }) {
  const [variables, setVariables] = useState(() => numeric.slice(0, 2));
  const [nClusters, setClusters] = useState(2);
  const [submitted, setSubmitted] = useState<SubmittedKMeans | null>(null);
  const tool = useTool(
    datasetId,
    "kmeans_clustering",
    submitted?.variables ?? null,
    submitted ? { n_clusters: submitted.nClusters } : {},
    { priority: PRIORITY.primary },
  );
  const reading = readKMeans(tool, submitted?.variables, submitted?.nClusters);
  const ready = reading.kind === "ready" ? reading.view : null;
  const validSelection = variables.length >= 2 && variables.length <= 4;

  function changeVariables(name: string) {
    setSubmitted(null);
    setVariables((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : current.length < 4 ? [...current, name] : current);
  }

  function changeClusters(value: number) {
    setSubmitted(null);
    setClusters(value);
  }

  return <section className="kmeans-section" aria-labelledby="kmeans-heading">
    <div className="info-note candidates-note"><Info size={16} /><div>
      <strong>La segmentación es estadística, no una categoría verificada.</strong>
      <p>K-Means agrupa observaciones similares según las variables numéricas elegidas. No prueba perfiles reales, causalidad ni etiquetas de negocio.</p>
    </div></div>
    <Card className="patterns-card kmeans-card">
      <div className="card-heading"><div><h2 id="kmeans-heading">Segmentación automática — K-Means</h2>
        <p>Selecciona de 2 a 4 variables numéricas y ejecuta el cálculo manualmente.</p></div>
        <Badge tone="info">Máximo 3.000 observaciones</Badge>
      </div>

      {numeric.length < 2 ? <div className="chart-placeholder" role="status">
        Se necesitan al menos dos columnas numéricas para ejecutar K-Means. Este dataset tiene {numeric.length}.</div> : <>
        <fieldset className="kmeans-variables"><legend>Variables numéricas (2 a 4)</legend>
          <div className="kmeans-variable-grid">{numeric.map((name) => {
            const checked = variables.includes(name);
            return <label key={name}><input type="checkbox" checked={checked}
              disabled={!checked && variables.length === 4} onChange={() => changeVariables(name)} />{name}</label>;
          })}</div>
        </fieldset>
        <div className="explorer-controls kmeans-controls">
          <div className="field"><label htmlFor="kmeans-clusters">Número de clusters</label>
            <select id="kmeans-clusters" value={nClusters} onChange={(event) => changeClusters(Number(event.target.value))}>
              {CLUSTER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <Button disabled={!validSelection || tool.loading} onClick={() => setSubmitted({ variables: [...variables], nClusters })}>
            {tool.loading ? <><LoaderCircle size={15} className="spin" />Ejecutando clustering</> : "Ejecutar clustering"}
          </Button>
        </div>
        {!validSelection && <p className="field-error" role="alert">Selecciona entre 2 y 4 variables numéricas.</p>}

        {reading.kind === "idle" && <p className="kmeans-idle">El cálculo no se ejecuta hasta que selecciones las variables y pulses el botón.</p>}
        {reading.kind === "pending" && <ToolNotice tool={tool} loadingLabel="Calculando segmentación…" emptyLabel="Preparando segmentación…" />}
        {reading.kind === "problem" && <ToolNotice tool={tool} />}
        {reading.kind === "invalid" && <div className="chart-placeholder" role="alert">La respuesta no corresponde a la selección actual. No se muestran resultados.</div>}

        {ready && <KMeansResults view={ready} stale={tool.stale} />}
      </>}
    </Card>
  </section>;
}

function KMeansResults({ view, stale }: { view: KMeansView; stale: boolean }) {
  const result = view.result;
  return <div className="kmeans-results">
    <dl className="stat-strip kmeans-strip">
      <div><dt>Clusters</dt><dd>{result.n_clusters}</dd></div>
      <div><dt>Observaciones usadas</dt><dd>{formatValue(result.observations_used, 0)}</dd></div>
      <div><dt>Filas excluidas</dt><dd>{formatValue(result.observations_excluded, 0)}</dd></div>
      <div><dt>Inercia</dt><dd>{formatValue(result.inertia)}</dd></div>
      <div><dt>Silueta</dt><dd>{formatValue(result.silhouette)}</dd></div>
      <div><dt>Puntos mostrados</dt><dd>{formatValue(result.points.length, 0)}</dd></div>
    </dl>
    <ResultNotes warnings={view.warnings} result={result} />
    <h3 className="chart-title">Proyección de clusters</h3>
    {result.variables.length > 2 && <p className="chart-note">La proyección muestra «{result.projection.x}» y «{result.projection.y}»; el agrupamiento se calculó con las {result.variables.length} variables seleccionadas.</p>}
    <KMeansScatterPlot x={result.projection.x} y={result.projection.y} points={result.points}
      clusters={result.clusters.map((cluster) => cluster.cluster)} stale={stale} />
    <p className="chart-note">{result.sampled ? `Se muestran ${result.points.length} de ${result.total_points} puntos.` : "Se muestran todas las observaciones utilizadas."}</p>
    <ClusterTable variables={result.variables} clusters={result.clusters} />
  </div>;
}

function ResultNotes({ warnings, result }: { warnings: string[]; result: KMeansResult }) {
  return <div className="warnings-card kmeans-limitations" role="note" aria-label="Limitaciones del clustering">
    <h3><TriangleAlert size={15} />Interpretación y límites</h3>
    <p>{result.interpretation}</p>
    {warnings.length > 0 && <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
  </div>;
}

function ClusterTable({ variables, clusters }: { variables: string[]; clusters: KMeansCluster[] }) {
  return <div className="table-scroll" role="region" aria-label="Tabla de clusters" tabIndex={0}>
    <table className="ranking-table patterns-table kmeans-table"><caption className="sr-only">Clusters y centroides</caption>
      <thead><tr><th scope="col">Cluster</th><th scope="col">Registros</th>{variables.map((name) => <th key={name} scope="col">Centroide «{name}»</th>)}</tr></thead>
      <tbody>{clusters.map((cluster) => <tr key={cluster.cluster}>
        <th scope="row">Cluster {cluster.cluster + 1}</th><td>{formatValue(cluster.count, 0)}</td>
        {variables.map((name) => <td key={name}>{formatValue(cluster.centroid[name])}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}
