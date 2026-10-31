import type { KMeansCluster, KMeansPoint, KMeansResult } from "../../types/exploration";
import { toolProblem, type ToolProblem } from "../associations/tool-state";
import type { useTool } from "../associations/useTool";

type Tool = ReturnType<typeof useTool>;

export interface KMeansView {
  result: KMeansResult;
  warnings: string[];
}

export type KMeansReading =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "problem"; problem: ToolProblem }
  | { kind: "invalid" }
  | { kind: "ready"; view: KMeansView };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const natural = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function sameVariables(value: unknown, variables: string[]): value is string[] {
  return Array.isArray(value)
    && value.length === variables.length
    && value.every((name, index) => name === variables[index]);
}

function cluster(raw: unknown, variables: string[], nClusters: number): KMeansCluster | null {
  if (!object(raw) || !natural(raw.cluster) || raw.cluster >= nClusters || !natural(raw.count)
    || raw.count === 0
    || !object(raw.centroid)) return null;
  const centroid = raw.centroid;
  if (Object.keys(centroid).length !== variables.length
    || !variables.every((name) => finite(centroid[name]))) return null;
  return { cluster: raw.cluster, count: raw.count, centroid: centroid as Record<string, number> };
}

function point(raw: unknown, clusterIds: Set<number>): KMeansPoint | null {
  if (!object(raw) || !finite(raw.x) || !finite(raw.y) || !natural(raw.cluster)
    || !clusterIds.has(raw.cluster)) return null;
  return { x: raw.x, y: raw.y, cluster: raw.cluster };
}

/** Read only a complete response that still matches the manually submitted configuration. */
export function readKMeans(
  tool: Tool, variables: string[] | undefined, nClusters: number | undefined,
): KMeansReading {
  if (!variables || !nClusters) return { kind: "idle" };
  const problem = toolProblem(tool);
  if (problem) return { kind: "problem", problem };
  if (tool.loading || tool.stale || !tool.data) return { kind: "pending" };
  const raw = tool.data.result;
  if (tool.data.method !== "kmeans_clustering" || !object(raw)
    || raw.kind !== "kmeans" || !sameVariables(raw.variables, variables)
    || raw.n_clusters !== nClusters || !Array.isArray(raw.clusters)
    || raw.clusters.length !== nClusters || !finite(raw.inertia)
    || !(raw.silhouette === null || finite(raw.silhouette))
    || !natural(raw.silhouette_sample_size) || !natural(raw.observations_used)
    || !natural(raw.observations_excluded) || !natural(raw.total_observations)
    || raw.observations_used + raw.observations_excluded !== raw.total_observations
    || !object(raw.projection) || raw.projection.x !== variables[0]
    || raw.projection.y !== variables[1] || raw.projection.uses_all_selected_variables !== true
    || raw.silhouette_sample_size > raw.observations_used || !Array.isArray(raw.points)
    || raw.points.length === 0 || !natural(raw.total_points)
    || raw.total_points !== raw.observations_used || typeof raw.sampled !== "boolean"
    || raw.sampled !== (raw.points.length < raw.total_points)
    || typeof raw.interpretation !== "string") return { kind: "invalid" };

  const clusters = raw.clusters.map((item) => cluster(item, variables, nClusters));
  if (clusters.some((item) => item === null)) return { kind: "invalid" };
  const resolvedClusters = clusters as KMeansCluster[];
  const clusterIds = new Set(resolvedClusters.map((item) => item.cluster));
  if (clusterIds.size !== nClusters || resolvedClusters.reduce((sum, item) => sum + item.count, 0) !== raw.observations_used) {
    return { kind: "invalid" };
  }
  const points = raw.points.map((item) => point(item, clusterIds));
  if (points.some((item) => item === null)) return { kind: "invalid" };
  const result: KMeansResult = {
    kind: "kmeans",
    variables,
    n_clusters: nClusters,
    clusters: resolvedClusters,
    inertia: raw.inertia,
    silhouette: raw.silhouette,
    silhouette_sample_size: raw.silhouette_sample_size,
    observations_used: raw.observations_used,
    observations_excluded: raw.observations_excluded,
    total_observations: raw.total_observations,
    projection: { x: variables[0], y: variables[1], uses_all_selected_variables: true },
    points: points as KMeansPoint[],
    total_points: raw.total_points,
    sampled: raw.sampled,
    interpretation: raw.interpretation,
  };
  return { kind: "ready", view: { result, warnings: tool.data.warnings ?? [] } };
}
