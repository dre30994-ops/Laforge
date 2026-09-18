import { useState } from "react";
import {
  formatCompact,
  projectRewards,
  toBaseUnits,
  toTokens,
  usePoolStats,
} from "@/lib/economics";
import { useStaking } from "@/hooks/useStaking";
import { usePosition } from "@/hooks/usePosition";
import { useConnectedAccount } from "@/hooks/useConnectedAccount";
import { useI18n } from "@/components/LanguageProvider";

type Tab = "stake" | "unstake" | "claim";

/**
 * Bottom module: live position metrics on the left, a compact terminal-style
 * action console on the right. The primary action is dimmed and inert until a
 * wallet is connected from the sidebar — this strip does not prompt connect.
 */
export function PositionStrip() {
  const { t } = useI18n();
  const stats = usePoolStats();
  const [tab, setTab] = useState<Tab>("stake");
  const [amount, setAmount] = useState("");

  const { connected, family } = useConnectedAccount();
  const { stake, unstake, claim, reset, result, walletReady } = useStaking();
  const { data: pos, refetch, enabled: posEnabled } = usePosition();
  const busy = result.status === "building" || result.status === "signing";

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
    { key: "staked", value: formatCompact(toTokens(yourStake)), accent: "hi" },
    { key: "tenure", value: `${yourMultiplier.toFixed(2)}x`, accent: "gold" },
    { key: "pending", value: formatCompact(toTokens(yourPending)), accent: "pos" },
    { key: "daily", value: formatCompact(toTokens(daily.dailyReward)), accent: "gold" },
    { key: "avg", value: `${stats.poolAvgMultiplier.toFixed(2)}x`, accent: "mid" },
    { key: "left", value: formatCompact(toTokens(stats.remaining)), accent: "mid" },
  ];

  const colorFor = (a: string) =>
    a === "pos" ? "text-pos" : a === "gold" ? "text-gold-neon" : a === "mid" ? "text-mid" : "text-hi";

  const actionLabel = tab === "stake" ? t("position.stake") : tab === "unstake" ? t("position.unstake") : t("position.claimRewards");

  const primaryLabel = !connected
    ? t("wallet.connect")
    : busy
    ? result.status === "signing"
      ? t("position.confirmWallet")
      : t("position.preparing")
    : actionLabel;

  const handleAction = async () => {
    if (!connected) return;
    if (family !== "solana") return;
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

  const switchTab = (next: Tab) => {
    setTab(next);
    setAmount("");
    reset();
  };

  const actionDisabled =
    !connected ||
    busy ||
    family !== "solana" ||
    !walletReady ||
    (tab !== "claim" && !amount);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch animate-rise">
      <div className="lg:col-span-2 glass p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-hi tracking-tight">{t("position.title")}</h2>
          <span className="label-term">{t("position.live")}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {metrics.map((m) => (
            <div key={m.key} className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-3">
              <div className="label-term !text-[9px]">{t(`position.${m.key}`)}</div>
              <div className={`mono text-lg font-bold ${colorFor(m.accent)} leading-tight mt-1`}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass glass-gold p-5 flex flex-col">
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {(["stake", "unstake", "claim"] as Tab[]).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => switchTab(tabKey)}
              disabled={busy}
              className={`pill ${tab === tabKey ? "active" : ""}`}
            >
              {t(`position.${tabKey}`)}
            </button>
          ))}
        </div>

        {tab !== "claim" ? (
          <label className="block mb-4">
            <div className="flex items-center justify-between">
              <span className="label-term">{t("position.amount")}</span>
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
                  {tab === "stake"
                    ? t("position.maxBal", { n: formatCompact(toTokens(yourBalance)) })
                    : t("position.max", { n: formatCompact(toTokens(yourStake)) })}
                </button>
              )}
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              disabled={busy || !connected}
              className="input-term mt-1.5 disabled:opacity-50"
            />
          </label>
        ) : (
          <div className="mb-4 rounded-xl border border-black/[0.06] bg-black/[0.02] p-4 text-center">
            <div className="label-term">{t("position.claimable")}</div>
            <div className="mono text-2xl font-bold text-pos mt-1">
              {formatCompact(toTokens(yourPending))}
            </div>
          </div>
        )}

        {tab === "unstake" && (
          <p className="label-term !text-[9px] !tracking-normal !normal-case text-amber-neon mb-3">
            ⚠ {t("position.unstakeWarn")}
          </p>
        )}

        <button
          className="btn-neon mt-auto"
          disabled={actionDisabled}
          onClick={handleAction}
          aria-disabled={!connected}
          title={!connected ? "Connect from the sidebar to stake" : undefined}
          style={
            connected
              ? undefined
              : {
                  background: "linear-gradient(180deg, #22c55e, #16a34a)",
                  color: "#fff",
                  opacity: 0.4,
                  cursor: "not-allowed",
                  pointerEvents: "none",
                  boxShadow: "none",
                }
          }
        >
          {primaryLabel}
        </button>
        {connected && family !== "solana" && (
          <p className="label-term !text-[9px] !tracking-normal !normal-case mt-2 leading-snug">
            {t("position.evmHint")}
          </p>
        )}

        {result.status === "success" && result.signature && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-pos break-all">
            ✓ {t("position.sent")}{" "}
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
