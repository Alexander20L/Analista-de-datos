import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ScatterChart } from "../../types/exploration";
import { ScatterPlot } from "./ScatterPlot";

const chart: ScatterChart = { kind: "scatter", x: "x", y: "y", points: [[1, 3], [2, 5], [3, 7]],
  total_points: 3, sampled: false, trend: { slope: 2, intercept: 1 } };

it("cada scatter usa su propio clipPath y conserva los puntos y la recta", () => {
  const view = render(<><ScatterPlot chart={chart} /><ScatterPlot chart={{ ...chart, x: "other" }} /></>);
  const ids = screen.getAllByRole("figure").map((figure) => {
    const id = figure.querySelector("clipPath")?.id;
    expect(id).toBeTruthy();
    expect(figure.querySelector("g[clip-path]")).toHaveAttribute("clip-path", `url(#${id})`);
    expect(figure.querySelectorAll(".scatter-dot")).toHaveLength(3);
    const line = figure.querySelector(".trend-line")!;
    for (const coordinate of ["x1", "x2", "y1", "y2"]) expect(Number.isFinite(Number(line.getAttribute(coordinate)))).toBe(true);
    return id;
  });
  expect(new Set(ids).size).toBe(2);
  view.rerender(<><ScatterPlot chart={chart} /><ScatterPlot chart={chart} /></>);
  expect(screen.getAllByRole("figure").map((figure) => figure.querySelector("clipPath")?.id)).toEqual(ids);
});

it("conserva la representación anterior sin recta y el estado stale", () => {
  const { container } = render(<ScatterPlot chart={{ ...chart, trend: null }} stale />);
  expect(screen.getByRole("figure")).toHaveClass("stale");
  expect(container.querySelectorAll(".scatter-dot")).toHaveLength(3);
  expect(container.querySelector(".trend-line")).not.toBeInTheDocument();
});
