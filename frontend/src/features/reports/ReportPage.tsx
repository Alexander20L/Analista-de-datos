import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { downloadJson } from "../../lib/download";
import type { components } from "../../types/api";
import { useIntake } from "../data-intake/IntakeProvider";

type Report = components["schemas"]["AnalysisReport"];
const base = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

async function readReport(response: Response): Promise<Report> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail?.message || "No se pudo obtener el reporte.");
  return payload as Report;
}

export function ReportPage() {
  const { draft, updateDraft } = useIntake();
  const [report, setReport] = useState<Report | null>(null);
  const [runId, setRunId] = useState("");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function execute(recover = false) {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setError(""); setReport(null);
    try {
      let response: Response;
      if (recover) {
        response = await fetch(`${base}/reports/${encodeURIComponent(runId.trim())}`, { signal: request.signal });
      } else {
        if (!draft.file) throw new Error("Selecciona un CSV, TSV, TXT, JSON o JSONL.");
        const body = new FormData();
        body.append("file", draft.file); body.append("delimiter", draft.delimiter);
        body.append("encoding", draft.encoding);
        if (draft.dictionary) body.append("data_dictionary", draft.dictionary);
        if (question.trim()) body.append("user_question", question.trim());
        response = await fetch(`${base}/analysis/upload`, { method: "POST", body, signal: request.signal });
      }
      const value = await readReport(response);
      if (!request.signal.aborted) { setReport(value); setRunId(value.run_id); }
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Error de conexión.");
    } finally {
      if (controller.current === request) { controller.current = null; setLoading(false); }
    }
  }

  return <div className="dataset-page report-page">
    <div className="page-heading"><p className="eyebrow">Análisis / Reporte</p>
      <h1>Insights y evidencia</h1><p>Consulta los hallazgos, sus limitaciones y el estado de cada etapa.</p></div>
    <Card className="quality-card">
      <h2>Ejecutar un análisis</h2>
      <label>Dataset CSV, TSV, TXT, JSON o JSONL <input aria-label="Dataset del reporte" type="file" accept=".csv,.tsv,.txt,.json,.jsonl" disabled={loading}
        onChange={(event) => updateDraft({ file: event.target.files?.[0] || null })} /></label>
      {draft.file && <p>Archivo seleccionado: {draft.file.name}</p>}
      <label>Pregunta opcional <input aria-label="Pregunta del análisis" value={question} disabled={loading}
        onChange={(event) => setQuestion(event.target.value)} /></label>
      <p>Se utilizarán el separador, encoding y diccionario seleccionados en New Analysis.</p>
      <Button disabled={loading || !draft.file} onClick={() => void execute()}>
        {loading ? "Procesando…" : "Generar reporte"}</Button>
    </Card>
    <Card className="quality-card"><h2>Recuperar un reporte</h2>
      <label>ID de ejecución <input aria-label="ID de ejecución" value={runId} disabled={loading}
        onChange={(event) => setRunId(event.target.value)} /></label>
      <Button variant="outline" disabled={loading || !runId.trim()} onClick={() => void execute(true)}>Consultar</Button>
    </Card>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <Card className="quality-card"><h2>Estado: {report.status}</h2><p>Ejecución: {report.run_id}</p>
        {report.status === "SKIPPED" && <p>El reporte contiene etapas pendientes. Los campos sin medición no representan cero.</p>}
        <div className="inline-actions"><Button variant="outline" onClick={() => downloadJson("analysis-report.json", report)}>Descargar JSON</Button>
          <a href={`${base}/reports/${encodeURIComponent(report.run_id)}/markdown`}>Descargar informe</a></div>
      </Card>
      <Card className="quality-card"><h2>Insights</h2>
        {report.insights?.length ? report.insights.map((insight) => <article key={insight.insight_id}>
          <p>{insight.statement}</p><details><summary>Ver referencias y limitaciones</summary><p>Evidencias: {insight.evidence_ids?.join(", ")}</p>
          <ul>{insight.limitations?.map((item, i) => <li key={i}>{item}</li>)}</ul></details>
        </article>) : <p>No hay insights respaldados por evidencia disponibles.</p>}
      </Card>
      <Card className="quality-card"><h2>Etapas y tiempos</h2><table><thead><tr><th>Etapa</th><th>Estado</th><th>Segundos</th></tr></thead>
        <tbody>{Object.entries(report.stage_statuses || {}).map(([stage, state]) => <tr key={stage}>
          <td>{stage}</td><td>{state}</td><td>{report.stage_durations?.[stage]?.toFixed(4) ?? "Sin medición"}</td></tr>)}</tbody></table>
      </Card>
      <Card className="quality-card"><h2>Métricas</h2><table><tbody>
        {Object.entries(report.metrics || {}).map(([name, value]) => <tr key={name}><th>{name}</th>
          <td>{value === null ? "Sin medición" : String(value)}</td></tr>)}
      </tbody></table></Card>
      <Card className="quality-card"><h2>Resultados y evidencia</h2>
        {(report.analysis_results || []).map((value) => <article key={value.analysis_id}>
          <h3>{value.method} · {value.status}</h3><p>{value.variables?.join(" / ")}</p><details><summary>Ver cálculo completo</summary><pre>{JSON.stringify(value.result, null, 2)}</pre></details>
        </article>)}
        {(report.evidence || []).map((value) => <p key={value.evidence_id}>{value.evidence_id} → {value.analysis_id}: {value.description}</p>)}
      </Card>
      <Card className="quality-card"><h2>Advertencias y errores</h2><ul>
        {[...(report.warnings || []), ...(report.errors || [])].map((value, i) => <li key={i}>{value}</li>)}
      </ul></Card>
    </>}
  </div>;
}
