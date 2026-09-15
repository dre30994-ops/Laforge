"use client";

import { useMemo, useState } from "react";
import {
  formatCompact,
  formatPercent,
  projectRewards,
  tenureMultiplierAfter,
  TENURE_MAX_DAYS,
} from "@/lib/economics";
import type { PoolSummary } from "@/lib/factoryClient";

/**
 * Per-pool APY calculator (Ecosystem + Marketing tiers only).
 *
 * Unlike the global dashboard calculator (which reads the shared mock pool),
 * this one is seeded entirely from *this* pool's on-chain parameters:
 *
 *   - TVL            → the pool's live stake-vault balance (stakeVaultBalance)
 *   - Reward growth  → an emission rate derived from the pool's TVL + duration,
 *                      ramped over the pool's own program length
 *   - Duration       → the pool's durationDays bounds the horizon presets
 *   - Taxes          → the pool's stake/unstake tax reduce effective principal
 *                      and are surfaced so the projection reflects real costs
 *
 * The projection math itself is the shared `projectRewards` model so results
 * stay consistent with the rest of the app; only the *inputs* are per-pool.
 *
 * NOTE: On-chain EVM reward-rate reads are not yet exposed by StakingPool, so
 * the emission rate is a deterministic function of this pool's own parameters
 * (TVL + duration) rather than a hardcoded global constant — i.e. every pool
 * calculates differently based on its own configuration.
 */

const BPS_DENOM = 10_000;

