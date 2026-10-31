import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ResidualDiagnostics } from "./linear-regression-contract";
import { ResidualPlot } from "./ResidualPlot";

const diagnostic: ResidualDiagnostics = { kind: "residuals", x: "x", y: "y", points: [[1, -1], [2, 0], [3, 1]], total_points: 3, sampled: false };
afterEach(() => vi.unstubAllGlobals());

it("dibuja los errores recibidos por encima y debajo de cero sin recta de ajuste", () => {
  const { container } = render(<ResidualPlot diagnostic={diagnostic} />);
  expect(screen.getByRole("figure", { name: /Residuos de y.*x/ })).toBeVisible();
  const line = container.querySelector(".residual-zero-line")!;
  expect(line.getAttribute("y1")).toBe(line.getAttribute("y2"));
  const dots = container.querySelectorAll(".residual-dot");
  expect(dots).toHaveLength(3);
  const zero = Number(line.getAttribute("y1"));
  expect(Number(dots[0].getAttribute("cy"))).toBeGreaterThan(zero);
  expect(Number(dots[1].getAttribute("cy"))).toBe(zero);
  expect(Number(dots[2].getAttribute("cy"))).toBeLessThan(zero);
  expect(container.querySelector(".trend-line, .scatter-dot")).not.toBeInTheDocument();
  expect(screen.getByText("Y estimado")).toBeVisible();
  expect(screen.getByText("Residuo (Y − Ŷ)")).toBeVisible();
});

it("residuos todos cero tienen dominio finito y coinciden con la referencia", () => {
  const { container } = render(<ResidualPlot diagnostic={{ ...diagnostic, points: [[1, 0], [2, 0]] }} />);
  const line = container.querySelector(".residual-zero-line")!;
  const zero = Number(line.getAttribute("y1"));
  expect(Number.isFinite(zero)).toBe(true);
  for (const dot of container.querySelectorAll(".residual-dot")) expect(Number(dot.getAttribute("cy"))).toBe(zero);
});

it("conserva las referencias pequeñas en notación científica", () => {
  const { container } = render(<ResidualPlot diagnostic={{ ...diagnostic, points: [[1, -1e-14], [2, 1e-14]] }} />);
  expect(container.querySelector(".residual-tick")?.textContent).toMatch(/e-/);
  expect(container.innerHTML).not.toContain("NaN");
});

it("adapta el viewBox al ancho observado y libera el observador al desmontar", () => {
  let resize!: (entries: ResizeObserverEntry[]) => void;
  const disconnect = vi.fn();
  class Observer {
    constructor(callback: (entries: ResizeObserverEntry[]) => void) { resize = callback; }
    observe() { resize([{ contentRect: { width: 280 } } as ResizeObserverEntry]); }
    disconnect = disconnect;
  }
  vi.stubGlobal("ResizeObserver", Observer);
  const { container, unmount } = render(<ResidualPlot diagnostic={diagnostic} />);
  expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 280 280");
  act(() => resize([{ contentRect: { width: 560 } } as ResizeObserverEntry]));
  expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 560 280");
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("una escala finita estrecha cerca de 1e16 no bloquea el renderizado", () => {
  render(<ResidualPlot diagnostic={{ ...diagnostic, points: [[1e16 - 2, -1], [1e16, 0], [1e16 + 2, 1]] }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Las métricas del modelo se conservan");
  expect(screen.queryByRole("figure")).not.toBeInTheDocument();
});

it("rangos extremos que desbordan la geometría no generan coordenadas inválidas", () => {
  const { container } = render(<ResidualPlot diagnostic={{ ...diagnostic, points: [[1, -1e308], [2, 1e308]] }} />);
  expect(screen.getByRole("status")).toHaveTextContent("escala numérica");
  expect(container.querySelector("svg")).not.toBeInTheDocument();
});

it("una estimación constante de gran magnitud puede dibujarse con un dominio finito", () => {
  const { container } = render(<ResidualPlot diagnostic={{ ...diagnostic, points: [[1e16, -1], [1e16, 1]] }} />);
  expect(screen.getByRole("figure")).toBeInTheDocument();
  for (const dot of container.querySelectorAll(".residual-dot")) {
    expect(Number.isFinite(Number(dot.getAttribute("cx")))).toBe(true);
    expect(Number.isFinite(Number(dot.getAttribute("cy")))).toBe(true);
  }
});
