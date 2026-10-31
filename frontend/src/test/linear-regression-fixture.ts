import type { AnalysisResult } from "../types/exploration";

/** Synthetic full-data metrics with three displayed points from forty valid pairs. */
export function regressionFixture(x = "amount", y = "price", diagnostic = true): AnalysisResult {
  return {
    analysis_id: "regression-test", method: "linear_regression", variables: [x, y], status: "SUCCESS",
    p_value: null, effect_size: null, sample_size: 40, execution_time: 0.01,
    completeness: "complete", column_results: {}, metadata: {}, warnings: ["Aviso del backend"],
    result: {
      x, y, slope: 2, intercept: 1, r_squared: 0.9, rmse: 0.5,
      observations_used: 40, observations_excluded: 2, equation: "ŷ = 2 × X +1",
      chart: { kind: "scatter", x, y, points: [[1, 3], [2, 5], [3, 7]], total_points: 40,
        sampled: true, trend: { slope: 2, intercept: 1 } },
      ...(diagnostic ? { residual_diagnostics: { kind: "residuals", x, y,
        points: [[3, 0], [5, 0], [7, 0]], total_points: 40, sampled: true } } : {}),
    },
  };
}
