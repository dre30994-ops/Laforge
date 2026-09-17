import { useEffect, useRef, useState } from "react";
import {
  formatCompact,
  projectRewards,
  toTokens,
  usePoolStats,
  TICKS_PER_DAY,
  type PoolStats,
} from "@/lib/economics";
import { formatUsd } from "@/lib/tokenQuote";
import { chainTvlCaption, useProtocolTvl } from "@/hooks/useProtocolTvl";
import { EVM_NETWORKS, isVisibleNetwork } from "@/lib/evmNetworks";

/**
 * Top-left hero summary: Total Staked Value plus a live, continuously
 * accumulating yield counter that ticks up every animation frame using the
 * shared per-second reward rate.
 *
 * On the terminal (no pool stats), Total Staked Value is the USD sum of
 * tokens locked on every launch chain, each quoted on that chain's DEX.
 * Only currently visible networks are labeled on the card.
 */
export function HeroMetrics({
  stats: statsProp,
  compact = false,
  hideTvl = false,
}: {
  stats?: PoolStats;
  compact?: boolean;
  hideTvl?: boolean;
} = {}) {
  const live = usePoolStats();
  const stats = statsProp ?? live;
  const protocolMode = !statsProp && !compact;
  const protocol = useProtocolTvl(protocolMode && !hideTvl);

  // Per-second reward for the connected position, from the shared model.
  const projection = projectRewards({
    stake: stats.yourStake,
    tvl: stats.tvl,
    baseRatePerTick: stats.currentRate,
    emissionMultiplier: stats.emissionMultiplier,
    tenureMultiplier: stats.yourMultiplier,
    poolAvgMultiplier: stats.poolAvgMultiplier,
    horizonDays: 1,
  });
  const rewardPerSecond = projection.dailyReward / 86_400; // base units / s

  // Live accumulating yield: pending + accrual since mount.
  const [accrued, setAccrued] = useState(stats.yourPending);
  const startRef = useRef<number>(0);
  const baseRef = useRef<number>(stats.yourPending);

  useEffect(() => {
    baseRef.current = stats.yourPending;
    startRef.current = Date.now();
    let raf = 0;
    const tick = () => {
      const elapsedSec = (Date.now() - startRef.current) / 1000;
      setAccrued(baseRef.current + rewardPerSecond * elapsedSec);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rewardPerSecond, stats.yourPending]);

  const dailyTokens = toTokens(projection.dailyReward);
  const accruedTokens = toTokens(accrued);
  const chainRows = protocol.byChain.filter(
    (c) => isVisibleNetwork(c.chainKey) && (c.tvlUsd > 0 || c.pools > 0),
  );

  return (
    <div
      className={`grid grid-cols-1 ${
        hideTvl ? "" : "sm:grid-cols-2"
      } animate-rise ${compact ? "gap-2" : "gap-4"}`}
      data-testid={compact ? "hero-metrics-compact" : "hero-metrics"}
    >
      {!hideTvl && (
      <div className={`glass glass-gold relative overflow-hidden ${compact ? "p-3" : "p-6"}`}>
        <div className={`flex items-center justify-between ${compact ? "mb-1.5" : "mb-3"}`}>
          <span className="label-term">Total Staked Value</span>
          {protocolMode ? (
            <span className="label-term text-pos flex items-center gap-1.5">
              <span className="pulse-dot" />
              {protocol.loading
                ? "quoting…"
                : `${protocol.pools} pool${protocol.pools === 1 ? "" : "s"}`}
            </span>
          ) : (
            <span className="label-term text-pos flex items-center gap-1.5">
              <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor">
                <path d="M6 1l4 5H7v5H5V6H2z" />
              </svg>
              +{stats.emissionMultiplier.toFixed(2)}x
            </span>
          )}
        </div>
        <div
          className={`hero-numeral leading-none ${
            compact ? "text-2xl md:text-3xl" : "text-5xl md:text-6xl"
          }`}
          data-testid={protocolMode ? "protocol-tvl" : undefined}
        >
          {protocolMode
            ? protocol.loading
              ? "…"
              : formatUsd(protocol.tvlUsd)
            : formatCompact(toTokens(stats.tvl))}
        </div>
        <div className={`flex items-baseline gap-2 flex-wrap ${compact ? "mt-1.5" : "mt-3"}`}>
          {protocolMode ? (
            <span className={`mono text-mid ${compact ? "text-xs" : "text-sm"}`}>
              {chainTvlCaption(protocol)}
            </span>
          ) : (
            <>
              <span className={`mono text-mid ${compact ? "text-xs" : "text-sm"}`}>
                {formatCompact(toTokens(stats.yourStake))}
              </span>
              <span className="label-term !tracking-wide">your stake</span>
            </>
          )}
        </div>
        {protocolMode && chainRows.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="protocol-tvl-chains">
            {chainRows.map((row) => (
              <span
                key={row.chainKey}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold
                           text-hi border border-black/10 bg-black/[0.03]"
                title={`${row.priced}/${row.pools} priced`}
              >
                {EVM_NETWORKS[row.chainKey]?.short ?? row.chainKey}
                <span className="text-gold-neon">{formatUsd(row.tvlUsd)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      )}

      <div className={`glass relative overflow-hidden ${compact ? "p-3" : "p-6"}`}>
        <div className={`flex items-center justify-between ${compact ? "mb-1.5" : "mb-3"}`}>
          <span className="label-term">Accumulating Yield</span>
          <span className="flex items-center gap-1.5 label-term text-pos">
            <span className="pulse-dot" /> live
          </span>
        </div>
        <div
          className={`hero-numeral leading-none tabular-nums ${
            compact ? "text-2xl md:text-3xl" : "text-5xl md:text-6xl"
          }`}
        >
          {accruedTokens.toLocaleString(undefined, {
            minimumFractionDigits: compact ? 2 : 4,
            maximumFractionDigits: compact ? 2 : 4,
          })}
        </div>
        <div className={`flex items-baseline gap-2 ${compact ? "mt-1.5" : "mt-3"}`}>
          <span className={`mono text-amber-neon ${compact ? "text-xs" : "text-sm"}`}>
            +{formatCompact(dailyTokens)}
          </span>
          <span className="label-term !tracking-wide">/ day · {TICKS_PER_DAY} ticks</span>
        </div>
      </div>
    </div>
  );
}
