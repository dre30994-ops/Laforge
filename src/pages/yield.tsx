import { useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
import { DemoWarning } from "@/components/DemoWarning";
import { WalletButton } from "@/components/WalletButton";
import { useConnectedAccount } from "@/hooks/useConnectedAccount";
import { usePosition } from "@/hooks/usePosition";
import {
  emissionMultiplierAt,
  formatCompact,
  projectRewards,
  toTokens,
  usePoolStats,
  PROGRAM_DAYS,
} from "@/lib/economics";

/**
 * Yield page (/yield): visualizes the connected wallet's reward growth.
 *
 * The cumulative-growth curve is driven by the user's real on-chain staked
 * amount and tenure multiplier (via usePosition) when available, falling back
 * to the illustrative pool model when disconnected so the page still renders a
 * meaningful shape. Reward math flows through the shared `projectRewards`
 * model, so figures agree with the dashboard and calculator.
 */
export default function YieldPage() {
  const { connected } = useConnectedAccount();
  const stats = usePoolStats();
  const { data: pos, enabled: posEnabled, loading } = usePosition();

  // Use real position values when we can read them; otherwise the pool model.
  const stake = posEnabled ? Number(pos.staked) : stats.yourStake;
  const tenureMultiplier = posEnabled ? pos.tenureMultiplier : stats.yourMultiplier;
  const pending = posEnabled ? Number(pos.pending) : stats.yourPending;
  const claimed = posEnabled ? Number(pos.totalClaimed) : stats.totalClaimed;

  const daily = useMemo(
    () =>
      projectRewards({
        stake,
        tvl: stats.tvl,
        baseRatePerTick: stats.currentRate,
        emissionMultiplier: stats.emissionMultiplier,
        tenureMultiplier,
        poolAvgMultiplier: stats.poolAvgMultiplier,
        horizonDays: 1,
      }),
    [stake, stats, tenureMultiplier]
  );

  const lifetime = pending + claimed; // rewards earned so far (claimed + unclaimed)

  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[900px] mx-auto space-y-6">
            {/* Header */}
            <header className="animate-rise">
              <Link to="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                ← Back to dashboard
              </Link>
              <div className="flex items-end justify-between flex-wrap gap-3 mt-3">
                <div>
                  <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi">
                    Reward Growth
                  </h1>
                  <p className="text-mid mt-2 leading-relaxed">
                    How your rewards accumulate over the {PROGRAM_DAYS}-day program, based on your
                    stake and tenure multiplier.
                  </p>
                </div>
                {connected && (
                  <span className="label-term">{loading ? "Syncing…" : "Live"}</span>
                )}
              </div>
            </header>

            <DemoWarning />

            {!connected && (
              <section className="glass glass-gold p-5 animate-rise flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm text-mid leading-relaxed max-w-md">
                  Showing an illustrative projection. Connect your wallet to see reward growth for
                  your actual position.
                </p>
                <WalletButton />
              </section>
            )}

            {/* Reward metrics */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-rise">
              <Metric
                label="Pending"
                value={formatCompact(toTokens(pending))}
                sub="unclaimed"
                accent="pos"
              />
              <Metric
                label="Claimed"
                value={formatCompact(toTokens(claimed))}
                sub="lifetime"
                accent="gold"
              />
              <Metric
                label="Earned total"
                value={formatCompact(toTokens(lifetime))}
                sub="claimed + pending"
                accent="hi"
              />
              <Metric
                label="Est. daily"
                value={formatCompact(toTokens(daily.dailyReward))}
                sub="tokens/day"
                accent="pos"
              />
            </section>

            {/* Growth chart */}
            <RewardGrowthChart
              stake={stake}
              tenureMultiplier={tenureMultiplier}
              earnedSoFar={toTokens(lifetime)}
            />

            {/* Chart description */}
            <section className="glass p-6 animate-rise">
              <h2 className="label-term !text-[10px] mb-3">What this chart shows</h2>
              <p className="text-sm text-mid leading-relaxed">
                The curve plots your <span className="text-hi">cumulative rewards</span> — the
                running total of reward tokens your position earns — measured in tokens on the
                vertical axis against the day of the {PROGRAM_DAYS}-day program on the horizontal
                axis. Each point is the sum of every prior day&rsquo;s yield, so the line only ever
                rises; a steeper section means faster earning during that stretch.
              </p>
              <ul className="mt-4 space-y-2.5 text-sm text-mid leading-relaxed">
                <li className="flex gap-2.5">
                  <Dot />
                  <span>
                    <span className="text-hi">Where the numbers come from.</span> The shape is
                    computed from your <span className="text-gold-neon">staked amount</span> and{" "}
                    <span className="text-gold-neon">tenure multiplier</span> read from your
                    on-chain position, run through the same reward model as the dashboard and
                    calculator. Left of today it reflects earning to date; right of today it is a{" "}
                    <span className="text-hi">projection</span> assuming the current emission rate
                    and pool composition hold.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Dot />
                  <span>
                    <span className="text-pos">The dashed vertical line</span> marks today, and the{" "}
                    <span className="text-gold-neon">projected total</span> in the top-right is
                    where the curve ends on the final day.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Dot />
                  <span>
                    <span className="text-hi">The early climb</span> is steepest because the
                    pool&rsquo;s emissions ramp from{" "}
                    <span className="mono text-gold-neon">1.0x</span> to{" "}
                    <span className="mono text-gold-neon">2.0x</span> over the first day, then
                    hold — so the slope eases into a steadier rate afterward.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Dot />
                  <span>
                    A larger stake or a higher tenure multiplier lifts the whole curve — your share
                    of each day&rsquo;s emissions grows with both. Hover any day to read the
                    cumulative total at that point.
                  </span>
                </li>
              </ul>
            </section>

            <footer className="pt-1">
              <p className="label-term !text-[9px] !tracking-normal !normal-case text-lo leading-snug">
                Projection assumes the current emission rate and pool composition hold. The dashed
                marker shows today. Actual yield varies with TVL, the emission ramp, and operator
                top-ups. See the{" "}
                <Link to="/docs" className="text-gold-neon hover:underline">
                  docs
                </Link>{" "}
                for the full mechanics.
              </p>
            </footer>
          </div>
        </main>
    </TerminalShell>
  );
}

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "hi" | "gold" | "pos";
}) {
  const color = accent === "pos" ? "text-pos" : accent === "gold" ? "text-gold-neon" : "text-hi";
  return (
    <div className="glass p-4">
      <div className="label-term !text-[9px]">{label}</div>
      <div className={`mono text-xl font-bold ${color} leading-tight mt-1 truncate`} title={value}>
        {value}
      </div>
      {sub && (
        <div className="label-term !text-[8px] !tracking-normal !normal-case mt-0.5">{sub}</div>
      )}
    </div>
  );
}

