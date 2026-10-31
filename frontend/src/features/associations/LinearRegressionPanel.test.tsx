import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "../../lib/api-client";
import { App } from "../../app/App";
import { associationsIntakeFixture, toolFixtures } from "../../test/fixture";
import { regressionFixture } from "../../test/linear-regression-fixture";
import type { AnalysisResult } from "../../types/exploration";
import { LinearRegressionPanel } from "./LinearRegressionPanel";

const defaults = { datasetId: "ds", numeric: ["amount", "price", "quantity"], totalRows: 42 };
const panel = (props = defaults) => <MemoryRouter><LinearRegressionPanel {...props} /></MemoryRouter>;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const button = () => screen.getByRole("button", { name: "Ejecutar regresión" });
const results = () => screen.queryByRole("region", { name: "Resultados de regresión lineal" });
const metric = (label: string) => {
  const definition = screen.getByText(label, { selector: "dt" }).nextElementSibling;
  return definition?.querySelector(".regression-metric-value") ?? definition;
};

function mockBackend() {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const { variables } = JSON.parse(String(init?.body)) as { variables: string[] };
    return response(regressionFixture(variables[0], variables[1]));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("presenta selectores etiquetados y no ejecuta al abrir ni al cambiar variables", async () => {
  const fetch = mockBackend(), user = userEvent.setup();
  render(panel());
  expect(screen.getByRole("heading", { name: "Regresión lineal" })).toBeVisible();
  expect(screen.getByLabelText("Variable independiente (X)")).toHaveValue("amount");
  expect(screen.getByLabelText("Variable dependiente (Y)")).toHaveValue("price");
  await user.selectOptions(screen.getByLabelText("Variable independiente (X)"), "quantity");
  expect(fetch).not.toHaveBeenCalled();
  expect(results()).not.toBeInTheDocument();
  await user.click(button());
  await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("/api/datasets/ds/tools/linear_regression");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(String(init?.body))).toEqual({ variables: ["quantity", "price"], parameters: {} });
});

it("impide ejecutar con variables iguales y permite corregir la selección", async () => {
  const fetch = mockBackend(), user = userEvent.setup();
  render(panel());
  await user.selectOptions(screen.getByLabelText("Variable dependiente (Y)"), "amount");
  expect(screen.getByRole("status")).toHaveTextContent("dos variables numéricas diferentes");
  expect(button()).toBeDisabled();
  await user.click(button());
  expect(fetch).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText("Variable dependiente (Y)"), "price");
  expect(button()).toBeEnabled();
});

it("presenta modelo, tarjetas, diagnóstico e interpretación sin duplicar el scatter", async () => {
  mockBackend();
  render(panel());
  await userEvent.setup().click(button());
  const region = await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  expect(metric("Pendiente")).toHaveTextContent("2");
  expect(metric("Intercepto")).toHaveTextContent("1");
  expect(metric("R²")).toHaveTextContent("0.9");
  expect(metric("RMSE")).toHaveTextContent("0.5");
  expect(metric("Observaciones utilizadas")).toHaveTextContent("40");
  expect(metric("Observaciones excluidas")).toHaveTextContent("2");
  expect(within(region).getByText("ŷ = 2 × X +1", { exact: false })).toBeVisible();
  expect(within(region).getByRole("heading", { name: "Modelo calculado" })).toBeVisible();
  expect(within(region).getByRole("figure", { name: /Residuos de price.*amount, 3 puntos/ })).toBeVisible();
  expect(region.querySelectorAll(".residual-dot")).toHaveLength(3);
  expect(region.querySelector(".residual-zero-line")).toBeInTheDocument();
  expect(region.querySelector(".scatter-dot, .trend-line")).not.toBeInTheDocument();
  expect(region.querySelectorAll(".regression-metrics > div")).toHaveLength(4);
  expect(screen.getByText(/Magnitud del error de ajuste, expresada en unidades de Y/)).toBeVisible();
  expect(screen.getByRole("region", { name: "Información del análisis" })).toHaveTextContent("amount");
  expect(screen.getByRole("region", { name: "Interpretación del modelo" })).toHaveTextContent("aumenta en 2 unidades");
  expect(screen.getByText("Aviso del backend")).toBeVisible();
  expect(screen.getByText(/El diagnóstico contiene 3 de 40 residuos/)).toBeVisible();
  expect(screen.getByText(/La asociación no implica causalidad/)).toBeVisible();
});

