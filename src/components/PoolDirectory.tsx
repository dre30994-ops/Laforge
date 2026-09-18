import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { formatUnits } from "viem";
import {
  displayTier,
  listPools,
  poolStatus,
  type PoolSummary,
} from "@/lib/factoryClient";
import { getAllPoolMeta, metaForPool, type PoolMeta } from "@/lib/poolMeta";
import { onPoolsChanged } from "@/lib/poolEvents";
import { EVM_NETWORKS, explorerAddressUrl, isVisibleNetwork, type EvmNetworkKey } from "@/lib/evmNetworks";
import { ChainGlyph } from "@/components/ChainSwitch";
import { sanitizeHttpUrl, sanitizeImageSrc, sanitizeSocials } from "@/lib/sanitize";
import { CreatePoolButton } from "@/components/CreatePoolButton";

export type CardData = PoolSummary & { meta: PoolMeta | null; trending: boolean };

function withMeta(summaries: PoolSummary[], metaMap: Record<string, PoolMeta>): CardData[] {
  const nowSec = Math.floor(Date.now() / 1000);
  return summaries.map((p) => {
    const meta = metaForPool(metaMap, p.token, p.pool);
    const metaTrending =
      typeof meta?.marketing?.trendingUntil === "number" &&
      meta.marketing.trendingUntil > nowSec;
    const deskTrending = (p.trendingUntil ?? 0) > nowSec;
    return { ...p, meta, trending: deskTrending || metaTrending };
  });
}

const DASHBOARD_LIMIT = 20;

/**
 * Grid of pool cards across every launch chain. Dashboard caps at 20 and
 * sends the rest to /pools.
 */
export function PoolDirectory({
  limit = DASHBOARD_LIMIT,
  showAllLink = true,
}: {
  limit?: number | null;
  showAllLink?: boolean;
}) {
  const [pools, setPools] = useState<CardData[] | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchPools = useCallback(async () => {
    try {
      const [summaries, metaMap] = await Promise.all([
        listPools(),
        getAllPoolMeta(),
      ]);
      setError("");
      setPools(withMeta(summaries.filter((p) => !p.demo), metaMap));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load pools.");
      setPools([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    void fetchPools();
  }, [fetchPools]);

  useEffect(() => {
    let cancelled = false;
    const initial = setTimeout(() => {
      if (cancelled) return;
      void fetchPools();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [fetchPools]);

  useEffect(() => {
    return onPoolsChanged(() => {
      setLoading(true);
      void fetchPools();
    });
  }, [fetchPools]);

  const visible =
    limit != null && pools ? pools.slice(0, limit) : pools;
  const overflow =
    limit != null && pools && pools.length > limit ? pools.length - limit : 0;

  return (
    <section className="space-y-3" data-testid="pool-directory">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-hi">Pools</h2>
          <p className="label-term mt-0.5">
            Live on Robinhood and Ethereum
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showAllLink && (
            <Link
              to="/pools"
              className="h-9 px-4 rounded-xl text-xs font-semibold text-hi
                         border border-black/10 hover:bg-black/[0.04] grid place-items-center"
            >
              {overflow > 0 ? `View all ${pools?.length} →` : "All pools →"}
            </Link>
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

      {loading && !pools ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <EmptyCard text={error} tone="error" />
      ) : pools && pools.length === 0 ? (
        <EmptyLiveState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible?.map((p) => (
            <PoolCard key={`${p.chainId}:${p.pool}`} data={p} />
          ))}
        </div>
      )}
      {pools && pools.length > 0 && (
        <p className="text-center pt-1">
          <Link
            to="/preview"
            className="text-xs font-semibold text-gold-neon hover:underline"
            data-testid="sample-dashboards-link"
          >
            Preview sample dashboards
          </Link>
        </p>
      )}
    </section>
  );
}

export function PoolCard({ data }: { data: CardData }) {
  const status = poolStatus(data);
  const network = EVM_NETWORKS[data.chainKey] ?? EVM_NETWORKS.robinhood;
  const title =
    data.meta?.nickname?.trim() ||
    (data.symbol ? `${data.symbol} Pool` : "Staking Pool");
  const staked = Number(formatUnits(data.stakeVaultBalance, data.decimals || 18));
  const explorer = explorerAddressUrl(network, data.pool);

  const meta = data.meta;
  const banner = sanitizeImageSrc(meta?.banner);
  const image = sanitizeImageSrc(meta?.image);
  const shownTier = displayTier(data, meta);
  const tierLabel = tierName(shownTier);
  const verified = !!meta?.marketing?.verifiedBadge || data.tierOnChain === 2;
  const trending = data.trending;

  return (
    <Link
      to="/pool/$chainId/$address"
      params={{ chainId: String(data.chainId), address: data.pool }}
      className="glass !rounded-2xl p-5 flex flex-col gap-4 text-left hover:border-black/20 transition-colors"
      data-testid="pool-card"
    >
      {shownTier >= 1 && banner && (
        <img
          src={banner}
          alt=""
          className="-m-5 mb-0 h-24 w-[calc(100%+2.5rem)] object-cover rounded-t-2xl border-b border-black/10"
        />
      )}

      <div className="flex items-start gap-3">
        <PoolImage image={image} symbol={data.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-hi truncate">{title}</h3>
            <StatusPill status={status} />
            {verified && <VerifiedBadge />}
            {trending && <TrendingPill />}
            {data.demo && <DemoPill />}
          </div>
          <p className="label-term !normal-case !tracking-normal text-lo mt-0.5 truncate">
            {data.symbol ? `$${data.symbol}` : shorten(data.token)}
            {tierLabel && <span className="text-lo"> · {tierLabel}</span>}
          </p>
        </div>
      </div>

      {isVisibleNetwork(data.chainKey) && <ChainBadge chainKey={data.chainKey} />}

      <dl className="grid grid-cols-3 gap-3">
        <Stat k="Total staked" v={formatCompact(staked)} />
        <Stat k="Duration" v={`${data.durationDays}d`} />
        <Stat k="Stake tax" v={`${(data.stakeTaxBps / 100).toFixed(2)}%`} />
      </dl>

      <SocialLinks socials={sanitizeSocials(meta?.socials)} tier={shownTier} />

      <div className="flex items-center justify-between pt-1 border-t border-black/[0.06]">
        <span className="label-term !text-[9px] !normal-case text-lo truncate">
          {shorten(data.pool)}
        </span>
        {data.demo ? (
          <span className="text-[10px] font-semibold text-lo">Sample</span>
        ) : (
          <span
            className="text-xs text-gold-neon shrink-0"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(explorer, "_blank", "noopener,noreferrer");
            }}
          >
            Explorer ↗
          </span>
        )}
      </div>
    </Link>
  );
}

export function ChainBadge({ chainKey }: { chainKey: EvmNetworkKey }) {
  if (!isVisibleNetwork(chainKey)) return null;
  const n = EVM_NETWORKS[chainKey];
  return (
    <span
      className="inline-flex items-center gap-1.5 self-start h-6 px-2 rounded-full
                 text-[10px] font-semibold text-hi border border-black/10 bg-black/[0.03]"
      data-testid="pool-chain-badge"
      title={n?.label}
    >
      <ChainGlyph name={chainKey} />
      {n?.short ?? chainKey}
    </span>
  );
}

function PoolImage({ image, symbol }: { image?: string; symbol: string }) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        data-testid="pool-card-image"
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

function SocialLinks({
  socials,
  tier,
}: {
  socials?: PoolMeta["socials"];
  tier?: number;
}) {
  const branded = tier === 1 || tier === 2;
  if (!branded || !socials) return null;

  const items = [
    { href: sanitizeHttpUrl(socials.website), label: "Website", kind: "website" },
    { href: sanitizeHttpUrl(socials.twitter), label: "X", kind: "twitter" },
    { href: sanitizeHttpUrl(socials.telegram), label: "Telegram", kind: "telegram" },
    { href: sanitizeHttpUrl(socials.discord), label: "Discord", kind: "discord" },
  ].filter((i) => typeof i.href === "string" && i.href.length > 0);

  if (items.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 flex-wrap"
      data-testid="pool-socials"
      aria-label="Pool socials"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <a
          key={item.kind}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`pool-social-${item.kind}`}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-semibold
                     text-hi border border-black/10 bg-black/[0.03] hover:bg-black/[0.06] hover:border-black/20
                     transition-colors"
        >
          <SocialIcon kind={item.kind} />
          {item.label}
        </a>
      ))}
    </div>
  );
}

