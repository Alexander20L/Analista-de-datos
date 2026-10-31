import { test, expect } from "./api-diagnostics";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnalysisResult } from "../src/types/exploration";
import type { LinearRegressionResult } from "../src/features/associations/linear-regression-contract";

type RegressionResponse = Omit<AnalysisResult, "result"> & { result: LinearRegressionResult };

// For 60 rows the repeating residuals have mean zero, variance 1 and zero
// covariance with X: slope=2.5, intercept=-3, RMSE=1, R²=89975/90023.
function syntheticCsv(rows = 60, onlyOneNumeric = false): string {
  const lines = [onlyOneNumeric ? "entrada,grupo" : "entrada,salida,alternativa,constante,grupo"];
  for (let index = 0; index < rows; index += 1) {
    const x = index - 30;
    const noise = [-1, 1, 1, -1][index % 4];
    lines.push(onlyOneNumeric ? `${x},${"AB"[index % 2]}`
      : `${x},${2.5 * x - 3 + noise},${5 - 2 * x},7,${"AB"[index % 2]}`);
  }
  return `${lines.join("\n")}\n`;
}

const regressionPanel = (page: Page) => page.locator(".linear-regression-panel");
const results = (panel: Locator) => panel.getByRole("region", { name: "Resultados de regresión lineal" });
const executeButton = (panel: Locator) => panel.getByRole("button", { name: "Ejecutar regresión", exact: true });
const isRegression = (url: string) => new URL(url).pathname.endsWith("/tools/linear_regression");