it("no redondea un coeficiente pequeño a cero al presentarlo", async () => {
  const data = regressionFixture();
  const raw = data.result as Record<string, unknown>;
  raw.slope = 1e-10;
  (raw.chart as { trend: { slope: number } }).trend.slope = 1e-10;
  vi.stubGlobal("fetch", vi.fn(async () => response(data)));
  render(panel());
  await userEvent.setup().click(button());
  await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  expect(metric("Pendiente")).toHaveTextContent("0.0000000001");
});

it("una respuesta antigua conserva métricas y explica que no incluye residuos sin mostrar el scatter", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response(regressionFixture("amount", "price", false))));
  render(panel());
  await userEvent.setup().click(button());
  await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  expect(metric("Pendiente")).toHaveTextContent("2");
  expect(screen.getByRole("status")).toHaveTextContent("Esta respuesta no incluye el diagnóstico de residuos");
  expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Interpretación del modelo" })).toBeVisible();
});

it("una escala extrema omite solo el gráfico y conserva las métricas calculadas", async () => {
  const data = regressionFixture();
  const raw = data.result as Record<string, unknown>;
  Object.assign(raw, { intercept: 1e16, r_squared: 1, rmse: 0, equation: "ŷ = 2 × X +1e+16" });
  raw.chart = { kind: "scatter", x: "amount", y: "price", points: [[-1, 1e16 - 2], [0, 1e16], [1, 1e16 + 2]],
    total_points: 40, sampled: true, trend: { slope: 2, intercept: 1e16 } };
  raw.residual_diagnostics = { kind: "residuals", x: "amount", y: "price",
    points: [[1e16 - 2, 0], [1e16, 0], [1e16 + 2, 0]], total_points: 40, sampled: true };
  vi.stubGlobal("fetch", vi.fn(async () => response(data)));
  render(panel());
  await userEvent.setup().click(button());
  await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  expect(metric("Pendiente")).toHaveTextContent("2");
  expect(metric("RMSE")).toHaveTextContent("0");
  expect(screen.getByRole("status")).toHaveTextContent("Las métricas del modelo se conservan");
  expect(screen.queryByRole("figure")).not.toBeInTheDocument();
});

it("muestra procesamiento y evita solicitudes duplicadas", async () => {
  let complete!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
  vi.stubGlobal("fetch", fetch);
  render(panel());
  await userEvent.setup().dblClick(button());
  expect(screen.getByRole("status")).toHaveTextContent("Calculando regresión lineal");
  expect(button()).toBeDisabled();
  expect(results()).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => complete(response(regressionFixture())));
  expect(results()).toBeInTheDocument();
});

