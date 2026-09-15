"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { Sidebar } from "@/components/Sidebar";
import { WalletButton } from "@/components/WalletButton";
import { listWalletPositions, type WalletPoolPosition } from "@/lib/poolClient";
import { getAllPoolMeta, type PoolMeta } from "@/lib/poolMeta";

/**
 * /stake — the connected wallet's staking positions across every pool on the
 * factory, in a list view. Active (staked > 0) and inactive (previously staked,
 * now 0) are both shown, grouped.
 */
export default function StakePage() {
  const { address, isConnected } = useAccount();
  const [rows, setRows] = useState<WalletPoolPosition[] | null>(null);
  const [meta, setMeta] = useState<Record<string, PoolMeta>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const [positions, metaMap] = await Promise.all([
        listWalletPositions(address),
        getAllPoolMeta().catch(() => ({})),
      ]);
      setRows(positions);
      setMeta(metaMap);
    } catch {
      setRows([]);
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

  const active = (rows ?? []).filter((r) => r.active);
  const inactive = (rows ?? []).filter((r) => !r.active);

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
                    My Stakes
                  </h1>
                  <p className="text-mid mt-2 leading-relaxed">
                    Every pool your connected wallet has staked in — active and inactive.
                  </p>
                </div>
                {isConnected && (
                  <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading}
                    className="h-9 px-4 rounded-xl text-xs font-semibold text-lo hover:text-hi
                               border border-black/10 disabled:opacity-50"
                  >
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                )}
              </div>
            </header>

            {!isConnected ? (
              <ConnectPrompt />
            ) : loading && !rows ? (
              <div className="glass !rounded-2xl p-8 text-center text-lo text-sm animate-pulse">
                Loading your positions…
              </div>
            ) : rows && rows.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <Section title={`Active (${active.length})`} rows={active} meta={meta} empty="No active stakes." />
                <Section title={`Inactive (${inactive.length})`} rows={inactive} meta={meta} empty="No inactive stakes." />
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Section({
  title,
  rows,
  meta,
  empty,
}: {
  title: string;
  rows: WalletPoolPosition[];
  meta: Record<string, PoolMeta>;
  empty: string;
}) {
  return (
    <section className="glass !rounded-2xl p-4 sm:p-5 animate-rise">
      <h2 className="text-sm font-semibold text-hi tracking-tight mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="label-term !normal-case !tracking-normal text-lo">{empty}</p>
      ) : (
        <ul className="divide-y divide-black/[0.06]">
          {rows.map((r) => {
            const m = meta[r.summary.token.toLowerCase()];
            const unit = r.summary.decimals || 18;
            const staked = Number(formatUnits(r.staked, unit));
            const pending = Number(formatUnits(r.pending, unit));
            const title =
              m?.nickname?.trim() ||
              (r.summary.symbol ? `${r.summary.symbol} Pool` : "Staking Pool");
            return (
              <li key={r.summary.pool} className="py-3">
                <Link
                  href={`/pool/${r.summary.pool}`}
                  className="flex items-center gap-3 hover:opacity-90 transition-opacity"
                >
                  {m?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt="" className="h-10 w-10 rounded-xl object-cover border border-black/10 shrink-0" />
                  ) : (
                    <span className="h-10 w-10 rounded-xl shrink-0 grid place-items-center text-xs font-bold text-white/90 border border-black/10"
                      style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}>
                      {(r.summary.symbol || "?").slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-hi truncate">{title}</div>
                    <div className="label-term !text-[9px] !normal-case !tracking-normal text-lo">
                      {r.summary.symbol ? `$${r.summary.symbol}` : shorten(r.summary.token)} · {r.summary.durationDays}d
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="mono text-sm font-bold text-hi">{formatCompact(staked)}</div>
                    <div className="label-term !text-[8px] !normal-case !tracking-normal text-lo">staked</div>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <div className="mono text-sm font-bold text-pos">{formatCompact(pending)}</div>
                    <div className="label-term !text-[8px] !normal-case !tracking-normal text-lo">pending</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    r.active ? "bg-green-500/15 text-green-300" : "bg-black/[0.06] text-lo"
                  }`}>
                    {r.active ? "Active" : "Inactive"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ConnectPrompt() {
  return (
    <section className="glass glass-gold p-10 text-center animate-rise">
      <h2 className="text-lg font-semibold text-hi tracking-tight">Connect your wallet</h2>
      <p className="text-mid text-sm mt-1.5 max-w-sm mx-auto leading-relaxed">
        Connect an EVM wallet to see every pool you&apos;ve staked in.
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
      <h2 className="text-lg font-semibold text-hi tracking-tight">No stakes yet</h2>
      <p className="text-mid text-sm mt-1.5">
        Once you stake in a pool, it will appear here.
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
