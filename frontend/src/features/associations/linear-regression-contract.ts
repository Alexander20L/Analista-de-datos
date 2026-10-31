import type { ScatterChart } from "../../types/exploration";

export interface RegressionContext {
  datasetId: string;
  x: string;
  y: string;
  totalRows: number;
}

export interface LinearRegressionResult {
  x: string;
  y: string;
  slope: number;
  intercept: number;
  r_squared: number;
  rmse: number;
  observations_used: number;
  observations_excluded: number;
  equation: string;
  chart: ScatterChart;
  residual_diagnostics?: ResidualDiagnostics | null;
}

export interface ResidualDiagnostics {
  kind: "residuals";
  x: string;
  y: string;
  /** Backend-computed [estimated Y, observed Y minus estimated Y] pairs. */
  points: [number, number][];
  total_points: number;
  sampled: boolean;
}

export type RegressionReading =
  | { kind: "invalid" }
  | { kind: "skipped" | "failed"; warnings: string[] }
  | { kind: "ready"; result: LinearRegressionResult; warnings: string[] };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const natural = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;

/** AnalysisResult has no dataset_id. Bind its transport response to the captured
 * request context and compare that context with the active dataset/ordered pair.
 * This never infers dataset identity from the column names alone.
 */
export function readLinearRegression(
  data: unknown, requested: RegressionContext, active: RegressionContext,
): RegressionReading {
  const invalid: RegressionReading = { kind: "invalid" };
  if (!active.datasetId || !active.x || !active.y || active.x === active.y || !natural(active.totalRows)
    || requested.datasetId !== active.datasetId || requested.x !== active.x || requested.y !== active.y
    || requested.totalRows !== active.totalRows || !record(data) || data.method !== "linear_regression"
    || !Array.isArray(data.variables) || data.variables.length !== 2
    || data.variables[0] !== active.x || data.variables[1] !== active.y
    || data.completeness !== "complete" || !record(data.column_results) || Object.keys(data.column_results).length !== 0
    || !Array.isArray(data.warnings) || !data.warnings.every((note) => typeof note === "string")) return invalid;

  if (data.status === "SKIPPED" || data.status === "FAILED") {
    if (data.result !== null || data.sample_size !== null || data.p_value !== null || data.effect_size !== null) return invalid;
    return { kind: data.status === "SKIPPED" ? "skipped" : "failed", warnings: data.warnings };
  }
  if (data.status !== "SUCCESS" || !record(data.result)) return invalid;
  const result = data.result;
  if (result.x !== active.x || result.y !== active.y || !finite(result.slope) || !finite(result.intercept)
    // OLS with an intercept has non-negative in-sample R², apart from float roundoff.
    || !finite(result.r_squared) || result.r_squared < -1e-12 || result.r_squared > 1
    || !finite(result.rmse) || result.rmse < 0
    || !natural(result.observations_used) || result.observations_used < 2 || !natural(result.observations_excluded)
    || result.observations_used !== data.sample_size
    || result.observations_used + result.observations_excluded !== active.totalRows
    || typeof result.equation !== "string" || !result.equation.trim() || !record(result.chart)) return invalid;

  const chart = result.chart;
  if (chart.kind !== "scatter" || chart.x !== active.x || chart.y !== active.y
    || chart.total_points !== result.observations_used || typeof chart.sampled !== "boolean"
    || !Array.isArray(chart.points) || chart.points.length < 2 || chart.points.length > result.observations_used
    || chart.sampled !== (chart.points.length < result.observations_used)
    || !chart.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(finite))
    || !record(chart.trend) || chart.trend.slope !== result.slope || chart.trend.intercept !== result.intercept) return invalid;

  // Older servers do not return a diagnostic; their validated metrics remain usable.
  const diagnostic = result.residual_diagnostics;
  if (diagnostic != null && (!record(diagnostic) || diagnostic.kind !== "residuals"
    || diagnostic.x !== active.x || diagnostic.y !== active.y || diagnostic.total_points !== result.observations_used
    || diagnostic.sampled !== chart.sampled || !Array.isArray(diagnostic.points)
    || diagnostic.points.length !== chart.points.length
    || !diagnostic.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(finite)))) return invalid;

  return { kind: "ready", result: result as unknown as LinearRegressionResult, warnings: data.warnings };
}
