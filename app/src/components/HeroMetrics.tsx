"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatCompact,
  projectRewards,
  toTokens,
  usePoolStats,
  TICKS_PER_DAY,
} from "@/lib/economics";

/**
 * Top-left hero summary: Total Staked Value plus a live, continuously
 * accumulating yield counter that ticks up every animation frame using the
 * shared per-second reward rate.
 */
export function HeroMetrics() {
  const stats = usePoolStats();

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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-rise">
      {/* Total Staked Value */}
      <div className="glass glass-gold p-6 relative overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <span className="label-term">Total Staked Value</span>
          <span className="label-term text-pos flex items-center gap-1.5">
            <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor">
              <path d="M6 1l4 5H7v5H5V6H2z" />
            </svg>
            +{stats.emissionMultiplier.toFixed(2)}x
          </span>
        </div>
        <div className="hero-numeral text-5xl md:text-6xl leading-none">
          {formatCompact(toTokens(stats.tvl))}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="mono text-sm text-mid">
            {formatCompact(toTokens(stats.yourStake))}
          </span>
          <span className="label-term !tracking-wide">your stake</span>
        </div>
      </div>

      {/* Accumulating Yield */}
      <div className="glass p-6 relative overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <span className="label-term">Accumulating Yield</span>
          <span className="flex items-center gap-1.5 label-term text-pos">
            <span className="pulse-dot" /> live
          </span>
        </div>
        <div className="hero-numeral text-5xl md:text-6xl leading-none tabular-nums">
          {accruedTokens.toLocaleString(undefined, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          })}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="mono text-sm text-amber-neon">
            +{formatCompact(dailyTokens)}
          </span>
          <span className="label-term !tracking-wide">/ day · {TICKS_PER_DAY} ticks</span>
        </div>
      </div>
    </div>
  );
}
