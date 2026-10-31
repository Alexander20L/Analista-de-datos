import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ApiError, DatasetExpiredError, runTool } from "../../lib/api-client";
import { readLinearRegression, type RegressionContext, type RegressionReading } from "./linear-regression-contract";
import { explainNote } from "./notes";
import { formatRegressionNumber, interpretRegression } from "./linear-regression-interpretation";
import { ResidualPlot } from "./ResidualPlot";
import "./LinearRegressionPanel.css";

interface Props {
  datasetId?: string;
  numeric: string[];
  totalRows: number;
}

type State = RegressionReading | { kind: "idle" | "loading" }
  | { kind: "error"; message: string; expired: boolean; requestId?: string };

export function LinearRegressionPanel({ datasetId, numeric, totalRows }: Props) {
  return <Card className="explorer-card linear-regression-panel">
    <div className="card-heading"><div><h2>Regresión lineal</h2>
      <p>Evalúa un modelo de Y en función de X: su ecuación, la calidad del ajuste y la distribución de sus errores.</p>
    </div></div>
    {!datasetId ? <p>Primero sube un dataset para ejecutar la regresión.</p>
      : numeric.length < 2 ? <p>Se necesitan al menos dos columnas numéricas diferentes.</p>
        : <RegressionForm key={JSON.stringify([datasetId, numeric, totalRows])}
          datasetId={datasetId} numeric={numeric} totalRows={totalRows} />}
  </Card>;
}