/** Small gold bullet used in the chart description list. */
function Dot() {
  return (
    <span
      className="shrink-0 mt-1.5 inline-block w-1.5 h-1.5 rounded-full"
      style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}
    />
  );
}

interface Point {
  day: number;
  value: number;
  x: number;
  y: number;
}

/**
 * Cumulative reward-growth curve for a given position (stake + tenure), drawn
 * as pure SVG. Integrates the shared reward model day-by-day across the program
 * timeline, applying the emission ramp so the early slope steepens then settles.
 */
function RewardGrowthChart({
  stake,
  tenureMultiplier,
  earnedSoFar,
}: {
  stake: number;
  tenureMultiplier: number;
  earnedSoFar: number;
}) {
  const stats = usePoolStats();
  const gradId = useId();
  const [hover, setHover] = useState<Point | null>(null);

  const W = 720;
  const H = 300;
  const padX = 16;
  const padTop = 24;
  const padBottom = 28;

  const points = useMemo<Point[]>(() => {
    const perDay: Point[] = [];
    let cumulative = 0;

    for (let day = 0; day <= PROGRAM_DAYS; day++) {
      if (day > 0) {
        const midElapsed = (day - 0.5) * 86_400;
        const emission = emissionMultiplierAt(midElapsed);
        const dayProj = projectRewards({
          stake,
          tvl: stats.tvl,
          baseRatePerTick: stats.currentRate,
          emissionMultiplier: emission,
          tenureMultiplier,
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
      x: padX + (p.day / PROGRAM_DAYS) * plotW,
      y: padTop + plotH - (p.value / maxVal) * plotH,
    }));
  }, [stake, tenureMultiplier, stats]);

  const linePath = useMemo(() => smoothPath(points), [points]);
  const areaPath = useMemo(() => {
    if (!points.length) return "";
    const base = H - padBottom;
    return `${smoothPath(points)} L ${points[points.length - 1].x.toFixed(1)} ${base} L ${points[0].x.toFixed(1)} ${base} Z`;
  }, [points]);

  const elapsedDays = Math.min(PROGRAM_DAYS, Math.max(0, (stats.now - stats.startTs) / 86_400));
  const nowX = padX + (elapsedDays / PROGRAM_DAYS) * (W - padX * 2);

  const total = points[points.length - 1]?.value ?? 0;

  return (
    <div className="glass p-5 animate-rise">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-sm font-semibold text-hi tracking-tight">Cumulative Yield</h2>
          <p className="label-term mt-0.5">
            {formatCompact(earnedSoFar)} earned so far · {PROGRAM_DAYS}-day program
          </p>
        </div>
        <div className="text-right">
          <div className="mono text-lg text-gold-neon leading-none">{formatCompact(total)}</div>
          <div className="label-term mt-1">projected total</div>
        </div>
      </div>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
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

          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = padTop + (H - padTop - padBottom) * f;
            return (
              <line
                key={f}
                x1={padX}
                y1={y}
                x2={W - padX}
                y2={y}
                stroke="rgba(20,18,10,0.05)"
                strokeWidth="1"
              />
            );
          })}

          <path d={areaPath} fill={`url(#area-${gradId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={`url(#line-${gradId})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <line
            x1={nowX}
            y1={padTop}
            x2={nowX}
            y2={H - padBottom}
            stroke="var(--pos)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.7"
          />
          <circle cx={nowX} cy={padTop} r="3" fill="var(--pos)" />

          {points.map((p) => (
            <g key={p.day}>
              <rect
                x={p.x - (W - padX * 2) / PROGRAM_DAYS / 2}
                y={0}
                width={(W - padX * 2) / PROGRAM_DAYS}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(p)}
              />
              {hover?.day === p.day && (
                <circle cx={p.x} cy={p.y} r="4.5" fill="var(--neon-gold)" stroke="#0a0c0f" strokeWidth="2" />
              )}
            </g>
          ))}
        </svg>

        {hover && (
          <div
            className="absolute -translate-x-1/2 -translate-y-full pointer-events-none glass !rounded-lg px-3 py-2"
            style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}
          >
            <div className="label-term !text-[9px]">Day {hover.day}</div>
            <div className="mono text-sm text-gold-neon">{formatCompact(hover.value)}</div>
          </div>
        )}

        <div className="flex justify-between mt-1 px-2">
          {[0, Math.round(PROGRAM_DAYS / 2), PROGRAM_DAYS].map((d) => (
            <span key={d} className="label-term !text-[9px]">
              D{d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Catmull-Rom → cubic Bézier smoothing for a clean curve. */
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
