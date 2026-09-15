"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { Sidebar } from "@/components/Sidebar";
import { WalletButton } from "@/components/WalletButton";
import { fetchWalletHistory, type WalletHistoryEvent } from "@/lib/poolClient";
import { robinhoodExplorerUrl } from "@/lib/chains";

/** Visual config per action type. */
const ACTION_META: Record<
  WalletHistoryEvent["action"],
  { label: string; color: string; sign: "+" | "-"; blurb: string }
> = {
  stake: { label: "Stake", color: "var(--pos)", sign: "+", blurb: "Added to principal" },
  unstake: { label: "Unstake", color: "var(--amber)", sign: "-", blurb: "Withdrew principal · tenure reset" },
  claim: { label: "Claim", color: "var(--neon-gold)", sign: "+", blurb: "Rewards withdrawn" },
};

/**
 * /history — every stake / unstake / claim for the connected EVM wallet, read
 * from pool event logs across all pools on the factory. Newest first.
 */
export default function HistoryPage() {
  const { address, isConnected } = useAccount();
  const [events, setEvents] = useState<WalletHistoryEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) {
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      setEvents(await fetchWalletHistory(address));
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [load]);

  return (
    <div className="terminal-root terminal-grid">
      <div className="relative z-[1] flex min-h-screen">
        <div className="hidden lg:block w-[248px] shrink-0 p-4 sticky top-0 h-screen">
          <Sidebar />
        </div>

        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[1000px] mx-auto space-y-6">
            <header className="animate-rise">
              <Link href="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                ← Back to dashboard
              </Link>
              <div className="flex items-end justify-between flex-wrap gap-3 mt-3">
                <div>
                  <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi">
                    Activity History
                  </h1>
                  <p className="text-mid mt-2 leading-relaxed">
                    Every stake, unstake, and claim for the connected wallet, across all pools.
                  </p>
                </div>
                {isConnected && (
                  <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading}
                    className="h-9 px-4 rounded-xl text-xs font-semibold text-lo hover:text-hi border border-black/10 disabled:opacity-50"
                  >
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                )}
              </div>
            </header>

            {!isConnected ? (
              <ConnectPrompt />
            ) : loading && !events ? (
              <div className="glass !rounded-2xl p-8 text-center text-lo text-sm animate-pulse">
                Scanning your on-chain activity…
              </div>
            ) : events && events.length === 0 ? (
              <EmptyState />
            ) : (
              <ActivityLog events={events ?? []} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function ActivityLog({ events }: { events: WalletHistoryEvent[] }) {
  return (
    <section className="glass p-4 sm:p-5 animate-rise">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-sm font-semibold text-hi tracking-tight">Timeline</h2>
        <span className="label-term">{events.length} events</span>
      </div>

      <div className="hidden sm:grid grid-cols-[1.2fr_1fr_1fr_0.8fr] gap-3 px-3 pb-2 border-b border-black/[0.06]">
        <span className="label-term !text-[9px]">Action</span>
        <span className="label-term !text-[9px] text-right">Amount</span>
        <span className="label-term !text-[9px] text-right">Pool</span>
        <span className="label-term !text-[9px] text-right">Tx</span>
      </div>

      <ul className="divide-y divide-black/[0.06]">
        {events.map((e, i) => {
          const meta = ACTION_META[e.action];
          const amount = Number(formatUnits(e.amount, e.decimals || 18));
          return (
            <li
              key={`${e.txHash}-${i}`}
              className="grid grid-cols-2 sm:grid-cols-[1.2fr_1fr_1fr_0.8fr] gap-2 sm:gap-3 items-center px-3 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="grid place-items-center w-8 h-8 rounded-lg shrink-0 text-xs font-bold"
                  style={{ color: meta.color, background: "rgba(20,18,10,0.03)", border: "1px solid var(--hairline)" }}
                >
                  {meta.sign}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-hi">{meta.label}</div>
                  <div className="label-term !text-[8px] !tracking-normal !normal-case truncate">
                    {meta.blurb}
                  </div>
                </div>
              </div>

              <div className="text-right mono text-sm font-semibold" style={{ color: meta.color }}>
                {meta.sign}
                {formatCompact(amount)}
              </div>

              <div className="text-right mono text-xs text-mid">
                <Link href={`/pool/${e.pool}`} className="hover:text-gold-neon">
                  {e.symbol ? `$${e.symbol}` : shorten(e.pool)}
                </Link>
              </div>

              <div className="text-right col-span-2 sm:col-span-1">
                <a
                  href={`${robinhoodExplorerUrl}/tx/${e.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono text-xs text-gold-neon hover:underline"
                >
                  {e.txHash.slice(0, 6)}…{e.txHash.slice(-4)} ↗
                </a>
                <div className="label-term !text-[8px] !tracking-normal !normal-case text-lo">
                  block {e.blockNumber.toString()}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ConnectPrompt() {
  return (
    <section className="glass glass-gold p-10 text-center animate-rise">
      <h2 className="text-lg font-semibold text-hi tracking-tight">Connect your wallet</h2>
      <p className="text-mid text-sm mt-1.5 max-w-sm mx-auto leading-relaxed">
        Connect an EVM wallet to view your staking, unstake, and claim history.
      </p>
      <div className="mt-5 flex justify-center">
        <WalletButton
          className="h-10 px-4 rounded-xl text-xs font-semibold text-[#0a0c0f] border-none disabled:opacity-50"
          style={{
            background: "linear-gradient(180deg, var(--neon-gold), var(--amber))",
            fontFamily: "var(--font-mono, monospace)",
          }}
        />
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="glass p-10 text-center animate-rise">
      <h2 className="text-lg font-semibold text-hi tracking-tight">No activity yet</h2>
      <p className="text-mid text-sm mt-1.5">
        Once you stake, unstake, or claim, your actions will appear here.
      </p>
      <Link href="/dashboard" className="inline-block mt-5">
        <span className="btn-neon !inline-block !w-auto !px-6">Browse pools</span>
      </Link>
    </section>
  );
}

function shorten(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
