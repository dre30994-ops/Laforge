"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import {
  listPools,
  poolStatus,
  FACTORY_ADDRESS,
  type PoolSummary,
} from "@/lib/factoryClient";
import { getAllPoolMeta, sanitizeSocialUrl, sanitizeImageRef, type PoolMeta } from "@/lib/poolMeta";
import { onPoolsChanged } from "@/lib/poolEvents";
import { robinhoodExplorerUrl } from "@/lib/chains";
import { PREVIEW_CARDS as PREVIEW_POOLS } from "@/lib/previewPools";
import { usePoolSearch } from "@/components/PoolSearchContext";

type CardData = PoolSummary & { meta: PoolMeta | null; trending: boolean };

/**
 * PREVIEW ONLY — mock tier cards, sourced from the shared preview registry
 * (lib/previewPools) so the cards, the trending carousel, and the per-pool
 * detail page all agree. Toggle with NEXT_PUBLIC_PREVIEW_TIER_CARDS="0".
 */
const PREVIEW_CARDS: CardData[] = PREVIEW_POOLS.map((p) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const trending =
    typeof p.meta.marketing?.trendingUntil === "number" &&
    p.meta.marketing.trendingUntil > nowSec;
  return { ...p.summary, meta: p.meta, trending };
});

/**
 * A responsive grid of cards, one per pool deployed through the StakingFactory.
 * Each card merges on-chain pool data with the off-chain, display-only nickname
 * and image captured at creation time (see lib/poolMeta.ts), keyed by token
 * address.
 */
