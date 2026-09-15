"use client";

import { useState } from "react";
import {
  formatCompact,
  projectRewards,
  toBaseUnits,
  toTokens,
  usePoolStats,
} from "@/lib/economics";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { useStaking } from "@/hooks/useStaking";
import { usePosition } from "@/hooks/usePosition";

type Tab = "stake" | "unstake" | "claim";

/**
 * Bottom module: live position metrics on the left, a compact terminal-style
 * action console on the right. When a wallet is connected, metrics reflect the
 * real on-chain position (read via Solana RPC); otherwise they fall back to the
 * illustrative pool model so the dashboard still looks alive.
 */
export function PositionStrip() {
  const stats = usePoolStats();
  const [tab, setTab] = useState<Tab>("stake");
  const [amount, setAmount] = useState("");

  const { connected, login } = useSolanaWallet();
  const { stake, unstake, claim, reset, result, walletReady } = useStaking();
  const { data: pos, refetch, enabled: posEnabled } = usePosition();
  const busy = result.status === "building" || result.status === "signing";

  // Prefer real on-chain values when we can read them; otherwise fall back to
  // the illustrative model so a disconnected visitor still sees numbers.
  const yourStake = posEnabled ? Number(pos.staked) : stats.yourStake;
  const yourPending = posEnabled ? Number(pos.pending) : stats.yourPending;
  const yourMultiplier = posEnabled ? pos.tenureMultiplier : stats.yourMultiplier;
  const yourBalance = posEnabled ? Number(pos.walletBalance) : 0;

  const daily = projectRewards({
    stake: yourStake,
    tvl: stats.tvl,
    baseRatePerTick: stats.currentRate,
    emissionMultiplier: stats.emissionMultiplier,
    tenureMultiplier: yourMultiplier,
    poolAvgMultiplier: stats.poolAvgMultiplier,
    horizonDays: 1,
  });

  const metrics = [
    { label: "Staked", value: formatCompact(toTokens(yourStake)), accent: "hi" },
    { label: "Tenure mult", value: `${yourMultiplier.toFixed(2)}x`, accent: "gold" },
    { label: "Pending", value: formatCompact(toTokens(yourPending)), accent: "pos" },
    { label: "Est. daily", value: formatCompact(toTokens(daily.dailyReward)), accent: "gold" },
    { label: "Pool avg mult", value: `${stats.poolAvgMultiplier.toFixed(2)}x`, accent: "mid" },
    { label: "Pool left", value: formatCompact(toTokens(stats.remaining)), accent: "mid" },
  ];

  const colorFor = (a: string) =>
    a === "pos" ? "text-pos" : a === "gold" ? "text-gold-neon" : a === "mid" ? "text-mid" : "text-hi";

  const actionLabel = tab === "stake" ? "Stake" : tab === "unstake" ? "Unstake" : "Claim rewards";

  const primaryLabel = !connected
    ? "Connect wallet"
    : busy
    ? result.status === "signing"
      ? "Confirm in wallet…"
      : "Preparing…"
    : actionLabel;

  const handleAction = async () => {
    if (!connected) {
      login();
      return;
    }
    reset();
    if (tab === "claim") {
      const sig = await claim();
      if (sig) void refetch();
      return;
    }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const base = BigInt(toBaseUnits(parsed));
    const sig = tab === "stake" ? await stake(base) : await unstake(base);
    if (sig) {
      setAmount("");
      void refetch();
    }
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setAmount("");
    reset();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch animate-rise">
      {/* Live position metrics */}
      <div className="lg:col-span-2 glass p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-hi tracking-tight">Your Position</h2>
          <span className="label-term">Live</span>
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
      </div>

      {/* Action console */}
      <div className="glass glass-gold p-5 flex flex-col">
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {(["stake", "unstake", "claim"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              disabled={busy}
              className={`pill ${tab === t ? "active" : ""}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab !== "claim" ? (
          <label className="block mb-4">
            <div className="flex items-center justify-between">
              <span className="label-term">Amount</span>
              {posEnabled && (
                <button
                  type="button"
                  onClick={() =>
                    setAmount(
                      toTokens(tab === "stake" ? yourBalance : yourStake).toString()
                    )
                  }
                  className="label-term !text-[9px] hover:text-gold-neon transition-colors"
                >
                  {tab === "stake" ? "Bal" : "Staked"}:{" "}
                  {formatCompact(toTokens(tab === "stake" ? yourBalance : yourStake))} · MAX
                </button>
              )}
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
          </label>
        ) : (
          <div className="mb-4 rounded-xl border border-black/[0.06] bg-black/[0.02] p-4 text-center">
            <div className="label-term">Claimable</div>
            <div className="mono text-2xl font-bold text-pos mt-1">
              {formatCompact(toTokens(yourPending))}
            </div>
          </div>
        )}

        {tab === "unstake" && (
          <p className="label-term !text-[9px] !tracking-normal !normal-case text-amber-neon mb-3">
            ⚠ Unstaking resets your tenure multiplier to 1.00x.
          </p>
        )}

        <button
          className="btn-neon mt-auto"
          disabled={!connected || busy || (connected && tab !== "claim" && !amount) || (connected && !walletReady)}
          onClick={handleAction}
        >
          {primaryLabel}
        </button>

        {result.status === "success" && result.signature && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-pos break-all">
            ✓ Sent.{" "}
            <a
              href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {result.signature.slice(0, 8)}…{result.signature.slice(-8)}
            </a>
          </div>
        )}
        {result.status === "error" && result.error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-amber-neon break-words">
            ✕ {result.error}
          </div>
        )}
      </div>
    </div>
  );
}
