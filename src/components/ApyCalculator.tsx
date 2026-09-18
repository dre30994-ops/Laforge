import { useMemo, useState } from "react";
import {
  formatCompact,
  formatPercent,
  projectRewards,
  tenureMultiplierAfter,
  toBaseUnits,
  toTokens,
  usePoolStats,
  TENURE_MAX_DAYS,
  type PoolStats,
} from "@/lib/economics";
import { useI18n } from "@/components/LanguageProvider";

const HORIZON_PRESETS = [1, 7, 14, 30];

function presetsFor(durationDays?: number): number[] {
  if (!durationDays || durationDays <= 0) return HORIZON_PRESETS;
  const set = new Set<number>([1, durationDays]);
  if (durationDays >= 7) set.add(7);
  else if (durationDays > 1) set.add(Math.max(1, Math.floor(durationDays / 2)));
  if (durationDays >= 14) set.add(14);
  if (durationDays >= 30) set.add(30);
  return [...set].sort((a, b) => a - b);
}

/**
 * Round a percentage DOWN (floor) to 2 decimal places, e.g. 12.349 → "12.34%".
 * For very large magnitudes the floored value is shown in compact notation so
 * it never overflows its card (e.g. astronomically compounded mock APYs).
 */
function floorPercent2(pct: number): string {
  if (!isFinite(pct)) return "—";
  const floored = Math.floor(pct * 100) / 100;
  if (Math.abs(floored) >= 1e6) {
    // Keep 2 significant decimals in exponential form: 3.56e+128%
    return `${floored.toExponential(2)}%`;
  }
  return `${floored.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

/**
 * Terminal-styled APY / yield calculator. Minimalist gold input fields,
 * pill horizon toggles, and glass result readouts. All projection math flows
 * through the shared `projectRewards` model so it agrees with the dashboard.
 */
export function ApyCalculator({ stats: statsProp }: { stats?: PoolStats } = {}) {
  const { t } = useI18n();
  const live = usePoolStats();
  const stats = statsProp ?? live;

  const horizons = presetsFor(stats.durationDays);
  const [stakeInput, setStakeInput] = useState("100000");
  const [heldDays, setHeldDays] = useState(Math.min(4, stats.durationDays ?? 4));
  const [horizonDays, setHorizonDays] = useState(horizons.includes(14) ? 14 : horizons[horizons.length - 1] ?? 14);

  const stakeBase = useMemo(() => {
    const n = parseFloat(stakeInput.replace(/,/g, ""));
    return isFinite(n) && n > 0 ? toBaseUnits(n) : 0;
  }, [stakeInput]);

  const tenureMultiplier = useMemo(
    () => tenureMultiplierAfter(heldDays),
    [heldDays]
  );

  const projection = useMemo(() => {
    const tvl = stats.tvl + stakeBase;
    return projectRewards({
      stake: stakeBase,
      tvl,
      baseRatePerTick: stats.currentRate,
      emissionMultiplier: stats.emissionMultiplier,
      tenureMultiplier,
      poolAvgMultiplier: stats.poolAvgMultiplier,
      horizonDays,
    });
  }, [stakeBase, stats, tenureMultiplier, horizonDays]);

  const hasStake = stakeBase > 0;

  return (
    <div className="glass glass-gold p-5 animate-rise">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-hi tracking-tight">{t("calc.title")}</h2>
          <p className="label-term mt-0.5">{t("calc.subtitle")}</p>
        </div>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
          stroke="var(--neon-gold)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <line x1="8" y1="7" x2="16" y2="7" />
          <line x1="8" y1="15" x2="8" y2="15" />
          <line x1="16" y1="15" x2="16" y2="18" />
        </svg>
      </div>

      {/* Stake input */}
      <label className="block mb-4">
        <span className="label-term">{t("calc.stake")}</span>
        <div className="relative mt-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            placeholder="0"
            className="input-term !pr-16"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 label-term !text-[10px]">
            {stats.symbol ? `$${stats.symbol}` : "TOKENS"}
          </span>
        </div>
      </label>

      {/* Tenure slider */}
      <div className="mb-4">
        <div className="flex justify-between items-baseline mb-2">
          <span className="label-term">{t("calc.tenure")}</span>
          <span className="mono text-sm text-gold-neon">{tenureMultiplier.toFixed(2)}x</span>
        </div>
        <input
          type="range"
          min={0}
          max={TENURE_MAX_DAYS}
          step={0.5}
          value={heldDays}
          onChange={(e) => setHeldDays(parseFloat(e.target.value))}
          className="slider-term"
        />
        <div className="flex justify-between label-term !text-[9px] mt-1.5">
          <span>{heldDays === 0 ? t("calc.fresh") : t("calc.held", { n: heldDays })}</span>
          <span>{t("calc.max", { n: TENURE_MAX_DAYS })}</span>
        </div>
      </div>

      {/* Horizon presets */}
      <div className="mb-5">
        <span className="label-term">{t("calc.horizon")}</span>
        <div className="grid grid-cols-4 gap-1.5 mt-1.5">
          {horizons.map((d) => (
            <button
              key={d}
              onClick={() => setHorizonDays(d)}
              className={`pill ${horizonDays === d ? "active" : ""}`}
            >
              {t("common.daysShort", { n: d })}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 gap-2.5">
        <Readout label={t("calc.apy")} value={hasStake ? floorPercent2(projection.apy) : "—"}
          sub={t("calc.compounded")} accent="gold" />
        <Readout label={t("calc.apr")} value={hasStake ? formatPercent(projection.apr) : "—"}
          sub={t("calc.simple")} accent="gold" />
        <Readout label={t("calc.rewards", { n: horizonDays })}
          value={hasStake ? formatCompact(toTokens(projection.totalReward)) : "—"}
          sub={t("calc.tokens")} accent="pos" />
        <Readout label={t("calc.daily")}
          value={hasStake ? formatCompact(toTokens(projection.dailyReward)) : "—"}
          sub={t("calc.perDay")} accent="pos" />
      </div>

      {/* Pool share */}
      <div className="mt-4 pt-4 border-t border-black/[0.06]">
        <div className="flex justify-between items-center mb-1.5">
          <span className="label-term">{t("calc.share")}</span>
          <span className="mono text-xs text-gold-neon">
            {hasStake ? `${(projection.shareOfPool * 100).toFixed(3)}%` : "—"}
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden bg-black/[0.04]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, projection.shareOfPool * 100)}%`,
              background: "linear-gradient(90deg, var(--amber), var(--neon-gold))",
            }}
          />
        </div>
        <p className="label-term !text-[9px] !tracking-normal !normal-case mt-2.5 leading-snug text-lo">
          {t("calc.disclaimer")}
        </p>
      </div>
    </div>
  );
}

function Readout({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "gold" | "pos";
}) {
  const color = accent === "pos" ? "text-pos" : "text-gold-neon";
  return (
    <div className="min-w-0 rounded-xl border border-black/[0.06] bg-black/[0.02] p-3">
      <div className="label-term !text-[9px]">{label}</div>
      <div
        className={`mono text-xl font-bold ${color} leading-tight mt-0.5 truncate`}
        title={value}
      >
        {value}
      </div>
      {sub && <div className="label-term !text-[8px] !tracking-normal !normal-case mt-0.5">{sub}</div>}
    </div>
  );
}
