import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import {
  formatCompact,
  projectRewards,
  toTokens,
} from "@/lib/economics";
import { poolToStats } from "@/lib/poolStats";
import { useEvmPoolActions } from "@/hooks/useEvmPoolActions";
import { getMockPosition, isMockPoolAddress, MOCK_DEMO_USER } from "@/lib/mockPools";
import { explorerTxUrl, type EvmNetwork } from "@/lib/evmNetworks";
import type { PoolSummary } from "@/lib/factoryClient";
import { useLiveClaimable } from "@/hooks/useLiveClaimable";
import { useConnectedAccount } from "@/hooks/useConnectedAccount";

type Tab = "stake" | "unstake" | "claim";

export function PoolActionStrip({
  pool,
  network,
  onUpdated,
}: {
  pool: PoolSummary;
  network: EvmNetwork;
  onUpdated?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("stake");
  const [amount, setAmount] = useState("");
  const { address } = useConnectedAccount();
  const actions = useEvmPoolActions(pool, network);
  const mock = isMockPoolAddress(pool.pool);
  const { display: liveClaimable } = useLiveClaimable(mock ? undefined : pool.pool, pool.chainId);

  const pos = mock
    ? getMockPosition(pool.chainId, pool.pool, address || MOCK_DEMO_USER)
    : null;
  const yourStake = pos ? Number(formatUnits(pos.staked, pool.decimals || 6)) : 0;
  const yourPending = pos ? Number(formatUnits(pos.pending, pool.decimals || 6)) : 0;
  const stats = useMemo(
    () => poolToStats(pool, Date.now() / 1000, mock ? yourStake : undefined, mock ? yourPending : undefined),
    [pool, mock, yourStake, yourPending],
  );

  const daily = projectRewards({
    stake: stats.yourStake,
    tvl: stats.tvl,
    baseRatePerTick: stats.currentRate,
    emissionMultiplier: stats.emissionMultiplier,
    tenureMultiplier: stats.yourMultiplier,
    poolAvgMultiplier: stats.poolAvgMultiplier,
    horizonDays: 1,
  });

  const metrics = [
    { label: "Staked", value: formatCompact(mock ? yourStake : toTokens(stats.yourStake)), accent: "hi" },
    { label: "Tenure mult", value: `${stats.yourMultiplier.toFixed(2)}x`, accent: "gold" },
    {
      label: "Pending",
      value: mock ? formatCompact(yourPending) : liveClaimable || formatCompact(toTokens(stats.yourPending)),
      accent: "pos",
    },
    { label: "Est. daily", value: formatCompact(toTokens(daily.dailyReward)), accent: "gold" },
    { label: "Pool avg mult", value: `${stats.poolAvgMultiplier.toFixed(2)}x`, accent: "mid" },
    { label: "Pool left", value: formatCompact(toTokens(stats.remaining)), accent: "mid" },
  ];

  const colorFor = (a: string) =>
    a === "pos" ? "text-pos" : a === "gold" ? "text-gold-neon" : a === "mid" ? "text-mid" : "text-hi";

  const busy = actions.status === "pending";
  const actionLabel = tab === "stake" ? "Stake" : tab === "unstake" ? "Unstake" : "Claim rewards";
  const primaryLabel = busy ? "Confirming…" : mock && !address ? `Demo ${actionLabel}` : actionLabel;

  async function handleAction() {
    if (tab === "claim") {
      await actions.claim();
    } else if (tab === "stake") {
      await actions.stake(amount);
    } else {
      await actions.unstake(amount);
    }
    setAmount("");
    onUpdated?.();
  }

  const actionDisabled = busy || (tab !== "claim" && !amount.trim());

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch animate-rise" data-testid="pool-action-strip">
      <div className="lg:col-span-2 glass p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-hi tracking-tight">Your Position</h2>
          <span className="label-term">{mock ? "Demo" : "Live"}</span>
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

      <div className="glass glass-gold p-5 flex flex-col">
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {(["stake", "unstake", "claim"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setAmount("");
              }}
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
              {mock && tab === "unstake" && (
                <button
                  type="button"
                  onClick={() => setAmount(yourStake.toString())}
                  className="label-term !text-[9px] hover:text-gold-neon transition-colors"
                >
                  Staked: {formatCompact(yourStake)} · MAX
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
              {mock ? formatCompact(yourPending) : liveClaimable || "0.00"}
            </div>
          </div>
        )}

        {tab === "unstake" && (
          <p className="label-term !text-[9px] !tracking-normal !normal-case text-amber-neon mb-3">
            Unstaking resets tenure to 1.00x. Tax is sent to this pool’s treasury.
          </p>
        )}

        <button className="btn-neon mt-auto" disabled={actionDisabled} onClick={() => void handleAction()}>
          {primaryLabel}
        </button>

        {mock && (
          <p className="label-term !text-[9px] !tracking-normal !normal-case mt-2 leading-snug">
            Demo pool — stake, unstake, and claim update this vault locally so you can preview the dashboard.
          </p>
        )}

        {actions.message && (
          <div
            className={`mt-3 rounded-lg p-2 text-[11px] break-words ${
              actions.status === "error"
                ? "border border-red-500/30 bg-red-500/10 text-amber-neon"
                : "border border-emerald-500/30 bg-emerald-500/10 text-pos"
            }`}
          >
            {actions.status === "error" ? "✕ " : "✓ "}
            {actions.message}
            {actions.txHash && (
              <>
                {" "}
                <a
                  href={explorerTxUrl(network, actions.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {actions.txHash.slice(0, 8)}…{actions.txHash.slice(-6)}
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