it.each(["SKIPPED", "FAILED"] as const)("explica %s sin mostrar estadísticas y permite reintentar", async (status) => {
  const failed = { ...regressionFixture(), status, result: null, sample_size: null, warnings: ["Detalle del cálculo"] };
  const fetch = vi.fn().mockResolvedValueOnce(response(failed)).mockResolvedValueOnce(response(regressionFixture()));
  vi.stubGlobal("fetch", fetch);
  render(panel());
  const user = userEvent.setup();
  await user.click(button());
  const notice = await screen.findByRole(status === "SKIPPED" ? "status" : "alert");
  expect(notice).toHaveTextContent(status === "SKIPPED" ? "no es aplicable" : "El cálculo falló");
  expect(notice).toHaveTextContent("Detalle del cálculo");
  expect(results()).not.toBeInTheDocument();
  await user.click(within(notice).getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("region", { name: "Resultados de regresión lineal" })).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([null, { slope: null }, { ...regressionFixture().result as object, rmse: null }])("rechaza resultado incompleto: %j", async (result) => {
  vi.stubGlobal("fetch", vi.fn(async () => response({ ...regressionFixture(), result })));
  render(panel());
  await userEvent.setup().click(button());
  expect(await screen.findByRole("alert")).toHaveTextContent("respuesta de regresión es inválida");
  expect(results()).not.toBeInTheDocument();
  expect(screen.queryByRole("figure")).not.toBeInTheDocument();
});

it("ofrece reintento después de una respuesta inválida", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ ...regressionFixture(), variables: ["price", "amount"] }))
    .mockResolvedValueOnce(response(regressionFixture()));
  vi.stubGlobal("fetch", fetch);
  render(panel());
  const user = userEvent.setup();
  await user.click(button());
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("region", { name: "Resultados de regresión lineal" })).toBeVisible();
});

it("muestra errores HTTP y su identificador y reintenta la misma petición", async () => {
  const error = new Response(JSON.stringify({ detail: { message: "Servicio temporalmente no disponible" } }),
    { status: 503, headers: { "X-Request-ID": "request-503" } });
  const fetch = vi.fn().mockResolvedValueOnce(error).mockResolvedValueOnce(response(regressionFixture()));
  vi.stubGlobal("fetch", fetch);
  render(panel());
  const user = userEvent.setup();
  await user.click(button());
  const notice = await screen.findByRole("alert");
  expect(notice).toHaveTextContent("Servicio temporalmente no disponible");
  expect(notice).toHaveTextContent("request-503");
  await user.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
});

it("muestra un error de red y permite volver a ejecutar", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Sin conexión")).mockResolvedValueOnce(response(regressionFixture()));
  vi.stubGlobal("fetch", fetch);
  render(panel());
  const user = userEvent.setup();
  await user.click(button());
  expect(await screen.findByRole("alert")).toHaveTextContent("No se puede conectar con el backend");
  await user.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("region", { name: "Resultados de regresión lineal" })).toBeVisible();
});

it("explica dataset expirado y ofrece volver a subir sin reintento inútil", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response({ detail: { code: "DATASET_NOT_FOUND", message: "expired" } }, 404)));
  render(panel());
  await userEvent.setup().click(button());
  expect(await screen.findByRole("alert")).toHaveTextContent("El dataset ya no está disponible");
  expect(screen.getByRole("link", { name: "Volver a subir dataset" })).toHaveAttribute("href", "/");
  expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  expect(button()).toBeDisabled();
});