export function PoolDirectory() {
  const [pools, setPools] = useState<CardData[] | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  // Prefer the shared search context (driven by the top-bar search box beside
  // "Create"); fall back to local state so the directory still works stand-alone.
  const shared = usePoolSearch();
  const [localQuery, setLocalQuery] = useState("");
  const query = shared ? shared.query : localQuery;
  const setQuery = shared ? shared.setQuery : setLocalQuery;

  // Core fetch. All state updates happen after an `await` boundary so this can
  // be invoked from the mount effect without a synchronous setState (see
  // react-hooks/set-state-in-effect).
  const fetchPools = useCallback(async () => {
    try {
      const [summaries, metaMap] = await Promise.all([
        listPools(),
        getAllPoolMeta(),
      ]);
      const nowSec = Math.floor(Date.now() / 1000);
      const withMeta: CardData[] = summaries.map((p) => {
        // Metadata is keyed by lowercased token address in the backend/cache.
        const meta = metaMap[p.token.toLowerCase()] ?? null;
        const trending =
          typeof meta?.marketing?.trendingUntil === "number" &&
          meta.marketing.trendingUntil > nowSec;
        return { ...p, meta, trending };
      });
      setError("");
      setPools(withMeta);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load pools.");
      setPools([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Manual refresh (event handler): safe to set loading synchronously.
  const refresh = useCallback(() => {
    setLoading(true);
    void fetchPools();
  }, [fetchPools]);

  useEffect(() => {
    // Defer the initial load so no setState runs synchronously inside the
    // effect body (avoids cascading renders — matches the usePosition pattern).
    let cancelled = false;
    const initial = setTimeout(() => {
      if (!cancelled) void fetchPools();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [fetchPools]);

  // Auto-append: when a pool is created (and mined) elsewhere on the page,
  // refetch so the new card shows up without a manual refresh or reload.
  useEffect(() => {
    return onPoolsChanged(() => {
      setLoading(true);
      void fetchPools();
    });
  }, [fetchPools]);

  // Publish an address→pool map (pool + token addresses, lowercased) to the
  // shared search context so the top-bar search can navigate to /pool/<pool>
  // whether the user pastes the pool OR the token address. Deferred to avoid a
  // synchronous setState in render.
  const setAddressToPool = shared?.setAddressToPool;
  useEffect(() => {
    if (!setAddressToPool || !pools) return;
    const t = setTimeout(() => {
      const map: Record<string, string> = {};
      for (const p of pools) {
        map[p.pool.toLowerCase()] = p.pool;
        map[p.token.toLowerCase()] = p.pool;
      }
      setAddressToPool(map);
    }, 0);
    return () => clearTimeout(t);
  }, [pools, setAddressToPool]);

  const factoryConfigured = !!FACTORY_ADDRESS;

  // Client-side search: match against the pool contract address, the token
  // contract address, the token symbol, or the nickname (all case-insensitive).
  // Contract addresses come from the on-chain factory (listPools) — no backend
  // storage is needed for address search.
  const q = query.trim().toLowerCase();
  const applyFilter = (list: CardData[]): CardData[] =>
    q ? list.filter((p) => matchesQuery(p, q)) : list;
  const filteredPools = pools ? applyFilter(pools) : pools;
  const filteredPreview = applyFilter(PREVIEW_CARDS);
  const hasQuery = q.length > 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-hi">Pools</h2>
          <p className="label-term mt-0.5">
            Every staking pool launched on the factory
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!shared && (
          <div className="relative">
            <svg
              viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
              className="absolute left-3 top-1/2 -translate-y-1/2 text-lo pointer-events-none"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by contract address, symbol…"
              aria-label="Search pools by contract address or symbol"
              spellCheck={false}
              className="h-9 w-64 max-w-[70vw] pl-8 pr-3 rounded-xl text-xs text-hi
                         bg-black/[0.03] border border-black/10 outline-none
                         focus:border-gold-neon/60 transition-colors placeholder:text-lo"
            />
          </div>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="h-9 px-4 rounded-xl text-xs font-semibold text-lo hover:text-hi
                       border border-black/10 disabled:opacity-50 transition-colors"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {!factoryConfigured ? (
        PREVIEW_CARDS.length > 0 ? (
          filteredPreview.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredPreview.map((p) => (
                <PoolCard key={p.pool} data={p} />
              ))}
            </div>
          ) : (
            <EmptyCard text={`No pools match “${query.trim()}”.`} />
          )
        ) : (
          <EmptyCard text="Factory address is not configured (NEXT_PUBLIC_STAKING_FACTORY)." />
        )
      ) : loading && !pools ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <EmptyCard text={error} tone="error" />
      ) : pools && pools.length === 0 && PREVIEW_CARDS.length === 0 ? (
        <EmptyCard text="No pools launched yet. Be the first — hit “Create”." />
      ) : (
        (() => {
          const cards = [...(filteredPools ?? []), ...filteredPreview];
          if (hasQuery && cards.length === 0) {
            return <EmptyCard text={`No pools match “${query.trim()}”.`} />;
          }
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {cards.map((p) => (
                <PoolCard key={p.pool} data={p} />
              ))}
            </div>
          );
        })()
      )}
    </section>
  );
}

function PoolCard({ data }: { data: CardData }) {
  const status = poolStatus(data);
  const title =
    data.meta?.nickname?.trim() ||
    (data.symbol ? `${data.symbol} Pool` : "Staking Pool");
  const staked = Number(formatUnits(data.stakeVaultBalance, data.decimals || 18));
  const explorer = `${robinhoodExplorerUrl}/address/${data.pool}`;

  const meta = data.meta;
  const tierLabel = tierName(meta?.tier);
  const verified = !!meta?.marketing?.verifiedBadge;
  const trending = data.trending;

  return (
    <div className="relative glass !rounded-2xl p-5 flex flex-col gap-4
                    transition-transform hover:-translate-y-0.5 hover:shadow-lg">
      {/* Full-card click target → per-pool detail page. Interactive children
          (socials, Explorer) sit above this overlay via `relative z-[1]`. */}
      <Link
        href={`/pool/${data.pool}`}
        aria-label={`Open ${title}`}
        className="absolute inset-0 z-0 rounded-2xl"
      />

      {/* Optional banner (Ecosystem/Marketing tiers) */}
      {sanitizeImageRef(meta?.banner) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sanitizeImageRef(meta?.banner)}
          alt=""
          className="-m-5 mb-0 h-24 w-[calc(100%+2.5rem)] object-cover rounded-t-2xl border-b border-black/10 pointer-events-none"
        />
      )}

      <div className="flex items-start gap-3 pointer-events-none">
        <PoolImage image={meta?.image} symbol={data.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-hi truncate">{title}</h3>
            <StatusPill status={status} />
            {verified && <VerifiedBadge />}
            {trending && <TrendingPill />}
          </div>
          <p className="label-term !normal-case !tracking-normal text-lo mt-0.5 truncate">
            {data.symbol ? `$${data.symbol}` : shorten(data.token)}
            {tierLabel && <span className="text-lo"> · {tierLabel}</span>}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 pointer-events-none">
        <Stat k="Total staked" v={formatCompact(staked)} />
        <Stat k="Duration" v={`${data.durationDays}d`} />
        <Stat k="Stake tax" v={`${(data.stakeTaxBps / 100).toFixed(2)}%`} />
        <Stat k="Unstake tax" v={`${(data.unstakeTaxBps / 100).toFixed(2)}%`} />
      </dl>

      {/* Social links (Ecosystem + Marketing tiers) — above the overlay. */}
      <div className="relative z-[1] w-fit">
        <PoolSocials socials={meta?.socials} />
      </div>

      <div className="relative z-[1] flex items-center justify-between pt-1 border-t border-black/[0.06]">
        <span className="label-term !text-[9px] !normal-case text-lo truncate pointer-events-none">
          {shorten(data.pool)}
        </span>
        <a
          href={explorer}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gold-neon hover:underline shrink-0"
        >
          Explorer ↗
        </a>
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
        className="h-12 w-12 rounded-xl object-cover border border-black/10 shrink-0"
      />
    );
  }
  const initial = (symbol || "?").slice(0, 2).toUpperCase();
  return (
    <div
      className="h-12 w-12 rounded-xl shrink-0 grid place-items-center text-sm font-bold text-white/90 border border-black/10"
      style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}
    >
      {initial}
    </div>
  );
}