async function openDataset(page: Page, csv = syntheticCsv(), reset = false): Promise<string> {
  if (reset) await page.getByRole("complementary").getByRole("button", { name: "Nuevo análisis", exact: true }).click();
  else await page.goto("/");
  await page.getByLabel("Archivo del dataset", { exact: true }).setInputFiles({
    name: "regression-synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  const intake = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/intake");
  await page.getByRole("button", { name: "Comprender dataset", exact: true }).click();
  const uploaded = await intake;
  expect(uploaded.status()).toBe(200);
  const datasetId = (await uploaded.json()).profile.dataset_id as string;
  const ready = page.waitForResponse((response) => response.url().endsWith("/tools/outliers"));
  await page.getByRole("link", { name: "Explorar asociaciones", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Asociaciones", exact: true })).toBeVisible();
  await ready;
  await expect(regressionPanel(page).getByRole("heading", { name: "Regresión lineal", exact: true })).toBeVisible();
  return datasetId;
}

async function execute(page: Page, panel: Locator): Promise<RegressionResponse> {
  const received = page.waitForResponse((response) => isRegression(response.url()));
  await executeButton(panel).click();
  const response = await received;
  expect(response.status()).toBe(200);
  const payload = await response.json() as RegressionResponse;
  expect(payload.status).toBe("SUCCESS");
  await expect(results(panel)).toBeVisible();
  return payload;
}

function metric(panel: Locator, label: string): Locator {
  return results(panel).getByText(label, { exact: true }).locator("xpath=..").locator(".regression-metric-value");
}

async function capture(target: Locator, name: string, info: TestInfo) {
  const body = await target.screenshot();
  await info.attach(name, { body, contentType: "image/png" });
  if (process.env.UI_SCREENSHOT_DIR) {
    await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await writeFile(join(process.env.UI_SCREENSHOT_DIR, `${name}.png`), body);
  }
}

test("real intake, model metrics, residual diagnostics and responsive layout", async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [], requests: string[][] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (isRegression(request.url())) requests.push(request.postDataJSON().variables);
  });
  const csv = syntheticCsv();
  await info.attach("synthetic-dataset", { body: csv, contentType: "text/csv" });
  const datasetId = await openDataset(page, csv);
  const catalog = await page.request.get("/api/tools");
  expect((await catalog.json()).tools).toContain("linear_regression");
  const panel = regressionPanel(page);
  await panel.getByLabel("Variable independiente (X)").selectOption("entrada");
  await panel.getByLabel("Variable dependiente (Y)").selectOption("entrada");
  await expect(executeButton(panel)).toBeDisabled();
  await expect(panel.getByRole("status")).toContainText("dos variables numéricas diferentes");
  await capture(panel, "regression-duplicate-variables", info);
  await panel.getByLabel("Variable dependiente (Y)").selectOption("salida");
  expect(requests).toEqual([]);
  await capture(panel, "regression-selection-desktop", info);

  const payload = await execute(page, panel);
  expect(requests).toEqual([["entrada", "salida"]]);
  expect(payload.variables).toEqual(["entrada", "salida"]);
  expect(payload.result.slope).toBeCloseTo(2.5, 12);
  expect(payload.result.intercept).toBeCloseTo(-3, 12);
  expect(payload.result.r_squared).toBeCloseTo(89975 / 90023, 12);
  expect(payload.result.rmse).toBeCloseTo(1, 12);
  expect(payload.sample_size).toBe(60);
  expect(payload.result.observations_used).toBe(60);
  expect(payload.result.observations_excluded).toBe(0);
  expect(payload.result.chart.trend).toEqual({ slope: payload.result.slope, intercept: payload.result.intercept });
  const diagnostic = payload.result.residual_diagnostics;
  expect(diagnostic).toBeDefined();
  if (!diagnostic) throw new Error("The real backend must return residual diagnostics");
  expect(diagnostic.total_points).toBe(60);
  expect(diagnostic.sampled).toBe(false);
  expect(diagnostic.points).toHaveLength(60);
  diagnostic.points.forEach(([estimate, error], index) => {
    expect(estimate).toBeCloseTo(2.5 * (index - 30) - 3, 10);
    expect(error).toBeCloseTo([-1, 1, 1, -1][index % 4], 10);
  });
  for (const [label, expected] of [["Pendiente", 2.5], ["Intercepto", -3], ["R²", 89975 / 90023], ["RMSE", 1]] as const) {
    expect(Number(await metric(panel, label).innerText())).toBeCloseTo(expected, 8);
  }
  await expect(results(panel).getByText(payload.result.equation, { exact: false })).toBeVisible();
  await expect(results(panel).getByRole("figure", { name: /Residuos de salida.*entrada/ })).toBeVisible();
  await expect(results(panel).locator(".residual-dot")).toHaveCount(diagnostic.points.length);
  await expect(results(panel).locator(".residual-zero-line")).toHaveCount(1);
  await expect(results(panel).locator(".scatter-dot, .trend-line")).toHaveCount(0);
  await expect(panel.locator(".regression-metrics > div")).toHaveCount(4);
  await expect(panel.getByRole("region", { name: "Interpretación del modelo" })).toContainText("aumenta en 2.5 unidades");
  await expect(panel.getByRole("region", { name: "Interpretación del modelo" })).toContainText("La asociación no implica causalidad");
  const zero = results(panel).locator(".residual-zero-line");
  expect(await zero.getAttribute("y1")).toBe(await zero.getAttribute("y2"));
  await expect(page.getByRole("figure", { name: /Diagrama de dispersión/ })).toHaveCount(1);
  await expect(page.locator(".ranking-card").getByRole("figure")).toBeVisible();
  await expect(page.getByRole("figure", { name: /Matriz de correlación/ })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Histograma de entrada/ })).toBeVisible();
  const clipIds = await page.locator("clipPath").evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(clipIds).size).toBe(clipIds.length);
  await info.attach("real-regression-response", { body: JSON.stringify({ datasetId, payload }, null, 2), contentType: "application/json" });

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await panel.scrollIntoViewIfNeeded();
    await panel.getByLabel("Variable independiente (X)").focus();
    await expect(panel.getByLabel("Variable independiente (X)")).toBeFocused();
    await expect(panel.getByLabel("Variable dependiente (Y)")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await panel.evaluate((element) => [element, ...element.querySelectorAll("select, .regression-metrics > div, .regression-analysis, .regression-equation, .residual-plot-svg")]
      .every((node) => {
        const box = node.getBoundingClientRect();
        return box.left >= 0 && box.right <= window.innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1;
      }))).toBe(true);
    await expect(results(panel).getByRole("figure")).toBeVisible();
    expect(await panel.locator(".regression-metric-value").evaluateAll((nodes) => nodes.every((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getClientRects().length === 1;
    }))).toBe(true);
    expect(await page.getByRole("region", { name: "Relaciones ordenadas" }).evaluate((element) =>
      element.scrollWidth <= element.clientWidth + 1 || getComputedStyle(element).overflowX === "auto")).toBe(true);
    await capture(panel, `regression-results-${width}`, info);
    if (width === 1440 || width === 390) await capture(page.locator("body"), `associations-with-regression-${width}`, info);
  }

  await panel.getByLabel("Variable independiente (X)").selectOption("alternativa");
  await expect(results(panel)).toHaveCount(0);
  expect(requests).toEqual([["entrada", "salida"]]);
  const mobileResult = await execute(page, panel);
  expect(mobileResult.result.slope).toBeCloseTo(-1.25, 12);
  expect(mobileResult.result.intercept).toBeCloseTo(3.25, 12);
  await capture(panel, "regression-mobile-selection", info);

  const replacement = await openDataset(page, syntheticCsv(60, true), true);
  expect(replacement).not.toBe(datasetId);
  await expect(panel.getByText("Se necesitan al menos dos columnas numéricas diferentes.")).toBeVisible();
  await expect(results(panel)).toHaveCount(0);
  await expect(executeButton(panel)).toHaveCount(0);
  expect(requests).toEqual([["entrada", "salida"], ["alternativa", "salida"]]);
  await capture(panel, "regression-new-dataset-insufficient-columns", info);
  expect(errors).toEqual([]);
});

