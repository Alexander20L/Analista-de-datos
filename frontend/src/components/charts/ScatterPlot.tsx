import { useId, useMemo, useState, type PointerEvent } from "react";
import type { ScatterChart } from "../../types/exploration";
import { ChartFrame, useChartTooltip } from "./ChartTooltip";
import { formatTick, formatValue, linearScale, niceDomain, niceTicks, truncate } from "./chart-utils";

const W = 640;
const H = 380;
const M = { top: 16, right: 24, bottom: 48, left: 64 };

export function ScatterPlot({ chart, stale }: { chart: ScatterChart; stale?: boolean }) {
  const clipId = useId();
  const { frame, hide, fromPointer, tooltip } = useChartTooltip();
  const [active, setActive] = useState<number | null>(null);
  const { sx, sy, xTicks, yTicks, xDomain } = useMemo(() => {
    const xs = chart.points.map(([x]) => x);
    const ys = chart.points.map(([, y]) => y);
    const xd = niceDomain(Math.min(...xs), Math.max(...xs));
    const yd = niceDomain(Math.min(...ys), Math.max(...ys));
    return {
      sx: linearScale(xd, [M.left, W - M.right]), sy: linearScale(yd, [H - M.bottom, M.top]),
      xTicks: niceTicks(...xd), yTicks: niceTicks(...yd), xDomain: xd,
    };
  }, [chart]);

  function nearest(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const py = ((event.clientY - box.top) / box.height) * H;
    let best = -1;
    let distance = Infinity;
    chart.points.forEach(([x, y], index) => {
      const d = (sx(x) - px) ** 2 + (sy(y) - py) ** 2;
      if (d < distance) { distance = d; best = index; }
    });
    if (best < 0 || distance > 40 ** 2) { setActive(null); hide(); return; }
    const [x, y] = chart.points[best];
    setActive(best);
    fromPointer(event, "Observación", [{ label: chart.x, value: formatValue(x) }, { label: chart.y, value: formatValue(y) }]);
  }

  const trend = chart.trend;
  const fit = trend && xDomain.map((x) => [sx(x), sy(trend.slope * x + trend.intercept)]);
  const point = active == null ? null : chart.points[active];
  return <ChartFrame frame={frame} onLeave={() => { setActive(null); hide(); }} stale={stale}
    label={`Diagrama de dispersión de ${chart.y} frente a ${chart.x}, ${chart.points.length} puntos`}>
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
      <defs><clipPath id={clipId}><rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} /></clipPath></defs>
      {yTicks.map((tick) => <g key={`y${tick}`}>
        <line x1={M.left} x2={W - M.right} y1={sy(tick)} y2={sy(tick)} className="gridline" />
        <text x={M.left - 8} y={sy(tick)} className="tick-label" textAnchor="end" dominantBaseline="middle">{formatTick(tick)}</text>
      </g>)}
      {xTicks.map((tick) => <text key={`x${tick}`} x={sx(tick)} y={H - M.bottom + 18} className="tick-label" textAnchor="middle">{formatTick(tick)}</text>)}
      <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} className="baseline" />
      <g clipPath={`url(#${clipId})`}>
        {chart.points.map(([x, y], index) => <circle key={index} cx={sx(x)} cy={sy(y)} r={4} className="scatter-dot" />)}
        {fit && <line x1={fit[0][0]} y1={fit[0][1]} x2={fit[1][0]} y2={fit[1][1]} className="trend-line" />}
      </g>
      {fit && <text x={W - M.right} y={Math.max(M.top + 10, Math.min(fit[1][1] - 8, H - M.bottom - 8))} textAnchor="end" className="direct-label">Ajuste lineal</text>}
      {point && <circle cx={sx(point[0])} cy={sy(point[1])} r={6} className="scatter-dot-active" />}
      <text x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle" className="axis-title">{truncate(chart.x, 48)}</text>
      <text transform={`translate(14, ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{truncate(chart.y, 40)}</text>
      <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="transparent" onPointerMove={nearest} />
    </svg>
    {tooltip}
  </ChartFrame>;
}