function SocialIcon({ kind }: { kind: string }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 12,
    height: 12,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "twitter") {
    return (
      <svg {...common}>
        <path d="M4 4l11.5 16h4.5L8.5 4H4z" />
        <path d="M4 20l7.5-8.5" />
        <path d="M12.5 12.5L20 4" />
      </svg>
    );
  }
  if (kind === "telegram") {
    return (
      <svg {...common}>
        <path d="M22 3L2 10.5l6.5 2L20 6 11 14.5 20.5 21 22 3z" />
      </svg>
    );
  }
  if (kind === "discord") {
    return (
      <svg {...common}>
        <path d="M7 7.5C8.2 6.6 9.6 6 11 6h2c1.4 0 2.8.6 4 1.5" />
        <path d="M17 16.5c-1.2.9-2.6 1.5-4 1.5h-2c-1.4 0-2.8-.6-4-1.5" />
        <circle cx="9" cy="12" r="1" fill="currentColor" />
        <circle cx="15" cy="12" r="1" fill="currentColor" />
        <path d="M8 18l-1.5 3" />
        <path d="M16 18l1.5 3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 010 18" />
      <path d="M12 3a14 14 0 000 18" />
    </svg>
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

function tierName(tier?: number): string {
  if (tier === 0) return "Bronze";
  if (tier === 1) return "Ecosystem";
  if (tier === 2) return "Marketing";
  return "";
}

function VerifiedBadge() {
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}
      title="Verified safe"
    >
      Verified
    </span>
  );
}

function TrendingPill() {
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: "rgba(255,157,46,0.14)", color: "var(--amber-neon, #ff9d2e)", border: "1px solid rgba(255,157,46,0.3)" }}
      title="Trending"
    >
      Trending
    </span>
  );
}

function DemoPill() {
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border border-black/10 text-lo bg-black/[0.03]"
      title="Demo pool for previewing dashboards"
    >
      Demo
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

function EmptyLiveState() {
  return (
    <div className="glass !rounded-2xl p-8 text-center space-y-4" data-testid="empty-live-pools">
      <div>
        <h3 className="text-base font-semibold text-hi">No live pools yet</h3>
        <p className="text-sm text-mid mt-2 leading-relaxed max-w-md mx-auto">
          Be the first to launch on Robinhood or Ethereum. Until then you can walk through
          sample dashboards — they are labeled and not a stake.
        </p>
      </div>
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <CreatePoolButton />
        <Link
          to="/preview"
          className="inline-flex h-10 px-4 rounded-xl text-xs font-semibold text-hi
                     border border-black/10 hover:bg-black/[0.04] items-center"
          data-testid="sample-dashboards-cta"
        >
          Preview a pool dashboard
        </Link>
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

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