function RegressionForm({ datasetId, numeric, totalRows }: Props & { datasetId: string }) {
  const id = useId();
  const [x, setX] = useState(numeric[0]);
  const [y, setY] = useState(numeric[1]);
  const [state, setState] = useState<State>({ kind: "idle" });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const valid = numeric.includes(x) && numeric.includes(y) && x !== y;
  const busy = state.kind === "loading";
  const expired = state.kind === "error" && state.expired;

  function select(axis: "x" | "y", value: string) {
    pending.current?.abort();
    pending.current = null;
    if (axis === "x") setX(value); else setY(value);
    setState({ kind: "idle" });
  }

  async function execute(event?: FormEvent) {
    event?.preventDefault();
    if (!valid || pending.current || expired) return;
    const controller = new AbortController();
    const context: RegressionContext = { datasetId, x, y, totalRows };
    pending.current = controller;
    setState({ kind: "loading" });
    try {
      const data = await runTool(datasetId, "linear_regression", { variables: [x, y], parameters: {} }, controller.signal);
      if (!controller.signal.aborted && pending.current === controller) {
        setState(readLinearRegression(data, context, { datasetId, x, y, totalRows }));
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted && pending.current === controller) {
        setState({ kind: "error", message: error instanceof Error ? error.message : "No se pudo ejecutar la regresión.",
          expired: error instanceof DatasetExpiredError, requestId: error instanceof ApiError ? error.requestId : undefined });
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }

  return <>
    <form onSubmit={execute} className="explorer-controls regression-controls" aria-label="Configurar regresión lineal">
      <div className="field"><label htmlFor={`${id}-x`}>Variable independiente (X)</label>
        <select id={`${id}-x`} value={x} disabled={expired} onChange={(event) => select("x", event.target.value)}>
          {numeric.map((name) => <option key={name} value={name}>{name}</option>)}
        </select></div>
      <div className="field"><label htmlFor={`${id}-y`}>Variable dependiente (Y)</label>
        <select id={`${id}-y`} value={y} disabled={expired} onChange={(event) => select("y", event.target.value)}>
          {numeric.map((name) => <option key={name} value={name}>{name}</option>)}
        </select></div>
      <Button type="submit" disabled={!valid || busy || expired}>Ejecutar regresión</Button>
    </form>
    {!valid && <p role="status">Selecciona dos variables numéricas diferentes.</p>}
    {state.kind === "idle" && valid && <p className="chart-note">Selecciona X e Y y pulsa Ejecutar regresión. Cambiar la selección no ejecuta el cálculo.</p>}
    {busy && <p role="status">Calculando regresión lineal…</p>}
    {state.kind === "ready" && <section className="regression-results" aria-label="Resultados de regresión lineal">
      <div className="regression-model"><h3>Modelo calculado</h3>
        <p className="regression-equation">{state.result.equation}</p>
        <p>Ŷ representa el valor estimado de Y en este ajuste.</p>
      </div>
      <dl className="regression-metrics" aria-label="Métricas del modelo">
        {([
          ["R²", state.result.r_squared, "Fracción de la variación de Y recogida por el ajuste en esta muestra."],
          ["RMSE", state.result.rmse, "Magnitud del error de ajuste, expresada en unidades de Y."],
          ["Pendiente", state.result.slope, "Cambio del valor ajustado de Y por una unidad adicional de X."],
          ["Intercepto", state.result.intercept, "Valor ajustado de Y cuando X vale cero."],
        ] as const).map(([label, value, description]) => <div key={label}><dt>{label}</dt><dd>
          <span className="regression-metric-value">{formatRegressionNumber(value)}</span>
          <p>{description}</p>
        </dd></div>)}
      </dl>
      <section className="regression-analysis" aria-label="Información del análisis"><h3>Información del análisis</h3>
        <dl>{([
          ["Observaciones utilizadas", state.result.observations_used],
          ["Observaciones excluidas", state.result.observations_excluded],
        ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatRegressionNumber(value)}</dd></div>)}
          <div><dt>Variable X</dt><dd>{state.result.x}</dd></div>
          <div><dt>Variable Y</dt><dd>{state.result.y}</dd></div>
        </dl>
      </section>
      <div className="regression-diagnostic-layout">
        <section className="regression-diagnostic" aria-label="Diagnóstico de residuos"><h3>Diagnóstico de residuos</h3>
          <p>Cada punto muestra Y observado − Y estimado. Sobre cero, el valor observado fue mayor que el estimado; bajo cero, fue menor.</p>
          {state.result.residual_diagnostics ? <>
            <ResidualPlot diagnostic={state.result.residual_diagnostics} />
            <p className="chart-note">El diagnóstico contiene {state.result.residual_diagnostics.points.length} de {state.result.observations_used} residuos.
              El ajuste utiliza todos los pares válidos, aunque el diagnóstico muestre una muestra.</p>
          </> : <p className="regression-diagnostic-missing" role="status">Esta respuesta no incluye el diagnóstico de residuos.
            Las métricas del modelo siguen disponibles.</p>}
        </section>
        <section className="regression-interpretation" aria-label="Interpretación del modelo"><h3>Interpretación del modelo</h3>
          <ul>{interpretRegression(state.result).map((text, index) => <li key={index}>{text}</li>)}</ul>
          <p>El ajuste describe las {formatRegressionNumber(state.result.observations_used)} observaciones utilizadas.
            El RMSE no acredita rendimiento predictivo fuera de esta muestra.</p>
          <p className="regression-causality">La asociación no implica causalidad.</p>
        </section>
      </div>
      <Warnings notes={state.warnings} />
    </section>}
    {(state.kind === "skipped" || state.kind === "failed") && <div role={state.kind === "skipped" ? "status" : "alert"}>
      <p>{state.kind === "skipped" ? "La regresión no es aplicable a esta selección." : "El cálculo falló. No se muestran resultados parciales."}</p>
      <Warnings notes={state.warnings} />
      <Button type="button" variant="outline" size="small" onClick={() => void execute()}>Reintentar</Button>
    </div>}
    {state.kind === "invalid" && <div role="alert"><p>La respuesta de regresión es inválida o no corresponde a la selección. No se muestran resultados.</p>
      <Button type="button" variant="outline" size="small" onClick={() => void execute()}>Reintentar</Button></div>}
    {state.kind === "error" && <div role="alert">
      <p>{state.expired ? "El dataset ya no está disponible. Vuelve a subirlo para ejecutar la regresión." : state.message}</p>
      {state.requestId && <p className="chart-note">ID de solicitud: {state.requestId}</p>}
      {state.expired ? <Button asChild variant="outline"><Link to="/">Volver a subir dataset</Link></Button>
        : <Button type="button" variant="outline" size="small" onClick={() => void execute()}>Reintentar</Button>}
    </div>}
  </>;
}

function Warnings({ notes }: { notes: string[] }) {
  return notes.length > 0 ? <ul className="detail-notes" aria-label="Advertencias de regresión">
    {notes.map((note, index) => <li key={index}>{regressionNote(note)}</li>)}
  </ul> : null;
}

function regressionNote(note: string): string {
  const sample = note.match(/: (\d+) complete observations; at least (\d+) are required\.$/);
  if (sample) return `Hay ${sample[1]} pares válidos; se necesitan al menos ${sample[2]} para calcular la regresión.`;
  if (note === "Linear regression needs non-constant X and Y among the valid pairs.") {
    return "X e Y deben variar entre los pares válidos. Una variable constante impide calcular este ajuste.";
  }
  const excluded = note.match(/^Excluded (\d+) rows with missing or non-finite X or Y\.$/);
  if (excluded) return `Se excluyeron ${excluded[1]} filas con valores faltantes o no finitos en X o Y.`;
  const sampled = note.match(/^Showing a random sample of (\d+) of (\d+) valid points\.$/);
  if (sampled) return `Se dibuja una muestra reproducible de ${sampled[1]} de ${sampled[2]} puntos válidos; el ajuste usa todos.`;
  if (note === "Descriptive linear fit; association does not imply causation. RMSE is an in-sample error, not an estimate of predictive performance.") {
    return "Ajuste lineal descriptivo sin interpretación causal. El RMSE mide el error dentro de la muestra, no el rendimiento predictivo.";
  }
  return explainNote(note);
}
