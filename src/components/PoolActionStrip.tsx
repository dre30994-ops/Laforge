import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress } from "viem";
import { useConfig } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import {
  formatCompact,
  projectRewards,
  toTokens,
} from "@/lib/economics";
import { poolToStats } from "@/lib/poolStats";
import { useEvmPoolActions } from "@/hooks/useEvmPoolActions";
import { getMockPosition, isMockPoolAddress, MOCK_DEMO_USER } from "@/lib/mockPools";
import { explorerTxUrl, type EvmNetwork } from "@/lib/evmNetworks";
import { poolStatus, claimHolderReward, readHolderRewardTokens, readPendingHolderReward, syncHolderReward, ERC20_METADATA_ABI, getPublicClient, type PoolSummary } from "@/lib/factoryClient";
import { useLiveClaimable } from "@/hooks/useLiveClaimable";
import { useConnectedAccount } from "@/hooks/useConnectedAccount";
import { useI18n } from "@/components/LanguageProvider";

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
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("stake");
  const [amount, setAmount] = useState("");
  const [holderRows, setHolderRows] = useState<{ token: string; symbol: string; decimals: number; pending: bigint }[]>([]);
  const [payoutDraft, setPayoutDraft] = useState("");
  const [holderBusy, setHolderBusy] = useState(false);
  const [holderMsg, setHolderMsg] = useState("");
  const config = useConfig();
  const { address } = useConnectedAccount();
  const actions = useEvmPoolActions(pool, network);
  const mock = isMockPoolAddress(pool.pool);

  useEffect(() => {
    if (mock) return;
    let cancel = false;
    (async () => {
      try {
        const client = getPublicClient(network);
        const tokens = await readHolderRewardTokens(pool.pool, network);
        const next = [];
        for (const token of tokens) {
          const [symbol, decimals, pending] = await Promise.all([
            client.readContract({
              address: token as `0x${string}`,
              abi: ERC20_METADATA_ABI,
              functionName: "symbol",
            }).catch(() => "???") as Promise<string>,
            client.readContract({
              address: token as `0x${string}`,
              abi: ERC20_METADATA_ABI,
              functionName: "decimals",
            }).catch(() => 18) as Promise<number>,
            address ? readPendingHolderReward(pool.pool, address, token, network) : Promise.resolve(0n),
          ]);
          next.push({ token, symbol, decimals: Number(decimals) || 18, pending });
        }
        if (!cancel) setHolderRows(next);
      } catch {
        if (!cancel) setHolderRows([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [mock, pool.pool, network, address, actions.status, holderBusy]);

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
    { key: "staked", value: formatCompact(mock ? yourStake : toTokens(stats.yourStake)), accent: "hi" },
    { key: "tenure", value: `${stats.yourMultiplier.toFixed(2)}x`, accent: "gold" },
    {
      key: "pending",
      value: mock ? formatCompact(yourPending) : liveClaimable || formatCompact(toTokens(stats.yourPending)),
      accent: "pos",
    },
    { key: "daily", value: formatCompact(toTokens(daily.dailyReward)), accent: "gold" },
    { key: "avg", value: `${stats.poolAvgMultiplier.toFixed(2)}x`, accent: "mid" },
    { key: "left", value: formatCompact(toTokens(stats.remaining)), accent: "mid" },
  ];

  const colorFor = (a: string) =>
    a === "pos" ? "text-pos" : a === "gold" ? "text-gold-neon" : a === "mid" ? "text-mid" : "text-hi";

  const busy = actions.status === "pending";
  const actionLabel = tab === "stake" ? t("position.stake") : tab === "unstake" ? t("position.unstake") : t("position.claimRewards");
  const primaryLabel = busy
    ? t("position.confirming")
    : mock && !address
    ? t("position.demoAction", { action: actionLabel })
    : actionLabel;

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

  async function claimHolder(token: string) {
    setHolderBusy(true);
    setHolderMsg("");
    try {
      const wallet = await getWalletClient(config, { chainId: network.chain.id });
      if (!wallet) throw new Error(t("pool.connectWalletTaxes"));
      await claimHolderReward(wallet, pool.pool, network, token);
      setHolderMsg(t("holder.claimed"));
      onUpdated?.();
    } catch (e: unknown) {
      setHolderMsg(e instanceof Error ? e.message : t("holder.failed"));
    } finally {
      setHolderBusy(false);
    }
  }

  async function trackPayout() {
    const token = payoutDraft.trim();
    if (!isAddress(token)) {
      setHolderMsg(t("holder.bad"));
      return;
    }
    setHolderBusy(true);
    setHolderMsg("");
    try {
      const wallet = await getWalletClient(config, { chainId: network.chain.id });
      if (!wallet) throw new Error(t("pool.connectWalletTaxes"));
      await syncHolderReward(wallet, pool.pool, network, token);
      setPayoutDraft("");
      setHolderMsg(t("holder.synced"));
    } catch (e: unknown) {
      setHolderMsg(e instanceof Error ? e.message : t("holder.failed"));
    } finally {
      setHolderBusy(false);
    }
  }

  const lifecycle = poolStatus(pool);
  const ended = lifecycle === "ended";
  const actionDisabled =
    busy || (tab === "stake" && ended) || (tab !== "claim" && !amount.trim());

  return (
    <div className="space-y-6 animate-rise">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch" data-testid="pool-action-strip">
      <div className="lg:col-span-2 glass p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-hi tracking-tight">{t("position.title")}</h2>
          <span className="label-term">{mock ? t("position.demo") : t(`status.${lifecycle}`)}</span>
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
              type="button"
              onClick={() => {
                setTab(tabKey);
                setAmount("");
              }}
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
              {mock && tab === "unstake" && (
                <button
                  type="button"
                  onClick={() => setAmount(yourStake.toString())}
                  className="label-term !text-[9px] hover:text-gold-neon transition-colors"
                >
                  {t("position.max", { n: formatCompact(yourStake) })}
                </button>
              )}
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              disabled={busy || (tab === "stake" && ended)}
              className="input-term mt-1.5 disabled:opacity-50"
            />
          </label>
        ) : (
          <div className="mb-4 rounded-xl border border-black/[0.06] bg-black/[0.02] p-4 text-center">
            <div className="label-term">{t("position.claimable")}</div>
            <div className="mono text-2xl font-bold text-pos mt-1">
              {mock ? formatCompact(yourPending) : liveClaimable || "0.00"}
            </div>
          </div>
        )}

        {tab === "unstake" && (
          <p className="label-term !text-[9px] !tracking-normal !normal-case text-amber-neon mb-3">
            {t("position.unstakeWarn")}
          </p>
        )}
        {ended && tab === "stake" && (
          <p className="label-term !text-[9px] !tracking-normal !normal-case text-lo mb-3">
            {t("position.endedHint")}
          </p>
        )}

        <button className="btn-neon mt-auto" disabled={actionDisabled} onClick={() => void handleAction()}>
          {primaryLabel}
        </button>

        {mock && (
          <p className="label-term !text-[9px] !tracking-normal !normal-case mt-2 leading-snug">
            {t("position.demoHint")}
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

    <section className="glass !rounded-2xl p-5" data-testid="holder-rewards">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-hi">{t("holder.title")}</h2>
          <p className="text-xs text-mid mt-1 leading-relaxed max-w-xl">{t("holder.body")}</p>
        </div>
      </div>

      {holderRows.length === 0 ? (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-4 py-3 min-w-[10rem]">
            <div className="label-term">{t("holder.yourShare")}</div>
            <div className="mono text-lg font-bold text-hi mt-1">0</div>
            <div className="text-[11px] text-lo mt-1">{t("holder.waiting")}</div>
          </div>
          <button type="button" className="btn-neon" disabled>
            {t("holder.claim")}
          </button>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {holderRows.map((row) => (
            <li key={row.token} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-hi">{row.symbol}</div>
                <div className="text-[11px] text-mid">
                  {t("holder.yourShare")} {formatUnits(row.pending, row.decimals)}
                </div>
              </div>
              <button
                type="button"
                className="btn-neon"
                disabled={holderBusy || row.pending === 0n}
                onClick={() => void claimHolder(row.token)}
              >
                {holderBusy
                  ? t("position.confirming")
                  : row.pending === 0n
                    ? t("holder.claim")
                    : t("position.holderClaim", {
                        amount: formatUnits(row.pending, row.decimals),
                        symbol: row.symbol,
                      })}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!mock && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void trackPayout();
          }}
        >
          <input
            value={payoutDraft}
            onChange={(e) => setPayoutDraft(e.target.value)}
            placeholder={t("position.holderPlaceholder")}
            className="input-term flex-1 min-w-0"
          />
          <button type="submit" disabled={holderBusy} className="h-10 px-3 rounded-xl text-xs font-semibold border border-black/15">
            {t("position.holderTrack")}
          </button>
        </form>
      )}
      {holderMsg ? <p className="text-[11px] text-mid mt-2">{holderMsg}</p> : null}
    </section>
  </div>
  );
}