it("oculta resultados al cambiar variables, incluso al regresar al par anterior", async () => {
  const fetch = mockBackend(), user = userEvent.setup();
  render(panel());
  await user.click(button());
  await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  await user.selectOptions(screen.getByLabelText("Variable independiente (X)"), "quantity");
  expect(results()).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Variable independiente (X)"), "amount");
  expect(results()).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("el cambio de dataset reinicia resultados y requiere una nueva ejecución explícita", async () => {
  const fetch = mockBackend(), user = userEvent.setup();
  const view = render(panel());
  await user.click(button());
  await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  view.rerender(panel({ ...defaults, datasetId: "new-dataset" }));
  expect(results()).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  await user.click(button());
  await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  expect(fetch.mock.calls[1][0]).toBe("/api/datasets/new-dataset/tools/linear_regression");
});

it.each(["selection", "dataset", "unmount"])("descarta una respuesta tardía tras %s aunque el transporte ignore abort", async (change) => {
  let complete!: (value: AnalysisResult) => void;
  const run = vi.spyOn(api, "runTool").mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
    .mockResolvedValue(regressionFixture("quantity", "price"));
  const user = userEvent.setup(), view = render(panel());
  await user.click(button());
  const signal = run.mock.calls[0][3];
  if (change === "selection") {
    await user.selectOptions(screen.getByLabelText("Variable independiente (X)"), "quantity");
    await user.click(button());
    await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  } else if (change === "dataset") view.rerender(panel({ ...defaults, datasetId: "new-dataset" }));
  else view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => complete(regressionFixture()));
  if (change === "selection") {
    expect(screen.getByRole("figure", { name: /Residuos de price.*quantity/ })).toBeVisible();
    expect(screen.queryByRole("figure", { name: /Residuos de price.*amount/ })).not.toBeInTheDocument();
  } else expect(results()).not.toBeInTheDocument();
});

it("sin dataset o sin dos columnas numéricas no permite enviar solicitudes", () => {
  const fetch = mockBackend();
  const view = render(<MemoryRouter><LinearRegressionPanel numeric={[]} totalRows={0} /></MemoryRouter>);
  expect(screen.getByText(/Primero sube un dataset/)).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  view.rerender(panel({ ...defaults, numeric: ["amount"] }));
  expect(screen.getByText(/al menos dos columnas numéricas/)).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ["amount vs price: 12 complete observations; at least 20 are required.", "Hay 12 pares válidos; se necesitan al menos 20"],
  ["Linear regression needs non-constant X and Y among the valid pairs.", "Una variable constante impide calcular este ajuste"],
])("explica en español por qué el backend omite el ajuste: %s", async (note, expected) => {
  vi.stubGlobal("fetch", vi.fn(async () => response({ ...regressionFixture(), status: "SKIPPED",
    result: null, sample_size: null, warnings: [note] })));
  render(panel());
  await userEvent.setup().click(button());
  expect(await screen.findByRole("status")).toHaveTextContent(expected);
  expect(results()).not.toBeInTheDocument();
});

it("convive con ranking, matriz y distribución en Asociaciones sin ejecutar automáticamente", async () => {
  const intake = { ...associationsIntakeFixture, profile: { ...associationsIntakeFixture.profile, row_count: 42 } };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/intake")) return response(intake);
    const name = url.split("/tools/")[1];
    if (name === "linear_regression") return response(regressionFixture());
    let payload = toolFixtures[name];
    if (name === "chart_boxplot" && JSON.parse(String(init?.body)).variables.length === 1) {
      const legacy = payload as { result: object };
      payload = { ...legacy, result: { ...legacy.result, group_by: null } };
    }
    return response(payload);
  });
  vi.stubGlobal("fetch", fetch);
  render(<MemoryRouter><App /></MemoryRouter>);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Archivo del dataset"), new File(["a\n1\n"], "sales.csv"));
  await user.click(screen.getByRole("button", { name: "Comprender dataset" }));
  await user.click(await screen.findByRole("link", { name: "Explorar asociaciones" }));
  await screen.findByRole("region", { name: "Relaciones ordenadas" });
  await screen.findByRole("figure", { name: /Matriz de correlación/ });
  await screen.findByRole("figure", { name: /Histograma de amount/ });
  expect(screen.getByRole("heading", { name: "Regresión lineal" })).toBeVisible();
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/tools/linear_regression"))).toBe(false);
  await user.click(button());
  await screen.findByRole("region", { name: "Resultados de regresión lineal" });
  expect(screen.getAllByRole("figure", { name: /Diagrama de dispersión de price frente a amount/ })).toHaveLength(1);
  expect(screen.getByRole("figure", { name: /Residuos de price.*amount/ })).toBeVisible();
  expect(screen.getByRole("region", { name: "Relaciones ordenadas" })).toBeVisible();
  expect(screen.getByRole("figure", { name: /Matriz de correlación/ })).toBeVisible();
  expect(screen.getByRole("figure", { name: /Histograma de amount/ })).toBeVisible();
});
