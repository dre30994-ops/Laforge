"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatCompact,
  projectRewards,
  tenureMultiplierAfter,
  useNow,
} from "@/lib/economics";
import type { PoolSummary } from "@/lib/factoryClient";
import { useEvmPool } from "@/hooks/useEvmPool";
import { isPreviewAddress } from "@/lib/previewPools";
import { robinhoodExplorerUrl } from "@/lib/chains";
import { CrankCountdown } from "@/components/CrankCountdown";
import { getPoolValueUsd } from "@/lib/priceClient";

/**
 * Per-pool Position dashboard + Stake / Unstake / Claim console (all tiers),
 * wired to the EVM StakingPool contract via useEvmPool.
 *
 *   - Reads the connected wallet's on-chain position (staked / pending /
 *     claimed / wallet balance) for THIS pool.
 *   - stake / unstake / claim send real transactions (the client cranks the
 *     pool first when stale, and approves the token for staking).
 *   - The "Est. daily" figure is projected from this pool's parameters via the
 *     shared reward model (on-chain reward-rate reads aren't exposed as a view).
 *
 * Synthetic preview/mock pools (mock cards + trending tokens) have no on-chain
 * contract, so for those the console runs a local simulation instead — clearly
 * labelled — so the flow is still demonstrable.
 */

type Tab = "stake" | "unstake" | "claim";

/** Format a seconds count as a compact `Hh Mm` / `Mm Ss` countdown. */
function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
const BPS_DENOM = 10_000;
const TICKS_PER_DAY = 72;

export function PoolPositionConsole({ summary }: { summary: PoolSummary }) {
  const preview = isPreviewAddress(summary.pool);
  if (preview) return <PreviewConsole summary={summary} />;
  return <EvmConsole summary={summary} />;
}

// ── Live EVM console ─────────────────────────────────────────────────────────

