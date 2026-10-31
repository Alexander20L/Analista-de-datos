import { useEffect, useId, useMemo, useState, type PointerEvent } from "react";
import { ChartFrame, useChartTooltip } from "../../components/charts/ChartTooltip";
import { formatTick, linearScale, niceDomain, niceTicks } from "../../components/charts/chart-utils";
import type { ResidualDiagnostics } from "./linear-regression-contract";
import { formatRegressionNumber } from "./linear-regression-interpretation";

const HEIGHT = 280;
const M = { left: 58, right: 18, top: 28, bottom: 48 };
const axisNumber = (value: number) => value !== 0 && Math.abs(value) < 0.001 ? value.toExponential(1) : formatTick(value);

function drawableDomain(low: number, high: number): [number, number] | null {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (low === high) {
    const padding = Math.max(1, Math.abs(low) * 0.01);
    low -= padding;
    high += padding;
  }
  // A tick must advance at both ends in float64. Otherwise the shared tick
  // generator can loop forever on a narrow range around a very large offset.
  const step = (high - low) / 4;
  const resolution = Math.max(Math.abs(low), Math.abs(high)) * Number.EPSILON;
  if (![step, low + step, high + step].every(Number.isFinite)
    || step <= resolution || step <= 0 || low + step === low || high + step === high) return null;
  const domain = niceDomain(low, high);
  return domain.every(Number.isFinite) && domain[0] < domain[1] ? domain : null;
}

/** Draws backend-supplied errors against estimates. Only display geometry is computed here. */
export function ResidualPlot({ diagnostic }: { diagnostic: ResidualDiagnostics }) {
  const clipId = useId();
  const { frame, hide, fromPointer, tooltip } = useChartTooltip();
  const [width, setWidth] = useState(640);
  const geometry = useMemo(() => {
    let minEstimate = Infinity, maxEstimate = -Infinity, low = 0, high = 0;
    for (const [estimate, error] of diagnostic.points) {
      minEstimate = Math.min(minEstimate, estimate);
      maxEstimate = Math.max(maxEstimate, estimate);
      low = Math.min(low, error);
      high = Math.max(high, error);
    }
    const padding = (high - low) * 0.1;
    const xd = drawableDomain(minEstimate, maxEstimate);
    const yd = drawableDomain(low - padding, high + padding);
    if (!xd || !yd) return null;
    return {
      sx: linearScale(xd, [M.left, width - M.right]),
      sy: linearScale(yd, [HEIGHT - M.bottom, M.top]),
      xTicks: niceTicks(...xd, width < 400 ? 3 : 5), yTicks: niceTicks(...yd),
    };
  }, [diagnostic, width]);
  const drawable = geometry !== null;
  useEffect(() => {
    if (!drawable || !frame.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(220, entry.contentRect.width));
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [frame, drawable]);

  if (!geometry) return <p role="status">La escala numérica de estos residuos no permite representar el diagnóstico con seguridad.
    Las métricas del modelo se conservan.</p>;
  const { sx, sy, xTicks, yTicks } = geometry;

  function nearest(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const py = ((event.clientY - box.top) / box.height) * HEIGHT;
    let best = -1, distance = 32 ** 2;
    diagnostic.points.forEach(([estimate, error], index) => {
      const candidate = (sx(estimate) - px) ** 2 + (sy(error) - py) ** 2;
      if (candidate < distance) { best = index; distance = candidate; }
    });
    if (best < 0) { hide(); return; }
    const [estimate, error] = diagnostic.points[best];
    fromPointer(event, "Error del ajuste", [
      { label: "Y estimado", value: formatRegressionNumber(estimate) },
      { label: "Residuo", value: formatRegressionNumber(error) },
    ]);
  }

  return <ChartFrame frame={frame} onLeave={hide}
    label={`Residuos de ${diagnostic.y} frente a valores estimados con ${diagnostic.x}, ${diagnostic.points.length} puntos`}>
    <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="residual-plot-svg">
      <defs><clipPath id={clipId}><rect x={M.left} y={M.top} width={width - M.left - M.right} height={HEIGHT - M.top - M.bottom} /></clipPath></defs>
      {yTicks.map((tick) => <g key={`y-${tick}`}>
        <line x1={M.left} x2={width - M.right} y1={sy(tick)} y2={sy(tick)} className="residual-grid" />
        <text x={M.left - 8} y={sy(tick)} textAnchor="end" dominantBaseline="middle" className="residual-tick">{axisNumber(tick)}</text>
      </g>)}
      {xTicks.map((tick) => <text key={`x-${tick}`} x={sx(tick)} y={HEIGHT - M.bottom + 18}
        textAnchor="middle" className="residual-tick">{axisNumber(tick)}</text>)}
      <g clipPath={`url(#${clipId})`}>
        <line x1={M.left} x2={width - M.right} y1={sy(0)} y2={sy(0)} className="residual-zero-line" />
        {diagnostic.points.map(([estimate, error], index) =>
          <circle key={index} cx={sx(estimate)} cy={sy(error)} r={3.5} className="residual-dot" />)}
      </g>
      <text x={width - M.right} y={16} textAnchor="end" className="residual-reference">Referencia: residuo 0</text>
      <text x={(M.left + width - M.right) / 2} y={HEIGHT - 5} textAnchor="middle" className="residual-axis">Y estimado</text>
      <text transform={`translate(12, ${(M.top + HEIGHT - M.bottom) / 2}) rotate(-90)`}
        textAnchor="middle" className="residual-axis">Residuo (Y − Ŷ)</text>
      <rect x={M.left} y={M.top} width={width - M.left - M.right} height={HEIGHT - M.top - M.bottom}
        fill="transparent" onPointerMove={nearest} />
    </svg>
    {tooltip}
  </ChartFrame>;
}
