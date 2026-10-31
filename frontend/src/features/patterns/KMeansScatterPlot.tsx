import { useMemo, useState, type PointerEvent } from "react";
import { ChartFrame, useChartTooltip } from "../../components/charts/ChartTooltip";
import { formatTick, formatValue, linearScale, niceDomain, niceTicks, truncate } from "../../components/charts/chart-utils";
import type { KMeansPoint } from "../../types/exploration";

const W = 640;
const H = 380;
const M = { top: 16, right: 24, bottom: 48, left: 64 };
const COLORS = ["#2a78d6", "#bd4f44", "#4b9a70", "#9b6ac3", "#c78823", "#318b9b"];

export function KMeansScatterPlot({ x, y, points, clusters, stale }: {
  x: string;
  y: string;
  points: KMeansPoint[];
  clusters: number[];
  stale?: boolean;
}) {
  const { frame, hide, fromPointer, tooltip } = useChartTooltip();
  const [active, setActive] = useState<number | null>(null);
  const { sx, sy, xTicks, yTicks } = useMemo(() => {
    const xd = niceDomain(Math.min(...points.map((point) => point.x)), Math.max(...points.map((point) => point.x)));
    const yd = niceDomain(Math.min(...points.map((point) => point.y)), Math.max(...points.map((point) => point.y)));
    return {
      sx: linearScale(xd, [M.left, W - M.right]), sy: linearScale(yd, [H - M.bottom, M.top]),
      xTicks: niceTicks(...xd), yTicks: niceTicks(...yd),
    };
  }, [points]);

  function nearest(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const py = ((event.clientY - box.top) / box.height) * H;
    let best = -1;
    let distance = Infinity;
    points.forEach((point, index) => {
      const candidate = (sx(point.x) - px) ** 2 + (sy(point.y) - py) ** 2;
      if (candidate < distance) { best = index; distance = candidate; }
    });
    if (best < 0 || distance > 40 ** 2) { setActive(null); hide(); return; }
    const point = points[best];
    setActive(best);
    fromPointer(event, `Cluster ${point.cluster + 1}`, [
      { label: x, value: formatValue(point.x) }, { label: y, value: formatValue(point.y) },
    ]);
  }

  return <div className="kmeans-chart"><ChartFrame frame={frame} onLeave={() => { setActive(null); hide(); }} stale={stale}
    label={`Proyección de dispersión de ${y} frente a ${x}, coloreada por cluster`}>
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
      <defs><clipPath id="kmeans-plot-area"><rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} /></clipPath></defs>
      {yTicks.map((tick) => <g key={`y${tick}`}>
        <line x1={M.left} x2={W - M.right} y1={sy(tick)} y2={sy(tick)} className="gridline" />
        <text x={M.left - 8} y={sy(tick)} className="tick-label" textAnchor="end" dominantBaseline="middle">{formatTick(tick)}</text>
      </g>)}
      {xTicks.map((tick) => <text key={`x${tick}`} x={sx(tick)} y={H - M.bottom + 18} className="tick-label" textAnchor="middle">{formatTick(tick)}</text>)}
      <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} className="baseline" />
      <g clipPath="url(#kmeans-plot-area)">
        {points.map((point, index) => <circle key={index} cx={sx(point.x)} cy={sy(point.y)} r={4}
          fill={COLORS[point.cluster % COLORS.length]} className="kmeans-dot" />)}
      </g>
      {active != null && <circle cx={sx(points[active].x)} cy={sy(points[active].y)} r={6}
        fill={COLORS[points[active].cluster % COLORS.length]} className="kmeans-dot-active" />}
      <text x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle" className="axis-title">{truncate(x, 48)}</text>
      <text transform={`translate(14, ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{truncate(y, 40)}</text>
      <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="transparent" onPointerMove={nearest} />
    </svg>
    <ul className="kmeans-legend" aria-label="Leyenda de clusters">
      {clusters.map((cluster) => <li key={cluster}><span style={{ background: COLORS[cluster % COLORS.length] }} />Cluster {cluster + 1}</li>)}
    </ul>
    {tooltip}
  </ChartFrame></div>;
}
