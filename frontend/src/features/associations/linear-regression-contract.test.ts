import { describe, expect, it } from "vitest";
import { regressionFixture } from "../../test/linear-regression-fixture";
import { readLinearRegression, type RegressionContext } from "./linear-regression-contract";

const context: RegressionContext = { datasetId: "ds", x: "amount", y: "price", totalRows: 42 };
const read = (data: unknown, requested = context, active = context) => readLinearRegression(data, requested, active);
const raw = () => structuredClone(regressionFixture()) as unknown as Record<string, unknown>;
const values = (data: Record<string, unknown>) => data.result as Record<string, unknown>;
const chart = (data: Record<string, unknown>) => values(data).chart as Record<string, unknown>;

describe("contrato de regresión lineal", () => {
  it("acepta un resultado completo sin modificarlo ni recalcular sus métricas", () => {
    const data = regressionFixture(), before = structuredClone(data);
    const outcome = read(data);
    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") throw new Error("Resultado esperado");
    expect(outcome.result).toBe(data.result);
    expect(outcome.result.r_squared).toBe(0.9);
    expect(outcome.result.rmse).toBe(0.5);
    expect(data).toEqual(before);
  });

  it("conserva los ceros y coeficientes pequeños válidos", () => {
    const data = raw();
    Object.assign(values(data), { slope: 1e-10, intercept: 0, r_squared: 0, rmse: 0 });
    chart(data).trend = { slope: 1e-10, intercept: 0 };
    const outcome = read(data);
    expect(outcome.kind).toBe("ready");
    if (outcome.kind === "ready") expect(outcome.result.intercept).toBe(0);
  });

  it("acepta puntos sin muestreo cuando corresponden a todas las observaciones válidas", () => {
    const data = raw();
    Object.assign(values(data), { observations_used: 3, observations_excluded: 39 });
    data.sample_size = 3;
    Object.assign(chart(data), { total_points: 3, sampled: false });
    Object.assign(values(data).residual_diagnostics as object, { total_points: 3, sampled: false });
    expect(read(data).kind).toBe("ready");
  });

  it.each(["absent", "null"])("acepta respuestas anteriores con diagnóstico %s", (variant) => {
    const data = raw();
    if (variant === "absent") delete values(data).residual_diagnostics;
    else values(data).residual_diagnostics = null;
    expect(read(data).kind).toBe("ready");
  });

  it.each([
    { kind: "scatter" }, { x: "other" }, { y: "other" }, { total_points: 39 },
    { sampled: false }, { points: [] }, { points: [[3, 0]] },
    { points: [[3, 0], [5, 0], [7, Infinity]] },
    { points: [[3, 0], [5, 0], [null, 0]] },
    { points: [[3, 0], [5, 0], [7, "0"]] },
    { points: [[3, 0], [5, 0], [7, 0, 1]] },
  ])("rechaza diagnóstico malformado sin dibujar datos inválidos: %j", (change) => {
    const data = raw();
    Object.assign(values(data).residual_diagnostics as object, change);
    expect(read(data).kind).toBe("invalid");
  });

  it("acepta un R² ligeramente negativo por redondeo sin reemplazarlo por cero", () => {
    const data = raw();
    values(data).r_squared = -Number.EPSILON;
    const outcome = read(data);
    expect(outcome.kind).toBe("ready");
    if (outcome.kind === "ready") expect(outcome.result.r_squared).toBe(-Number.EPSILON);
  });

  it.each(["SKIPPED", "FAILED"])("acepta %s sin estadísticas", (status) => {
    const data = { ...raw(), status, result: null, sample_size: null };
    expect(read(data)).toEqual({ kind: status === "SKIPPED" ? "skipped" : "failed", warnings: ["Aviso del backend"] });
    expect(read({ ...data, result: { slope: 0 } }).kind).toBe("invalid");
    expect(read({ ...data, p_value: 0.01 }).kind).toBe("invalid");
  });

  it.each([null, undefined, [], {}, { status: "SUCCESS" }])("rechaza envelopes incompletos: %j", (data) => {
    expect(read(data).kind).toBe("invalid");
  });

  it.each([
    { datasetId: "other" }, { x: "price", y: "amount" }, { x: "quantity" }, { totalRows: 43 },
  ])("rechaza un contexto de solicitud anterior: %j", (change) => {
    expect(read(regressionFixture(), { ...context, ...change }).kind).toBe("invalid");
    expect(read(regressionFixture(), context, { ...context, ...change }).kind).toBe("invalid");
  });

  it.each([
    { datasetId: "" }, { x: "" }, { y: "amount" }, { totalRows: NaN }, { totalRows: -1 },
  ])("rechaza contexto activo inválido: %j", (change) => {
    const active = { ...context, ...change };
    expect(read(regressionFixture(), active, active).kind).toBe("invalid");
  });

  it.each([
    { method: "pearson" }, { variables: ["price", "amount"] }, { variables: ["amount"] },
    { status: "UNKNOWN" }, { completeness: "partial" }, { column_results: { amount: {} } },
    { warnings: [null] }, { sample_size: 39 },
  ])("rechaza un envelope incompatible: %j", (change) => {
    expect(read({ ...raw(), ...change }).kind).toBe("invalid");
  });

  const invalidMetrics = ["slope", "intercept", "r_squared", "rmse"].flatMap((metric) =>
    [null, undefined, "0", NaN, Infinity, -Infinity].map((value) => ({ metric, value })));
  it.each(invalidMetrics)("rechaza $metric no numérica o ausente: $value", ({ metric, value }) => {
    const data = raw();
    values(data)[metric] = value;
    expect(read(data).kind).toBe("invalid");
  });

  it.each([
    { x: "price" }, { y: "amount" }, { r_squared: 1.01 }, { r_squared: -1 }, { rmse: -1 },
    { observations_used: 0 }, { observations_used: 1.5 }, { observations_used: 41 },
    { observations_excluded: -1 }, { observations_excluded: null },
    { observations_excluded: 3 }, { equation: "" }, { equation: null }, { chart: null },
  ])("rechaza valores incompatibles: %j", (change) => {
    const data = raw();
    Object.assign(values(data), change);
    expect(read(data).kind).toBe("invalid");
  });

  it.each([
    { kind: "boxplot" }, { x: "price" }, { y: "amount" }, { total_points: 39 },
    { sampled: false }, { sampled: "true" }, { trend: null },
    { trend: { slope: 3, intercept: 1 } }, { trend: { slope: 2, intercept: 0 } },
    { points: [] }, { points: [[1, 3]] }, { points: [[1, 3], [2, null]] },
    { points: [[1, 3], [2, Infinity]] }, { points: [[1, 3], [2, "5"]] },
    { points: [[1, 3], [2, 5, 8]] }, { points: null },
  ])("rechaza un gráfico inválido o una recta diferente: %j", (change) => {
    const data = raw();
    Object.assign(chart(data), change);
    expect(read(data).kind).toBe("invalid");
  });
});
