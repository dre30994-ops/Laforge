"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { PoolPositionConsole } from "@/components/PoolPositionConsole";
import { PoolApyCalculator } from "@/components/PoolApyCalculator";
import { getPoolDetail, type PoolDetail } from "@/lib/poolDetail";
import { sanitizeImageRef } from "@/lib/poolMeta";
import { robinhoodExplorerUrl } from "@/lib/chains";
import { isPreviewAddress } from "@/lib/previewPools";
import { MarketingAddonButton } from "@/components/MarketingAddonButton";

/**
 * Per-pool detail page: /pool/[address]
 *
 * Tier-gated content:
 *   - Bronze (tier 0):  pool image + Position dashboard + Stake/Unstake/Claim.
 *   - Ecosystem (1) &
 *     Marketing (2):    everything Bronze has, PLUS an APY calculator that
 *                       computes from THIS pool's parameters and reward growth.
 *
 * Data is loaded by pool contract address via getPoolDetail (on-chain summary +
 * off-chain metadata; synthetic preview/mock pools resolve locally).
 */
export default function PoolDetailPage() {
  const params = useParams();
  const address =
    typeof params?.address === "string"
      ? params.address
      : Array.isArray(params?.address)
      ? params.address[0]
      : "";

  const [detail, setDetail] = useState<PoolDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Defer so no setState runs synchronously in the effect body (avoids the
    // react-hooks/set-state-in-effect cascade warning — matches PoolDirectory).
    const t = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError("");
      getPoolDetail(address)
        .then((d) => {
          if (!cancelled) setDetail(d);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this pool.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [address]);

  const summary = detail?.summary;
  const meta = detail?.meta ?? null;
  const tier = meta?.tier ?? 0;
  const showCalculator = tier === 1 || tier === 2; // Ecosystem + Marketing
  const tierLabel = tier === 2 ? "Marketing" : tier === 1 ? "Ecosystem" : "Bronze";
  const title =
    meta?.nickname?.trim() ||
    (summary?.symbol ? `${summary.symbol} Pool` : "Staking Pool");
  const isPreview = isPreviewAddress(address);
  const explorer = summary ? `${robinhoodExplorerUrl}/address/${summary.pool}` : "#";

  return (
    <div className="terminal-root terminal-grid">
      <div className="relative z-[1] flex min-h-screen">
        <div className="hidden lg:block w-[248px] shrink-0 p-4 sticky top-0 h-screen">
          <Sidebar />
        </div>

        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[1200px] mx-auto space-y-6">
            <Link
              href="/dashboard"
              className="label-term inline-flex items-center gap-1 hover:text-hi transition-colors"
            >
              ← Back to pools
            </Link>

            {loading ? (
              <div className="glass !rounded-2xl p-8 text-center text-lo text-sm animate-pulse">
                Loading pool…
              </div>
            ) : error || !summary ? (
              <div className="glass !rounded-2xl p-8 text-center text-red-300 text-sm">
                {error || "Pool not found."}
              </div>
            ) : (
              <>
                {/* Header: image + title + tier + status */}
                <section className="glass glass-gold !rounded-2xl overflow-hidden">
                  {sanitizeImageRef(meta?.banner) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sanitizeImageRef(meta?.banner)}
                      alt=""
                      className="h-32 w-full object-cover border-b border-black/10"
                    />
                  )}
                  <div className="p-6 flex items-start gap-4">
                    <PoolImage image={meta?.image} symbol={summary.symbol} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-xl font-semibold text-hi truncate">{title}</h1>
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-black/[0.06] text-lo">
                          {tierLabel}
                        </span>
                        {summary.paused ? (
                          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-300">
                            Paused
                          </span>
                        ) : summary.started ? (
                          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-500/15 text-green-300">
                            Live
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-black/[0.06] text-lo">
                            Pending
                          </span>
                        )}
                      </div>
                      <p className="label-term !normal-case !tracking-normal text-lo mt-1">
                        {summary.symbol ? `$${summary.symbol}` : shorten(summary.token)}
                        {isPreview && <span className="text-lo"> · preview</span>}
                      </p>
                      <a
                        href={explorer}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gold-neon hover:underline mt-2 inline-block"
                      >
                        {shorten(summary.pool)} · Explorer ↗
                      </a>

                      {/* Pool facts: duration + taxes (min stake shown in the
                          Position dashboard where the on-chain value is read). */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Fact k="Duration" v={`${summary.durationDays} day${summary.durationDays === 1 ? "" : "s"}`} />
                        <Fact k="Stake tax" v={`${(summary.stakeTaxBps / 100).toFixed(2)}%`} />
                        <Fact k="Unstake tax" v={`${(summary.unstakeTaxBps / 100).toFixed(2)}%`} />
                      </div>
                    </div>
                  </div>
                  {/* Marketing add-on — its own row (not beside the image). */}
                  <div className="px-6 pb-6 -mt-2 flex justify-end">
                    <MarketingAddonButton poolAddress={summary.pool} tokenAddress={summary.token} />
                  </div>
                </section>

                {/* Position dashboard + Stake/Unstake/Claim (all tiers) */}
                <PoolPositionConsole summary={summary} />

                {/* APY calculator (Ecosystem + Marketing only) */}
                {showCalculator ? (
                  <PoolApyCalculator summary={summary} />
                ) : (
                  <div className="glass !rounded-2xl p-5 text-sm text-lo">
                    <span className="label-term">APY calculator</span>
                    <p className="mt-1 leading-snug">
                      The per-pool APY calculator is available on Ecosystem and
                      Marketing tier pools.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function PoolImage({ image, symbol }: { image?: string; symbol: string }) {
  const safe = sanitizeImageRef(image);
  if (safe) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={safe}
        alt=""
        className="h-16 w-16 rounded-2xl object-cover border border-black/10 shrink-0"
      />
    );
  }
  const initial = (symbol || "?").slice(0, 2).toUpperCase();
  return (
    <div
      className="h-16 w-16 rounded-2xl shrink-0 grid place-items-center text-lg font-bold text-white/90 border border-black/10"
      style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}
    >
      {initial}
    </div>
  );
}

function shorten(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] bg-black/[0.02] px-2.5 py-1">
      <span className="label-term !text-[8px] !tracking-normal !normal-case text-lo">{k}</span>
      <span className="mono text-xs font-bold text-hi">{v}</span>
    </span>
  );
}