function EvmConsole({ summary }: { summary: PoolSummary }) {
  const decimals = summary.decimals || 18;
  const scale = 10 ** decimals;
  const sym = summary.symbol ? summary.symbol.toUpperCase() : "TOKENS";

  const { connected, enabled, address, position, tx, stake, unstake, claim, crank, withdrawTreasury, autoClaim, setAutoClaim, reset, refetch } =
    useEvmPool(summary.pool, summary.token);

  // Only the pool creator (operator = launcher) can see the treasury-payout UI.
  const isCreator =
    !!address &&
    position.operator !== "0x0000000000000000000000000000000000000000" &&
    address.toLowerCase() === position.operator.toLowerCase();

  const [tab, setTab] = useState<Tab>("stake");
  const [amount, setAmount] = useState("");

  const busy =
    tx.status === "preparing" || tx.status === "signing" || tx.status === "confirming";

  // On-chain values (base units → number for display/projection).
  const staked = Number(position.staked);
  const pending = Number(position.pending);
  const claimed = Number(position.totalClaimed);
  const walletBalance = Number(position.walletBalance);

  // Pool-wide funding / distribution (from on-chain reads).
  const funded = Number(position.fundedAmount);
  const emitted = Number(position.totalEmitted);
  // Tokens yet to be distributed = funded − already emitted. Then, per the
  // requested metric, minus the pool's outstanding (emitted-but-unclaimed)
  // rewards so it reflects tokens neither distributed nor owed.
  const emittedUnclaimed = Math.max(0, emitted - Number(position.poolTotalClaimed));
  const undistributed = Math.max(0, funded - emitted - emittedUnclaimed);

  const nowSec = useNow();
  // Tenure derived from the on-chain weighted deposit timestamp.
  const heldDays = useMemo(() => {
    const wts = Number(position.weightedDepositTs);
    if (!wts || staked <= 0) return 0;
    return Math.max(0, (nowSec - wts) / 86_400);
  }, [position.weightedDepositTs, staked, nowSec]);

  const tenureMultiplier = useMemo(
    () => tenureMultiplierAfter(Math.min(heldDays, summary.durationDays)),
    [heldDays, summary.durationDays]
  );

  const poolTvl = useMemo(() => Number(summary.stakeVaultBalance), [summary.stakeVaultBalance]);

  const toTok = (base: number) => base / scale;
  const parsed = Number(amount.replace(/,/g, ""));
  const parsedBase = isFinite(parsed) && parsed > 0 ? BigInt(Math.round(parsed * scale)) : BigInt(0);

  // Live pending ESTIMATE. The on-chain `pending` only changes when the pool is
  // cranked, so between cranks it looks frozen. To give stakers a live view
  // (no transaction), we project the estimated reward from the pool's on-chain
  // `lastUpdateTs` (the "as of" time for `pending`) to now. Anchoring to on-chain
  // state (not mount time) means the estimate is deterministic — it holds its
  // value and keeps accruing across page navigations, and lands near what a
  // crank would credit. This is display-only and labelled "est."; the CLAIMABLE
  // amount below always uses the real on-chain `pending`.
  const estPending = useMemo(() => {
    if (staked <= 0) return pending;
    const lastUpdate = Number(position.lastUpdateTs);
    const end = Number(position.endTs);
    if (!lastUpdate) return pending;
    // Accrue only up to the program end (emissions stop after endTs).
    const cappedNow = end > 0 ? Math.min(nowSec, end) : nowSec;
    const elapsedSec = Math.max(0, cappedNow - lastUpdate);

    // Real on-chain emission rate: the pool emits baseRatePerPeriod × emissionMult
    // per 20-minute period. The staker's share is yourWeight / totalWeight, where
    // yourWeight ≈ staked × tenureMultiplier (matches the contract's stake×tenure
    // weighting). This tracks what a crank actually credits — no fabricated rate.
    const PERIOD_SECONDS = 1200; // 20 min (StakingMath.PERIOD_SECONDS)
    const baseRate = Number(position.baseRatePerPeriod);
    const totalW = Number(position.totalWeight);
    if (baseRate <= 0 || totalW <= 0) return pending;
    // Emission multiplier ramps 1→2 over day 1 then plateaus at 2. Use the
    // program-elapsed ramp so early estimates aren't inflated.
    const startTs = Number(position.startTs);
    const rampDaysElapsed = startTs > 0 ? (cappedNow - startTs) / 86_400 : 0;
    const emissionMult = Math.min(2, 1 + Math.max(0, rampDaysElapsed)); // 1.0 → 2.0 over 1 day
    const yourWeight = staked * tenureMultiplier;
    const yourShare = Math.min(1, yourWeight / totalW);
    const perSecond = ((baseRate * emissionMult) / PERIOD_SECONDS) * yourShare;
    const drip = perSecond * elapsedSec;
    return pending + Math.max(0, drip);
  }, [
    pending,
    staked,
    nowSec,
    position.lastUpdateTs,
    position.endTs,
    position.startTs,
    position.baseRatePerPeriod,
    position.totalWeight,
    tenureMultiplier,
  ]);

  // Honest claim state. On-chain `pending` only realizes when the pool is
  // cranked across an HOURLY boundary (TENURE_STEP_SECONDS = 3600). A claim
  // cranks-then-claims, so it will pay out iff either (a) there is already
  // settled `pending`, or (b) at least one hourly boundary has elapsed since
  // the pool's `lastUpdateTs` (which the client-side crank will settle). The
  // live `estPending` is a continuous projection and must NOT gate the button,
  // or the user can sign a claim that transfers nothing.
  const TENURE_STEP = 3600; // seconds (StakingMath.TENURE_STEP_SECONDS)
  const claimBoundaryElapsed = useMemo(() => {
    if (staked <= 0) return false;
    const lastUpdate = Number(position.lastUpdateTs);
    const end = Number(position.endTs);
    if (!lastUpdate) return false;
    const cappedNow = end > 0 ? Math.min(nowSec, end) : nowSec;
    return cappedNow - lastUpdate >= TENURE_STEP;
  }, [staked, position.lastUpdateTs, position.endTs, nowSec]);

  // A claim will yield tokens now iff there's settled pending OR an hourly
  // boundary has elapsed since the last crank (the claim will settle it).
  const claimableNow = pending > 0 || claimBoundaryElapsed;

  // Seconds until the next hourly boundary settles (for the "next claim" hint).
  const secondsToNextBoundary = useMemo(() => {
    if (staked <= 0) return 0;
    const lastUpdate = Number(position.lastUpdateTs);
    const end = Number(position.endTs);
    if (!lastUpdate) return 0;
    const cappedNow = end > 0 ? Math.min(nowSec, end) : nowSec;
    if (end > 0 && nowSec >= end) return 0; // program ended
    const sinceBoundary = (cappedNow - lastUpdate) % TENURE_STEP;
    return Math.max(0, TENURE_STEP - sinceBoundary);
  }, [staked, position.lastUpdateTs, position.endTs, nowSec]);

  // Pool value in USD via the tiered resolver (Chainlink → DEX → null). Recomputed
  // when the pool's staked balance changes; null → render "—".
  const [usdValue, setUsdValue] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const v = await getPoolValueUsd(
        summary.token,
        summary.decimals || 18,
        summary.stakeVaultBalance
      ).catch(() => null);
      if (!cancelled) setUsdValue(v);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [summary.token, summary.decimals, summary.stakeVaultBalance]);

  const handleAction = async () => {
    reset();
    if (tab === "claim") {
      await claim();
      return;
    }
    if (parsedBase <= BigInt(0)) return;
    const ok = tab === "stake" ? await stake(parsedBase) : await unstake(parsedBase);
    if (ok) setAmount("");
  };

  // Real per-day estimate (base units) from the on-chain emission rate + share,
  // for the "Est. daily" metric — consistent with the live pending estimate.
  const estDailyReward = useMemo(() => {
    if (staked <= 0) return 0;
    const baseRate = Number(position.baseRatePerPeriod);
    const totalW = Number(position.totalWeight);
    if (baseRate <= 0 || totalW <= 0) return 0;
    const startTs = Number(position.startTs);
    const end = Number(position.endTs);
    const cappedNow = end > 0 ? Math.min(nowSec, end) : nowSec;
    const rampDaysElapsed = startTs > 0 ? (cappedNow - startTs) / 86_400 : 0;
    const emissionMult = Math.min(2, 1 + Math.max(0, rampDaysElapsed));
    const yourShare = Math.min(1, (staked * tenureMultiplier) / totalW);
    const PERIODS_PER_DAY = 72;
    return baseRate * emissionMult * PERIODS_PER_DAY * yourShare;
  }, [staked, position.baseRatePerPeriod, position.totalWeight, position.startTs, position.endTs, nowSec, tenureMultiplier]);

  const metrics = [
    { label: "Staked", value: formatCompact(toTok(staked)), accent: "hi" },
    { label: "Tenure mult", value: `${tenureMultiplier.toFixed(2)}x`, accent: "gold" },
    { label: "Pending (est.)", value: formatCompact(toTok(estPending)), accent: "pos" },
    { label: "Est. daily", value: formatCompact(toTok(estDailyReward)), accent: "gold" },
    { label: "Funding", value: formatCompact(toTok(funded)), accent: "mid" },
    { label: "Undistributed", value: formatCompact(toTok(undistributed)), accent: "mid" },
    { label: "Claimed", value: formatCompact(toTok(claimed)), accent: "mid" },
    { label: "Pool TVL", value: formatCompact(toTok(poolTvl)), accent: "mid" },
    { label: "Pool value (USD)", value: usdValue == null ? "—" : `$${formatCompact(usdValue)}`, accent: "mid" },
  ];

  const primaryLabel = !connected
    ? "Connect wallet"
    : busy
    ? tx.status === "signing"
      ? "Confirm in wallet…"
      : tx.status === "confirming"
      ? "Confirming…"
      : "Preparing…"
    : tab === "stake"
    ? "Stake"
    : tab === "unstake"
    ? "Unstake"
    : "Claim rewards";

  const inputDisabled = tab !== "claim" && !amount;
  const actionDisabled =
    busy ||
    (connected && tab !== "claim" && !amount) ||
    (connected && tab === "claim" && !claimableNow) ||
    (connected && position.paused && tab === "stake");

  return (
    <ConsoleShell
      tab={tab}
      setTab={(t) => {
        setTab(t);
        setAmount("");
        reset();
      }}
      metrics={metrics}
      headerRight={
        enabled && position.started ? (
          <span className="flex items-center gap-1.5">
            <span className="label-term !text-[9px]">Next period</span>
            <CrankCountdown
              startTs={position.startTs}
              endTs={position.endTs}
              onBoundaryReached={refetch}
            />
          </span>
        ) : undefined
      }
      note={
        enabled
          ? position.paused
            ? "This pool is paused — staking is disabled. You can still unstake and claim."
            : usdValue == null
            ? "Pool value (USD) shows “—” when no price source resolves this token (Chainlink feed or DEX pair). It populates automatically once a feed/pair exists."
            : undefined
          : "Connect an EVM wallet to view your position and stake in this pool."
      }
    >
      {tab !== "claim" ? (
        <label className="block mb-4">
          <div className="flex items-center justify-between">
            <span className="label-term">Amount</span>
            <button
              type="button"
              onClick={() =>
                setAmount(
                  String(toTok(tab === "stake" ? walletBalance : staked))
                )
              }
              className="label-term !text-[9px] hover:text-gold-neon transition-colors"
            >
              {tab === "stake"
                ? `Bal: ${formatCompact(toTok(walletBalance))} · MAX`
                : `Staked: ${formatCompact(toTok(staked))} · MAX`}
            </button>
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            disabled={busy}
            className="input-term mt-1.5 disabled:opacity-50"
          />
          {tab === "stake" && summary.stakeTaxBps > 0 && (
            <span className="label-term !text-[9px] !normal-case !tracking-normal text-lo mt-1 block">
              {(summary.stakeTaxBps / 100).toFixed(2)}% stake tax applies.
            </span>
          )}
          {tab === "stake" && position.minStake > BigInt(0) && (
            <span
              className={`label-term !text-[9px] !normal-case !tracking-normal mt-1 block ${
                parsedBase > BigInt(0) && parsedBase < position.minStake
                  ? "text-amber-neon"
                  : "text-lo"
              }`}
            >
              Minimum stake: {formatCompact(toTok(Number(position.minStake)))} {sym}
              {parsedBase > BigInt(0) && parsedBase < position.minStake
                ? " — amount is below the minimum."
                : ""}
            </span>
          )}
        </label>
      ) : (
        <div className="mb-4 rounded-xl border border-black/[0.06] bg-black/[0.02] p-4 text-center">
          <div className="label-term">
            {claimableNow ? "Claimable now" : "Projected (not yet claimable)"}
          </div>
          <div className={`mono text-2xl font-bold mt-1 ${claimableNow ? "text-pos" : "text-lo"}`}>
            {formatCompact(toTok(estPending))}
          </div>
          <div className="label-term !text-[8px] !normal-case !tracking-normal text-lo mt-1">
            settled on-chain: {formatCompact(toTok(pending))}
          </div>
          {!claimableNow && staked > 0 && secondsToNextBoundary > 0 && (
            <div className="label-term !text-[8px] !normal-case !tracking-normal text-lo mt-1">
              claimable in ~{formatCountdown(secondsToNextBoundary)} (next hourly checkpoint)
            </div>
          )}
        </div>
      )}

      {tab === "unstake" && (
        <p className="label-term !text-[9px] !tracking-normal !normal-case text-amber-neon mb-3">
          ⚠ Unstaking applies a {(summary.unstakeTaxBps / 100).toFixed(2)}% exit tax
          and resets your tenure multiplier to 1.00x.
        </p>
      )}

      <button
        className="btn-neon mt-auto disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={actionDisabled || (connected && inputDisabled)}
        onClick={handleAction}
      >
        {primaryLabel}
      </button>

      {/* Sync rewards: cranks the pool so emissions advance across hourly
          boundaries and `pending` grows from 0. Permissionless (gas only). */}
      {connected && position.started && (
        <button
          type="button"
          className="mt-2 h-9 rounded-xl text-xs font-semibold text-lo hover:text-hi
                     border border-black/10 disabled:opacity-40"
          disabled={busy}
          onClick={async () => {
            reset();
            await crank();
          }}
          title="Advance the pool's emissions to now so rewards accrue"
        >
          Sync rewards
        </button>
      )}
      {connected && !claimableNow && staked > 0 && (
        <p className="label-term !text-[9px] !tracking-normal !normal-case text-lo mt-2 leading-snug">
          Rewards settle at hourly checkpoints. Your projected amount above is
          accruing continuously but becomes claimable once the next hourly
          checkpoint passes{secondsToNextBoundary > 0 ? ` (~${formatCountdown(secondsToNextBoundary)})` : ""}.
          Claiming then settles and pays out automatically.
        </p>
      )}

      {/* Auto-claim (opt-in). The contract can't push rewards, so this
          periodically claims on your behalf — each claim still needs a wallet
          signature + gas. */}
      {connected && (
        <label className="mt-3 flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoClaim}
            onChange={(e) => setAutoClaim(e.target.checked)}
            className="mt-0.5"
          />
          <span className="label-term !text-[9px] !tracking-normal !normal-case text-lo leading-snug">
            Auto-claim my rewards. Periodically claims for you when rewards are
            pending — each claim still needs a wallet signature and gas (the pool
            can’t send rewards without one).
          </span>
        </label>
      )}

      {/* Treasury tax payout — visible only to the pool creator (operator).
          Stake/unstake taxes are collected into the pool (owedToTreasury,
          pull-payment); the creator pushes them to the treasury with this. */}
      {isCreator && Number(position.owedToTreasury) > 0 && (
        <div className="mt-3 rounded-xl border border-black/[0.06] bg-black/[0.02] p-3">
          <div className="flex items-center justify-between">
            <span className="label-term !text-[9px]">Tax owed to treasury</span>
            <span className="mono text-sm font-bold text-gold-neon">
              {formatCompact(toTok(Number(position.owedToTreasury)))}
            </span>
          </div>
          <button
            type="button"
            className="mt-2 h-9 w-full rounded-xl text-xs font-semibold text-lo hover:text-hi
                       border border-black/10 cursor-pointer disabled:opacity-40"
            disabled={busy}
            onClick={async () => {
              reset();
              await withdrawTreasury();
            }}
            title="Send the collected stake/unstake tax to the pool's treasury"
          >
            Send tax to treasury
          </button>
          <p className="label-term !text-[8px] !normal-case !tracking-normal text-lo mt-1 leading-snug">
            Only you (the pool creator) see this. Taxes are held in the pool until
            sent; this pays the pool’s fixed treasury.
          </p>
        </div>
      )}

      {tx.status === "success" && tx.txHash && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-pos break-all">
          ✓ Sent.{" "}
          <a
            href={`${robinhoodExplorerUrl}/tx/${tx.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {tx.txHash.slice(0, 8)}…{tx.txHash.slice(-8)}
          </a>
        </div>
      )}
      {tx.status === "error" && tx.error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-amber-neon break-words">
          ✕ {tx.error}
        </div>
      )}
    </ConsoleShell>
  );
}

// ── Preview (simulated) console ──────────────────────────────────────────────

function PreviewConsole({ summary }: { summary: PoolSummary }) {
  const decimals = summary.decimals || 18;
  const scale = 10 ** decimals;
  const sym = summary.symbol ? summary.symbol.toUpperCase() : "TOKENS";

  const [tab, setTab] = useState<Tab>("stake");
  const [amount, setAmount] = useState("");
  const [staked, setStaked] = useState(0);
  const [pending, setPending] = useState(0);
  const [claimed, setClaimed] = useState(0);
  const [stakeStartSec, setStakeStartSec] = useState<number | null>(null);

  const nowSec = useNow();
  const heldDays = useMemo(() => {
    if (!stakeStartSec) return 0;
    return Math.max(0, (nowSec - stakeStartSec) / 86_400);
  }, [stakeStartSec, nowSec]);

  const tenureMultiplier = useMemo(
    () => tenureMultiplierAfter(Math.min(heldDays, summary.durationDays)),
    [heldDays, summary.durationDays]
  );

  const poolTvl = useMemo(() => Number(summary.stakeVaultBalance), [summary.stakeVaultBalance]);
  const baseRatePerTick = useMemo(() => {
    const totalTicks = Math.max(1, summary.durationDays * TICKS_PER_DAY);
    return Math.max(scale, poolTvl * 0.8) / totalTicks;
  }, [summary.durationDays, poolTvl, scale]);

  const daily = useMemo(
    () =>
      projectRewards({
        stake: staked,
        tvl: poolTvl + staked,
        baseRatePerTick,
        emissionMultiplier: 1.5,
        tenureMultiplier,
        poolAvgMultiplier: 1.4,
        horizonDays: 1,
      }),
    [staked, poolTvl, baseRatePerTick, tenureMultiplier]
  );

  const toTok = (base: number) => base / scale;
  const parsed = Number(amount.replace(/,/g, ""));
  const parsedBase = isFinite(parsed) && parsed > 0 ? Math.round(parsed * scale) : 0;

  const handleAction = () => {
    if (tab === "stake") {
      if (parsedBase <= 0) return;
      const afterTax = Math.round(parsedBase * (1 - summary.stakeTaxBps / BPS_DENOM));
      setStaked((s) => s + afterTax);
      setStakeStartSec((prev) => prev ?? Date.now() / 1000);
      setPending((p) => p + Math.round(daily.dailyReward));
      setAmount("");
    } else if (tab === "unstake") {
      if (parsedBase <= 0 || staked <= 0) return;
      const amt = Math.min(parsedBase, staked);
      const remaining = staked - amt;
      setStaked(remaining);
      setStakeStartSec(remaining > 0 ? Date.now() / 1000 : null);
      setAmount("");
    } else {
      if (pending <= 0) return;
      setClaimed((c) => c + pending);
      setPending(0);
    }
  };

  const metrics = [
    { label: "Staked", value: formatCompact(toTok(staked)), accent: "hi" },
    { label: "Tenure mult", value: `${tenureMultiplier.toFixed(2)}x`, accent: "gold" },
    { label: "Pending", value: formatCompact(toTok(pending)), accent: "pos" },
    { label: "Est. daily", value: formatCompact(toTok(daily.dailyReward)), accent: "gold" },
    { label: "Claimed", value: formatCompact(toTok(claimed)), accent: "mid" },
    { label: "Pool TVL", value: formatCompact(toTok(poolTvl)), accent: "mid" },
  ];

  const inputDisabled = tab !== "claim" && !amount;
  const actionDisabled =
    (tab === "stake" && parsedBase <= 0) ||
    (tab === "unstake" && (parsedBase <= 0 || staked <= 0)) ||
    (tab === "claim" && pending <= 0);

  return (
    <ConsoleShell
      tab={tab}
      setTab={(t) => {
        setTab(t);
        setAmount("");
      }}
      metrics={metrics}
      note="Preview pool — actions run a local simulation (no on-chain contract)."
    >
      {tab !== "claim" ? (
        <label className="block mb-4">
          <div className="flex items-center justify-between">
            <span className="label-term">Amount</span>
            <button
              type="button"
              onClick={() => tab === "unstake" && setAmount(String(toTok(staked)))}
              className="label-term !text-[9px] hover:text-gold-neon transition-colors"
            >
              {tab === "stake" ? sym : `Staked: ${formatCompact(toTok(staked))} · MAX`}
            </button>
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="input-term mt-1.5"
          />
          {tab === "stake" && summary.stakeTaxBps > 0 && (
            <span className="label-term !text-[9px] !normal-case !tracking-normal text-lo mt-1 block">
              {(summary.stakeTaxBps / 100).toFixed(2)}% stake tax applies.
            </span>
          )}
        </label>
      ) : (
        <div className="mb-4 rounded-xl border border-black/[0.06] bg-black/[0.02] p-4 text-center">
          <div className="label-term">Claimable</div>
          <div className="mono text-2xl font-bold text-pos mt-1">
            {formatCompact(toTok(pending))}
          </div>
        </div>
      )}

      {tab === "unstake" && (
        <p className="label-term !text-[9px] !tracking-normal !normal-case text-amber-neon mb-3">
          ⚠ Unstaking applies a {(summary.unstakeTaxBps / 100).toFixed(2)}% exit tax
          and resets your tenure multiplier to 1.00x.
        </p>
      )}

      <button
        className="btn-neon mt-auto disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={actionDisabled || inputDisabled}
        onClick={handleAction}
      >
        {tab === "stake" ? "Stake" : tab === "unstake" ? "Unstake" : "Claim rewards"}
      </button>
    </ConsoleShell>
  );
}

// ── Shared layout shell ──────────────────────────────────────────────────────

type Metric = { label: string; value: string; accent: string };

function ConsoleShell({
  tab,
  setTab,
  metrics,
  note,
  headerRight,
  children,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  metrics: Metric[];
  note?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const colorFor = (a: string) =>
    a === "pos" ? "text-pos" : a === "gold" ? "text-gold-neon" : a === "mid" ? "text-mid" : "text-hi";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
      {/* Position dashboard */}
      <div className="lg:col-span-2 glass p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-hi tracking-tight">
            Position Dashboard
          </h2>
          {headerRight ?? <span className="label-term">This pool</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-3">
              <div className="label-term !text-[9px]">{m.label}</div>
              <div className={`mono text-lg font-bold ${colorFor(m.accent)} leading-tight mt-1`}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
        {note && (
          <p className="label-term !text-[9px] !tracking-normal !normal-case text-lo mt-4 leading-snug">
            {note}
          </p>
        )}
      </div>

      {/* Action console */}
      <div className="glass glass-gold p-5 flex flex-col">
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {(["stake", "unstake", "claim"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pill ${tab === t ? "active" : ""}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
