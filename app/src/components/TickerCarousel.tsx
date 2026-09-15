"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAllPoolMeta, type PoolMeta } from "@/lib/poolMeta";
import { listPools } from "@/lib/factoryClient";
import { onPoolsChanged } from "@/lib/poolEvents";
import { isPreviewAddress } from "@/lib/previewPools";

/**
 * A thin, single-line marquee that scrolls RIGHT → LEFT below the staking hero
 * (Create Stake).
 *
 * Content rules (per product spec):
 *  - By default the carousel shows generic highlight items.
 *  - When a Marketing-tier pool is launched it is featured on the carousel
 *    (image + token symbol) for 12 hours, then it — and its image — drop off.
 *    The 12h window is encoded at launch time as `meta.marketing.trendingUntil`
 *    (see CreatePoolButton), so "active" == trendingUntil > now.
 *  - As soon as any Marketing pools are active they REPLACE the default items.
 *    Newly launched Marketing pools append to the active list (newest first)
 *    and each stays until its own 12h window elapses.
 *
 * Motion:
 *  - The track holds the items twice, back-to-back, and animates 0% → -50%.
 *    Because the second copy is identical and starts exactly where the first
 *    ends, the wrap is seamless. 0 → -50% reads as right→left.
 *  - Pauses on hover; respects prefers-reduced-motion.
 */

type FeaturedPool = {
  /** Pool (StakingPool) contract address — links to /pool/[pool]. */
  pool: string;
  token: string;
  /** Display label — the token symbol (e.g. "$ABC"). */
  label: string;
  image?: string;
  /** Unix seconds the feature expires (launch + 12h). */
  until: number;
};

/** Featuring a Marketing pool lasts 12h; re-evaluate expiries this often. */
const SWEEP_INTERVAL_MS = 60_000;

