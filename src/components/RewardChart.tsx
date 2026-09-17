import { useId, useMemo, useState } from "react";
import {
  emissionMultiplierAt,
  formatCompact,
  projectRewards,
  toTokens,
  usePoolStats,
  PROGRAM_DAYS,
  type PoolStats,
} from "@/lib/economics";

interface Point {
  day: number;
  value: number; // cumulative reward tokens
  x: number;
  y: number;
}

/**
 * Center-stage line chart: continuous cumulative reward growth across the
 * program timeline. Pure SVG, no chart dependency.
 *
 * The curve integrates the shared reward model day-by-day, applying the
 * emission ramp (1.0x→2.0x over the first day) so the early slope steepens
 * then settles — a realistic accrual shape.
 */
export function RewardChart({ stats: statsProp }: { stats?: PoolStats } = {}) {
  const live = usePoolStats();
  const stats = statsProp ?? live;
  const gradId = useId();
  const [hover, setHover] = useState<Point | null>(null);
  const days = Math.max(1, stats.durationDays ?? PROGRAM_DAYS);

  const W = 720;
  const H = 210;
  const padX = 16;
  const padTop = 18;
  const padBottom = 22;

  const points = useMemo<Point[]>(() => {
    const perDay: Point[] = [];
    let cumulative = 0;

    for (let day = 0; day <= days; day++) {
      if (day > 0) {
        // Emission multiplier at the midpoint of this day.
        const midElapsed = (day - 0.5) * 86_400;
        const emission = emissionMultiplierAt(midElapsed);
        const dayProj = projectRewards({
          stake: stats.yourStake,
          tvl: stats.tvl,
          baseRatePerTick: stats.currentRate,
          emissionMultiplier: emission,
          tenureMultiplier: stats.yourMultiplier,
          poolAvgMultiplier: stats.poolAvgMultiplier,
          horizonDays: 1,
        });
        cumulative += toTokens(dayProj.dailyReward);
      }
      perDay.push({ day, value: cumulative, x: 0, y: 0 });
    }

    const maxVal = perDay[perDay.length - 1].value || 1;
    const plotW = W - padX * 2;
    const plotH = H - padTop - padBottom;

    return perDay.map((p) => ({
      ...p,
      x: padX + (p.day / days) * plotW,
      y: padTop + plotH - (p.value / maxVal) * plotH,
    }));
  }, [stats, days]);

  const linePath = useMemo(() => smoothPath(points), [points]);
  const areaPath = useMemo(() => {
    if (!points.length) return "";
    const base = H - padBottom;
    return `${smoothPath(points)} L ${points[points.length - 1].x.toFixed(1)} ${base} L ${points[0].x.toFixed(1)} ${base} Z`;
  }, [points]);

  // "Now" marker
  const elapsedDays = Math.min(days, (stats.now - stats.startTs) / 86_400);
  const nowX = padX + (elapsedDays / days) * (W - padX * 2);

  const total = points[points.length - 1]?.value ?? 0;

  return (
    <div className="glass p-5 animate-rise">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-sm font-semibold text-hi tracking-tight">
            Reward Growth
          </h2>
          <p className="label-term mt-0.5">Cumulative yield · {days}-day program</p>
        </div>
        <div className="text-right">
          <div className="mono text-lg text-gold-neon leading-none">
            {formatCompact(total)}
          </div>
          <div className="label-term mt-1">projected total</div>
        </div>
      </div>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto max-h-[220px]"
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`area-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--neon-gold)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`line-${gradId}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--amber)" />
              <stop offset="100%" stopColor="var(--neon-gold)" />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = padTop + (H - padTop - padBottom) * f;
            return (
              <line key={f} x1={padX} y1={y} x2={W - padX} y2={y}
                stroke="rgba(20,18,10,0.06)" strokeWidth="1" />
            );
          })}

          {/* Area + line */}
          <path d={areaPath} fill={`url(#area-${gradId})`} />
          <path d={linePath} fill="none" stroke={`url(#line-${gradId})`}
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Now marker */}
          <line x1={nowX} y1={padTop} x2={nowX} y2={H - padBottom}
            stroke="var(--pos)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
          <circle cx={nowX} cy={padTop} r="3" fill="var(--pos)" />

          {/* Hover hit-areas + dots */}
          {points.map((p) => (
            <g key={p.day}>
              <rect
                x={p.x - (W - padX * 2) / days / 2}
                y={0}
                width={(W - padX * 2) / days}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(p)}
              />
              {hover?.day === p.day && (
                <circle cx={p.x} cy={p.y} r="4.5" fill="var(--neon-gold)"
                  stroke="#0a0c0f" strokeWidth="2" />
              )}
            </g>
          ))}
        </svg>

        {/* Tooltip */}
        {hover && (
          <div
            className="absolute -translate-x-1/2 -translate-y-full pointer-events-none glass !rounded-lg px-3 py-2"
            style={{
              left: `${(hover.x / W) * 100}%`,
              top: `${(hover.y / H) * 100}%`,
            }}
          >
            <div className="label-term !text-[9px]">Day {hover.day}</div>
            <div className="mono text-sm text-gold-neon">{formatCompact(hover.value)}</div>
          </div>
        )}

        {/* X axis labels */}
        <div className="flex justify-between mt-1 px-2">
          {[0, Math.round(days / 2), days].map((d) => (
            <span key={d} className="label-term !text-[9px]">D{d}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Catmull-Rom → cubic Bézier smoothing for a clean mathematical curve. */
function smoothPath(pts: Point[]): string {
  if (pts.length < 2) return "";
  const d: string[] = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d.push(
      `C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    );
  }
  return d.join(" ");
}