test("real constant variable and insufficient sample return SKIPPED without metrics", async ({ page }, info) => {
  test.setTimeout(90_000);
  await openDataset(page);
  const panel = regressionPanel(page);
  await panel.getByLabel("Variable independiente (X)").selectOption("constante");
  await panel.getByLabel("Variable dependiente (Y)").selectOption("salida");
  let received = page.waitForResponse((response) => isRegression(response.url()));
  await executeButton(panel).click();
  let payload = await (await received).json();
  expect(payload.status).toBe("SKIPPED");
  expect(payload.result).toBeNull();
  await expect(panel.getByRole("status")).toContainText("Una variable constante impide calcular este ajuste");
  await expect(results(panel)).toHaveCount(0);
  await capture(panel, "regression-skipped-constant", info);

  await openDataset(page, syntheticCsv(12), true);
  received = page.waitForResponse((response) => isRegression(response.url()));
  await executeButton(panel).click();
  payload = await (await received).json();
  expect(payload.status).toBe("SKIPPED");
  expect(payload.result).toBeNull();
  await expect(panel.getByRole("status")).toContainText("Hay 12 pares válidos; se necesitan al menos 20");
  await expect(results(panel)).toHaveCount(0);
  await capture(panel, "regression-skipped-small-sample", info);
});

test("changing X while a real response is delayed discards the old result", async ({ page }, info) => {
  test.setTimeout(90_000);
  await openDataset(page);
  const panel = regressionPanel(page);
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const computed = new Promise<void>((resolve) => { reached = resolve; });
  // Delay only delivery of the first genuine Python result; never fabricate metrics.
  await page.route("**/tools/linear_regression", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    reached();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });
  await executeButton(panel).click();
  await computed;
  await expect(panel.getByRole("status")).toContainText("Calculando regresión lineal");
  await panel.getByLabel("Variable independiente (X)").selectOption("alternativa");
  await expect(results(panel)).toHaveCount(0);
  const delivered = page.waitForResponse((response) => isRegression(response.url()));
  release();
  await delivered;
  await expect(results(panel)).toHaveCount(0);
  const payload = await execute(page, panel);
  expect(payload.variables).toEqual(["alternativa", "salida"]);
  expect(payload.result.slope).toBeCloseTo(-1.25, 12);
  expect(payload.result.intercept).toBeCloseTo(3.25, 12);
  await expect(results(panel).getByRole("figure", { name: /Residuos de salida.*alternativa/ })).toBeVisible();
  await expect(results(panel).getByRole("figure", { name: /Residuos de salida.*entrada/ })).toHaveCount(0);
  await capture(panel, "regression-changed-selection", info);
});

test("a genuine HTTP 429 is shown and the manual retry honours Retry-After", async ({ page }, info) => {
  test.setTimeout(150_000);
  const datasetId = await openDataset(page);
  const panel = regressionPanel(page);
  let regressionRequests = 0;
  page.on("request", (request) => { if (isRegression(request.url())) regressionRequests += 1; });
  // Exercise the real guard with cheap sequential requests, without changing quotas.
  let limited = false;
  for (let attempt = 0; attempt <= 60; attempt += 1) {
    const response = await page.request.post(`/api/datasets/${datasetId}/tools/missing_values`, { data: { variables: ["entrada"] } });
    if (response.status() === 429) {
      expect((await response.json()).detail.code).toBe("REQUEST_RATE_LIMITED");
      limited = true;
      break;
    }
    expect(response.status()).toBe(200);
  }
  expect(limited).toBe(true);
  const failed = page.waitForResponse((response) => isRegression(response.url()));
  await executeButton(panel).click();
  const rejected = await failed;
  expect(rejected.status()).toBe(429);
  const retryAfter = Number(rejected.headers()["retry-after"]);
  expect(retryAfter).toBeGreaterThan(0);
  await expect(panel.getByRole("alert")).toContainText("Se alcanzó el límite de solicitudes");
  const availableAt = Date.now() + retryAfter * 1000;
  await expect(results(panel)).toHaveCount(0);
  await capture(panel, "regression-http-429", info);
  await info.attach("real-http-429", { body: JSON.stringify({ status: rejected.status(), retryAfter, body: await rejected.json() }, null, 2), contentType: "application/json" });
  // Long cooldowns fail immediately instead of silently queuing the user's retry.
  // Check that an early click does not hit the backend, then wait the real header.
  await panel.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Se alcanzó el límite de solicitudes");
  expect(regressionRequests).toBe(1);
  await expect.poll(() => Date.now(), { timeout: (retryAfter + 3) * 1000, intervals: [250, 1000] })
    .toBeGreaterThanOrEqual(availableAt);
  const recovered = page.waitForResponse((response) => isRegression(response.url()), { timeout: 90_000 });
  await panel.getByRole("button", { name: "Reintentar", exact: true }).click();
  expect((await recovered).status()).toBe(200);
  await expect(results(panel)).toBeVisible();
  await expect(metric(panel, "Pendiente")).toHaveText("2.5");
  await capture(panel, "regression-retry-success", info);
});