/** Keep the first entry per pool (real pools take precedence over mocks). */
function dedupeByPool(items: FeaturedPool[]): FeaturedPool[] {
  const seen = new Set<string>();
  const out: FeaturedPool[] = [];
  for (const it of items) {
    const key = it.pool.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export function TickerCarousel() {
  const [featured, setFeatured] = useState<FeaturedPool[]>([]);

  // Pull all pool metadata (for the 12h trending window + image) and the
  // on-chain pool summaries (for the token symbol), then keep only Marketing
  // pools still inside their 12h window. Newest (largest `until`) first so
  // fresh launches lead. The label is the token symbol.
  const refresh = useCallback(async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      const [metaMap, summaries] = await Promise.all([
        getAllPoolMeta(),
        listPools().catch(() => []),
      ]);
      // token address (lowercased) -> { pool, symbol }
      const byToken = new Map<string, { pool: string; symbol: string }>();
      for (const s of summaries) {
        byToken.set(s.token.toLowerCase(), { pool: s.pool, symbol: s.symbol });
      }
      const active: FeaturedPool[] = Object.entries(metaMap)
        .map(([token, meta]: [string, PoolMeta]): FeaturedPool | null => {
          const until = meta.marketing?.trendingUntil;
          if (typeof until !== "number" || until <= nowSec) return null;
          const info = byToken.get(token.toLowerCase());
          // Without an on-chain summary we can't link to a pool page, so skip.
          if (!info) return null;
          const label = info.symbol
            ? `$${info.symbol}`
            : meta.nickname?.trim() || `${token.slice(0, 6)}…${token.slice(-4)}`;
          return { pool: info.pool, token, label, image: meta.image, until };
        })
        .filter((x): x is FeaturedPool => x !== null);
      // Only real Marketing-tier pools (or pools that bought the Marketing
      // add-on) are eligible — both set `meta.marketing.trendingUntil`. No mock
      // or generic filler: if none are active, the carousel renders nothing.
      const merged = dedupeByPool(active)
        .filter((p) => p.until > nowSec)
        .sort((a, b) => b.until - a.until);
      setFeatured(merged);
    } catch {
      // Metadata unreachable — keep any real items we already have. Never fall
      // back to mocks or filler.
      const nowSec2 = Math.floor(Date.now() / 1000);
      setFeatured((prev) => {
        const keptReal = prev.filter(
          (p) => p.until > nowSec2 && !isPreviewAddress(p.pool)
        );
        return dedupeByPool(keptReal)
          .filter((p) => p.until > nowSec2)
          .sort((a, b) => b.until - a.until);
      });
    }
  }, []);

  // Initial load (deferred so no synchronous setState in the effect body).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled) void refresh();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [refresh]);

  // Re-fetch when a pool is launched elsewhere on the page.
  useEffect(() => onPoolsChanged(() => void refresh()), [refresh]);

  // Periodic sweep so expired features drop off (and their images with them)
  // without needing a page reload or a new launch.
  useEffect(() => {
    const id = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      setFeatured((prev) => {
        const kept = prev.filter((p) => p.until > nowSec);
        // If something expired we also re-pull in case the backend changed.
        if (kept.length !== prev.length) void refresh();
        return kept;
      });
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Only real Marketing pools are shown; if none are active, hide the carousel.
  const useFeatured = featured.length > 0;

  // Build the row content once; it's rendered twice for the seamless loop.
  // When only a few Marketing pools are active, repeat them enough to keep the
  // strip visually full (otherwise a single item leaves a large gap).
  const row = useMemo(() => {
    const MIN_CELLS = 6;
    const reps = Math.max(1, Math.ceil(MIN_CELLS / Math.max(1, featured.length)));
    const cells: React.ReactNode[] = [];
    for (let r = 0; r < reps; r++) {
      for (const p of featured) {
        cells.push(<FeaturedCell key={`f-${p.pool}-${r}`} pool={p} />);
      }
    }
    return cells;
  }, [featured]);

  // No active Marketing pools → render nothing (no generic/filler bar).
  if (!useFeatured) return null;

  return (
    <div className="ticker glass !rounded-xl overflow-hidden" aria-label="Highlights">
      {/* Fixed label pinned to the left edge of the carousel. */}
      <div className="ticker-label">
        <span className="ticker-label-pill">
          <span aria-hidden className="ticker-flame">🔥</span>
          <span className="ticker-label-text">Trending</span>
        </span>
      </div>

      <div className="ticker-track">
        <div className="flex items-center shrink-0">{row}</div>
        <div className="flex items-center shrink-0" aria-hidden>
          {row}
        </div>
      </div>

      <style>{`
        .ticker {
          position: relative;
          height: 38px;
          display: flex;
          align-items: center;
        }
        .ticker-label {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          z-index: 3;
          display: flex;
          align-items: center;
          padding: 0 22px 0 10px;
          /* Soft fade so the ticker items dissolve into the pill instead of a hard edge. */
          background: linear-gradient(
            to right,
            var(--surface, rgba(20,18,10,0.06)) 60%,
            transparent 100%
          );
          white-space: nowrap;
          pointer-events: none;
        }
        .ticker-label-pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 24px;
          padding: 0 12px;
          border-radius: 999px;
          background: linear-gradient(
            135deg,
            rgba(255, 207, 77, 0.30) 0%,
            rgba(184, 134, 11, 0.18) 100%
          );
          border: 1px solid rgba(255, 207, 77, 0.55);
          box-shadow:
            0 2px 10px rgba(255, 207, 77, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.30);
          backdrop-filter: blur(6px);
        }
        .ticker-label-text {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #5a3d02;
          text-shadow: 0 1px 0 rgba(255, 246, 214, 0.55);
        }
        .ticker-flame {
          font-size: 12px;
          line-height: 1;
          filter: drop-shadow(0 0 4px rgba(255, 207, 77, 0.7));
          animation: ticker-flame-pulse 2.4s ease-in-out infinite;
        }
        @keyframes ticker-flame-pulse {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.12); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-flame { animation: none; }
        }
        .ticker::before,
        .ticker::after {
          content: "";
          position: absolute;
          top: 0;
          bottom: 0;
          width: 48px;
          z-index: 1;
          pointer-events: none;
        }
        .ticker::before {
          left: 0;
          background: linear-gradient(to right, var(--surface, rgba(20,18,10,0.06)), transparent);
        }
        .ticker::after {
          right: 0;
          background: linear-gradient(to left, var(--surface, rgba(20,18,10,0.06)), transparent);
        }
        .ticker-track {
          display: flex;
          width: max-content;
          animation: ticker-scroll 32s linear infinite;
          will-change: transform;
        }
        .ticker:hover .ticker-track {
          animation-play-state: paused;
        }
        /* 0 -> -50% moves the track leftward: content scrolls right→left. */
        @keyframes ticker-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-track { animation: none; }
        }
      `}</style>
    </div>
  );
}

function FeaturedCell({ pool }: { pool: FeaturedPool }) {
  return (
    <Link
      href={`/pool/${pool.pool}`}
      className="inline-flex items-center gap-2 px-5 whitespace-nowrap select-none
                 hover:text-hi transition-colors"
      title={`${pool.label} · trending`}
    >
      {pool.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={pool.image}
          alt=""
          className="h-5 w-5 rounded-md object-cover border border-black/10 shrink-0"
        />
      ) : (
        <span className="h-5 w-5 rounded-md shrink-0 grid place-items-center text-[9px] font-bold text-white/90"
          style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}>
          {pool.label.replace(/^\$/, "").slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="label-term !normal-case !tracking-normal text-hi text-xs font-semibold">
        {pool.label}
      </span>
      {/* Small "trending" flame to signal a featured Marketing launch. */}
      <span aria-hidden className="text-[11px] leading-none">
        🔥
      </span>
      <span aria-hidden className="text-lo/50 pl-3">·</span>
    </Link>
  );
}