/** Social links row (Ecosystem + Marketing tiers). Renders nothing when empty. */
function PoolSocials({ socials }: { socials?: PoolMeta["socials"] }) {
  if (!socials) return null;
  const links: { key: string; href: string; label: string; icon: React.ReactNode }[] = [];
  // Defense-in-depth: sanitize each URL at render time too (https + host
  // allowlist). Even a value from stale cache or a compromised backend can't
  // produce a javascript:/data: href here — unsafe values are simply dropped.
  const website = sanitizeSocialUrl(socials.website, "website");
  const twitter = sanitizeSocialUrl(socials.twitter, "twitter");
  const telegram = sanitizeSocialUrl(socials.telegram, "telegram");
  const discord = sanitizeSocialUrl(socials.discord, "discord");

  if (website) {
    links.push({
      key: "website",
      href: website,
      label: "Website",
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
        </svg>
      ),
    });
  }
  if (twitter) {
    links.push({
      key: "twitter",
      href: twitter,
      label: "X / Twitter",
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
    });
  }
  if (telegram) {
    links.push({
      key: "telegram",
      href: telegram,
      label: "Telegram",
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
        </svg>
      ),
    });
  }
  if (discord) {
    links.push({
      key: "discord",
      href: discord,
      label: "Discord",
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.211.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.6 12.6 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127a12.3 12.3 0 0 1-1.873.891a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.84 19.84 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.057c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      ),
    });
  }

  if (links.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {links.map((l) => (
        <a
          key={l.key}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={l.label}
          aria-label={l.label}
          className="grid h-8 w-8 place-items-center rounded-lg border border-black/10
                     text-lo hover:text-hi hover:border-black/20 transition-colors"
        >
          {l.icon}
        </a>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: "live" | "paused" | "pending" }) {
  const map = {
    live: { label: "Live", cls: "bg-green-500/15 text-green-300" },
    paused: { label: "Paused", cls: "bg-amber-500/15 text-amber-300" },
    pending: { label: "Pending", cls: "bg-black/[0.06] text-lo" },
  } as const;
  const { label, cls } = map[status];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

/** Human tier label from the stored tier index (0=Bronze,1=Ecosystem,2=Marketing). */
function tierName(tier?: number): string {
  if (tier === 0) return "Bronze";
  if (tier === 1) return "Ecosystem";
  if (tier === 2) return "Marketing";
  return "";
}

/** "Verified safe" lock badge (Marketing tier). */
function VerifiedBadge() {
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}
      title="Verified safe"
    >
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      Verified
    </span>
  );
}

/** Front-page trending pill (Marketing tier, time-limited). */
function TrendingPill() {
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: "rgba(255,157,46,0.14)", color: "var(--amber-neon, #ff9d2e)", border: "1px solid rgba(255,157,46,0.3)" }}
      title="Trending"
    >
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M21 7v5h-5" />
      </svg>
      Trending
    </span>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-2.5">
      <div className="mono text-sm font-bold text-gold-neon leading-tight">{v}</div>
      <div className="label-term !text-[9px] !tracking-normal !normal-case mt-0.5">{k}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="glass !rounded-2xl p-5 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-black/[0.06]" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-2/3 rounded bg-black/[0.06]" />
          <div className="h-2.5 w-1/3 rounded bg-black/[0.06]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-black/[0.04]" />
        ))}
      </div>
    </div>
  );
}

function EmptyCard({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <div
      className={`glass !rounded-2xl p-6 text-center text-sm ${
        tone === "error" ? "text-red-300" : "text-lo"
      }`}
    >
      {text}
    </div>
  );
}

function shorten(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * True if the card matches the search query. Matches the pool contract address,
 * the token contract address, the token symbol, or the nickname — all
 * case-insensitive substring (so a partial address works). `q` is expected to
 * be trimmed + lowercased already.
 */
function matchesQuery(p: CardData, q: string): boolean {
  const hay = [p.pool, p.token, p.symbol, p.meta?.nickname ?? ""]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