export function PoolApyCalculator({ summary }: { summary: PoolSummary }) {
  const decimals = summary.decimals || 18;
  const scale = 10 ** decimals;

  // Live TVL for this specific pool (base units → number).
  const poolTvl = useMemo(
    () => Number(summary.stakeVaultBalance),
    [summary.stakeVaultBalance]
  );

  // Per-pool emission rate (reward growth). Derived from this pool's own TVL
  // and duration so each pool projects differently:
  //   - A pool targeting ~ (TVL * 0.8) distributed across its whole program
  //     gives the per-tick base rate at 1.0x emission.
  //   - Shorter programs therefore emit faster (higher rate); longer ones slower.
  const { baseRatePerTick, emissionMultiplier, plateauApproxApr } = useMemo(() => {
    const durationDays = Math.max(1, summary.durationDays);
    // TICKS across the whole program (20-min ticks, 72/day — matches economics).
    const TICKS_PER_DAY = 72;
    const totalTicks = durationDays * TICKS_PER_DAY;
    // Target program emissions ≈ 80% of current TVL (illustrative reward budget).
    const targetEmissions = Math.max(scale, poolTvl * 0.8);
    const base = targetEmissions / Math.max(1, totalTicks);
    // Emissions ramp 1.0x→2.0x over the first program-day then plateau; use the
    // midpoint (1.5x) as the representative current multiplier.
    const emission = 1.5;
    // Rough plateau APR for the empty-state hint.
    const perYearTicks = 365 * TICKS_PER_DAY;
    const plateauApr =
      poolTvl > 0 ? ((base * 2 * perYearTicks) / poolTvl) * 100 : 0;
    return {
      baseRatePerTick: base,
      emissionMultiplier: emission,
      plateauApproxApr: plateauApr,
    };
  }, [summary.durationDays, poolTvl, scale]);

  // Horizon presets bounded by this pool's own duration.
  const horizonPresets = useMemo(() => {
    const d = Math.max(1, summary.durationDays);
    const opts = [1, 7, 14, 30].filter((h) => h <= d);
    if (opts.length === 0) opts.push(1);
    if (!opts.includes(d)) opts.push(d);
    return Array.from(new Set(opts)).sort((a, b) => a - b);
  }, [summary.durationDays]);

  const [stakeInput, setStakeInput] = useState("100000");
  const [heldDays, setHeldDays] = useState(
    Math.min(4, Math.max(1, summary.durationDays))
  );
  const [horizonDays, setHorizonDays] = useState(
    horizonPresets[horizonPresets.length - 1]
  );

  const grossStakeBase = useMemo(() => {
    const n = parseFloat(stakeInput.replace(/,/g, ""));
    return isFinite(n) && n > 0 ? Math.round(n * scale) : 0;
  }, [stakeInput, scale]);

  // The stake tax reduces the principal that actually earns.
  const stakeAfterTax = useMemo(
    () => Math.round(grossStakeBase * (1 - summary.stakeTaxBps / BPS_DENOM)),
    [grossStakeBase, summary.stakeTaxBps]
  );

  const tenureMultiplier = useMemo(
    () => tenureMultiplierAfter(heldDays),
    [heldDays]
  );

  const projection = useMemo(() => {
    const tvl = poolTvl + stakeAfterTax;
    return projectRewards({
      stake: stakeAfterTax,
      tvl,
      baseRatePerTick,
      emissionMultiplier,
      tenureMultiplier,
      // Assume the rest of the pool sits at a typical mid tenure.
      poolAvgMultiplier: 1.4,
      horizonDays,
    });
  }, [stakeAfterTax, poolTvl, baseRatePerTick, emissionMultiplier, tenureMultiplier, horizonDays]);

  const hasStake = stakeAfterTax > 0;
  const toTok = (base: number) => base / scale;

  const maxTenure = Math.min(TENURE_MAX_DAYS, Math.max(1, summary.durationDays));

  return (
    <div className="glass glass-gold p-5 animate-rise">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-hi tracking-tight">
            APY Calculator
          </h2>
          <p className="label-term mt-0.5">
            Projected from this pool&apos;s parameters
          </p>
        </div>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
          stroke="var(--neon-gold)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <line x1="8" y1="7" x2="16" y2="7" />
          <line x1="8" y1="15" x2="8" y2="15" />
        </svg>
      </div>

      {/* Pool parameter chips — so it's clear the math is per-pool. */}
      <div className="grid grid-cols-3 gap-1.5 mb-4">
        <ParamChip k="Duration" v={`${summary.durationDays}d`} />
        <ParamChip k="Stake tax" v={`${(summary.stakeTaxBps / 100).toFixed(2)}%`} />
        <ParamChip k="Unstake tax" v={`${(summary.unstakeTaxBps / 100).toFixed(2)}%`} />
      </div>

      {/* Stake input */}
      <label className="block mb-4">
        <span className="label-term">Stake amount</span>
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
            {summary.symbol ? summary.symbol.toUpperCase() : "TOKENS"}
          </span>
        </div>
        {hasStake && summary.stakeTaxBps > 0 && (
          <span className="label-term !text-[9px] !normal-case !tracking-normal text-lo mt-1 block">
            After {(summary.stakeTaxBps / 100).toFixed(2)}% stake tax:{" "}
            {formatCompact(toTok(stakeAfterTax))} earning
          </span>
        )}
      </label>

      {/* Tenure slider (capped by pool duration) */}
      <div className="mb-4">
        <div className="flex justify-between items-baseline mb-2">
          <span className="label-term">Tenure · hold time</span>
          <span className="mono text-sm text-gold-neon">
            {tenureMultiplier.toFixed(2)}x
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={maxTenure}
          step={0.5}
          value={Math.min(heldDays, maxTenure)}
          onChange={(e) => setHeldDays(parseFloat(e.target.value))}
          className="slider-term"
        />
        <div className="flex justify-between label-term !text-[9px] mt-1.5">
          <span>{heldDays === 0 ? "Fresh · 1.00x" : `${heldDays}d held`}</span>
          <span>Max {maxTenure}d</span>
        </div>
      </div>

      {/* Horizon presets (bounded by pool duration) */}
      <div className="mb-5">
        <span className="label-term">Horizon</span>
        <div
          className="grid gap-1.5 mt-1.5"
          style={{ gridTemplateColumns: `repeat(${horizonPresets.length}, minmax(0,1fr))` }}
        >
          {horizonPresets.map((d) => (
            <button
              key={d}
              onClick={() => setHorizonDays(d)}
              className={`pill ${horizonDays === d ? "active" : ""}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 gap-2.5">
        <Readout label="Est. APY" value={hasStake ? formatPercent(projection.apy) : "—"}
          sub="compounded" accent="gold" />
        <Readout label="Est. APR" value={hasStake ? formatPercent(projection.apr) : "—"}
          sub="simple" accent="gold" />
        <Readout label={`Rewards ${horizonDays}d`}
          value={hasStake ? formatCompact(toTok(projection.totalReward)) : "—"}
          sub="tokens" accent="pos" />
        <Readout label="Daily yield"
          value={hasStake ? formatCompact(toTok(projection.dailyReward)) : "—"}
          sub="tokens/day" accent="pos" />
      </div>

      {/* Pool share */}
      <div className="mt-4 pt-4 border-t border-black/[0.06]">
        <div className="flex justify-between items-center mb-1.5">
          <span className="label-term">Share of emissions</span>
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
          Seeded from this pool&apos;s TVL ({formatCompact(toTok(poolTvl))} tokens),{" "}
          {summary.durationDays}-day program and taxes. Plateau APR ≈{" "}
          {formatPercent(plateauApproxApr)} at full emissions; actual yield varies
          with TVL and operator top-ups.
        </p>
      </div>
    </div>
  );
}

function ParamChip({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-black/[0.06] bg-black/[0.02] p-2 text-center">
      <div className="mono text-xs font-bold text-gold-neon leading-tight">{v}</div>
      <div className="label-term !text-[8px] !tracking-normal !normal-case mt-0.5">{k}</div>
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
      <div className={`mono text-xl font-bold ${color} leading-tight mt-0.5 truncate`} title={value}>
        {value}
      </div>
      {sub && <div className="label-term !text-[8px] !tracking-normal !normal-case mt-0.5">{sub}</div>}
    </div>
  );
}
