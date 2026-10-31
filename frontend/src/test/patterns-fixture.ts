import type { AnalysisResult, GroupedSummary, GroupSummary, KMeansResult } from "../types/exploration";

/**
 * Typed `grouped_summary` example used by Patterns (AUD-019), wrapped in the
 * shared successful-result envelope formalized by AUD-022.
 */
export function groupSummary(label: string, rows: number, missing: number, centre: number, smallSample = false): GroupSummary {
  const count = rows - missing;
  return {
    label, rows, count, missing, small_sample: smallSample,
    mean: centre + 2, median: centre, std: 12.5, q1: centre - 10, q3: centre + 10, iqr: 20, min: centre - 30, max: centre + 40,
  };
}

export function groupedSummaryFixture(override: Partial<GroupedSummary> = {}, column = "amount", groupBy = "category"): AnalysisResult {
  const groups = override.groups ?? [groupSummary("norte", 120, 4, 100), groupSummary("sur", 90, 0, 140), groupSummary("este", 12, 1, 180, true)];
  const result: GroupedSummary = {
    column, group_by: groupBy,
    total_groups: groups.length + 2, shown_groups: groups.length, max_groups: 10, minimum_sample_size: 20,
    groups,
    omitted: { groups: 2, rows: 8, observed: 7 },
    missing_group: { rows: 5, observed: 5 },
    overall: { count: 220, missing: 5, mean: 125, median: 118, std: 35 },
    ...override,
  };
  return {
    method: "grouped_summary", status: "SUCCESS", completeness: "complete", variables: [column, groupBy], execution_time: 0.01,
    sample_size: 235, warnings: [], result: result as never,
  };
}

/** A complete K-Means response with two compact, visibly separated clusters. */
export function kmeansFixture(
  override: Partial<KMeansResult> = {}, variables = ["amount", "price"], nClusters = 2,
): AnalysisResult {
  const clusters = override.clusters ?? [
    { cluster: 0, count: 3, centroid: { [variables[0]]: 10, [variables[1]]: 20 } },
    { cluster: 1, count: 3, centroid: { [variables[0]]: 100, [variables[1]]: 210 } },
  ];
  const points = override.points ?? [
    { x: 8, y: 19, cluster: 0 }, { x: 10, y: 20, cluster: 0 }, { x: 12, y: 21, cluster: 0 },
    { x: 98, y: 208, cluster: 1 }, { x: 100, y: 210, cluster: 1 }, { x: 102, y: 212, cluster: 1 },
  ];
  const result: KMeansResult = {
    kind: "kmeans", variables, n_clusters: nClusters, clusters,
    inertia: 12.5, silhouette: 0.82, silhouette_sample_size: 6,
    observations_used: 6, observations_excluded: 0, total_observations: 6,
    projection: { x: variables[0], y: variables[1], uses_all_selected_variables: true },
    points, total_points: 6, sampled: false,
    interpretation: "Statistical groups based only on the selected numeric variables.",
    ...override,
  };
  return {
    method: "kmeans_clustering", status: "SUCCESS", completeness: "complete", variables,
    execution_time: 0.01, sample_size: result.observations_used, warnings: [], result: result as never,
  };
}
