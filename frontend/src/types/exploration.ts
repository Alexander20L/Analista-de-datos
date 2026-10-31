import type { components } from "./api";

export type AnalysisResult = components["schemas"]["AnalysisResult"];
export type ToolRunRequest = components["schemas"]["ToolRunRequest"];

export type ColumnResult = components["schemas"]["ColumnResult"];
/** Explicit envelope variants. Partial SUCCESS still carries per-column omissions/failures. */
export type EdaOutcome =
  | { kind: "success"; data: AnalysisResult }
  | { kind: "partial"; data: AnalysisResult; columns: Record<string, ColumnResult> }
  | { kind: "skipped"; data: AnalysisResult }
  | { kind: "failed"; data: AnalysisResult };

export function edaOutcome(data: AnalysisResult): EdaOutcome {
  if (data.status === "FAILED") return { kind: "failed", data };
  if (data.status === "SKIPPED") return { kind: "skipped", data };
  if (data.completeness === "partial") return { kind: "partial", data, columns: data.column_results ?? {} };
  return { kind: "success", data };
}

// AnalysisResult.result is free JSON in OpenAPI. These shapes mirror the Python models
// RankedRelationship (app/shared/domain/models/analysis.py) and the chart specs in
// app/modules/exploration/adapters/visualization/charts.py; update both sides together.

export interface SupportingMeasure {
  method: string;
  variables: string[];
  strength: number | null;
  p_value: number | null;
}

export interface RankedRelationship {
  x: string;
  y: string;
  method: string;
  score: number;
  strength: number | null;
  p_value: number | null;
  adjusted_p_value: number | null;
  sample_size: number;
  supporting: SupportingMeasure[];
  warnings: string[];
}

export interface RelationshipRanking {
  top_relationships: RankedRelationship[];
  evaluated_pairs: number;
  significant_pairs: number;
  skipped_pairs: { x: string; y: string; reason: string }[];
  excluded_columns: Record<string, string>;
  significance_level: number;
  correction: string;
}

export interface HeatmapChart {
  kind: "heatmap";
  method: string;
  columns: string[];
  values: (number | null)[][];
  p_values: (number | null)[][];
  sample_sizes: number[][];
}

export interface ScatterChart {
  kind: "scatter";
  x: string;
  y: string;
  points: [number, number][];
  total_points: number;
  sampled: boolean;
  trend: { slope: number; intercept: number } | null;
}

export interface HistogramChart {
  kind: "histogram";
  column: string;
  edges: number[];
  counts: number[];
}

export interface BoxStats {
  label: string;
  count: number;
  lower_whisker: number;
  q1: number;
  median: number;
  q3: number;
  upper_whisker: number;
  outliers: number[];
  outlier_count: number;
}

export interface BoxPlotChart {
  kind: "boxplot";
  column: string;
  group_by: string | null;
  boxes: BoxStats[];
}

/** chart_contingency: rows = x, columns = y. Expected-frequency counters refer to the full table. */
export interface ContingencyChart {
  kind: "contingency";
  x: string;
  y: string;
  row_labels: string[];
  column_labels: string[];
  counts: number[][];
  row_totals: number[];
  column_totals: number[];
  total: number;
  expected: (number | null)[][];
  /** When > 0, the last row/column groups this many of the least frequent categories. */
  folded_rows: number;
  folded_columns: number;
  cells: number;
  expected_below_5: number;
  expected_below_1: number;
  min_expected: number | null;
  empty_cells: number;
  excluded_rows: number;
}

export type ChartSpec = HeatmapChart | ScatterChart | HistogramChart | BoxPlotChart | ContingencyChart;

export interface NumericSummary {
  count: number;
  missing: number;
  mean?: number | null;
  std?: number | null;
  min?: number | null;
  median?: number | null;
  max?: number | null;
  iqr?: number | null;
  skewness?: number | null;
}

/** grouped_summary: one numeric column summarised per existing category (not discovered clusters). */
export interface GroupSummary extends NumericSummary {
  label: string;
  /** Rows carrying this category, including those with a missing value. */
  rows: number;
  q1?: number | null;
  q3?: number | null;
  /** Fewer observed values than minimum_sample_size: describe, do not compare. */
  small_sample: boolean;
}

export interface GroupedSummary {
  column: string;
  group_by: string;
  total_groups: number;
  shown_groups: number;
  max_groups: number;
  minimum_sample_size: number;
  groups: GroupSummary[];
  /** Smaller groups left out by max_groups; the UI must say so explicitly. */
  omitted: { groups: number; rows: number; observed: number };
  /** Rows without a category: counted apart, never treated as a group. */
  missing_group: { rows: number; observed: number };
  overall: NumericSummary;
}

export interface KMeansCluster {
  cluster: number;
  count: number;
  centroid: Record<string, number>;
}

export interface KMeansPoint {
  x: number;
  y: number;
  cluster: number;
}

/** kmeans_clustering: bounded statistical segmentation, never a verified category. */
export interface KMeansResult {
  kind: "kmeans";
  variables: string[];
  n_clusters: number;
  clusters: KMeansCluster[];
  inertia: number;
  silhouette: number | null;
  silhouette_sample_size: number;
  observations_used: number;
  observations_excluded: number;
  total_observations: number;
  projection: { x: string; y: string; uses_all_selected_variables: boolean };
  points: KMeansPoint[];
  total_points: number;
  sampled: boolean;
  interpretation: string;
}

export interface OutlierSummary {
  count?: number;
  skipped?: string;
  iqr?: {
    multiplier?: number;
    count: number; percentage: number | null; lower_fence: number | null; upper_fence: number | null;
    examples?: (number | null)[];
    example_rows?: { row_index: number; value: number | null }[];
  };
  mad?: {
    threshold?: number;
    count: number | null; percentage: number | null;
    /** AUD-017 detail: absent in older responses; bounds and examples are null/empty when MAD = 0. */
    median?: number | null;
    mad?: number | null;
    lower_bound?: number | null;
    upper_bound?: number | null;
    examples?: (number | null)[];
    example_rows?: { row_index: number; value: number | null; robust_z: number | null }[];
  };
}
