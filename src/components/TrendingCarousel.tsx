import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Flame } from "lucide-react";
import { sanitizeImageSrc } from "@/lib/sanitize";
import { listPools } from "@/lib/factoryClient";
import { getAllPoolMeta, metaForPool } from "@/lib/poolMeta";
import { onPoolsChanged } from "@/lib/poolEvents";

type TickerItem = {
  pool: string;
  chainId: number;
  label: string;
  image?: string;
  until: number;
  preview?: boolean;
};

const MIN_CELLS = 6;
const TICKER_H = "36px";

function labelFor(symbol: string, nickname?: string, token?: string): string {
  if (symbol) return `$${symbol}`;
  if (nickname?.trim()) return nickname.trim();
  if (!token) return "Pool";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function padCells(items: TickerItem[]): TickerItem[] {
  if (items.length === 0) return [];
  const out: TickerItem[] = [];
  let i = 0;
  while (out.length < Math.max(MIN_CELLS, items.length)) {
    out.push(items[i % items.length]!);
    i += 1;
  }
  return out;
}

/**
 * Thin marketing ticker, fixed to the top of terminal pages.
 * Live 12h slots lead; a preview strip fills the bar only when none are active.
 */
export function TrendingCarousel() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hide = pathname === "/";
  const [items, setItems] = useState<TickerItem[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const now = Date.now() / 1000;
    const from = (
      summaries: Awaited<ReturnType<typeof listPools>>,
      metaMap: Awaited<ReturnType<typeof getAllPoolMeta>>,
    ) => {
      const seen = new Set<string>();
      const next: TickerItem[] = [];
      for (const p of summaries) {
        if (p.demo) continue;
        const key = p.pool.toLowerCase();
        if (seen.has(key)) continue;
        const meta = metaForPool(metaMap, p.token, p.pool);
        const until = Math.max(p.trendingUntil ?? 0, meta?.marketing?.trendingUntil ?? 0);
        if (until <= now) continue;
        seen.add(key);
        next.push({
          pool: p.pool,
          chainId: p.chainId,
          label: labelFor(p.symbol, meta?.nickname, p.token),
          image: sanitizeImageSrc(meta?.image),
          until,
        });
      }
      next.sort((a, b) => b.until - a.until);
      return next;
    };

    try {
      const [summaries, metaMap] = await Promise.all([listPools(), getAllPoolMeta()]);
      setItems(from(summaries, metaMap));
    } catch {
      // Keep whatever real items we already have. Never wipe live slots on error.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (hide) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [hide, load]);

  useEffect(() => {
    if (hide) return;
    return onPoolsChanged(() => void load());
  }, [hide, load]);

  useEffect(() => {
    if (hide) return;
    const id = window.setInterval(() => {
      const now = Date.now() / 1000;
      setItems((prev) => {
        const kept = prev.filter((i) => i.until > now);
        if (kept.length !== prev.length) void load();
        return kept;
      });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [hide, load]);

  const source = items;
  const visible = useMemo(() => padCells(source), [source]);
  const loop = useMemo(() => [...visible, ...visible], [visible]);

  useEffect(() => {
    const show = !hide && ready && items.length > 0;
    document.documentElement.style.setProperty("--trending-ticker-h", show ? TICKER_H : "0px");
    return () => document.documentElement.style.setProperty("--trending-ticker-h", "0px");
  }, [hide, ready, items.length]);

  if (hide || !ready || items.length === 0) return null;

  return (
    <div
      className="trending-ticker"
      data-testid="trending-bar"
      aria-label="Trending marketing pools"
    >
      <div className="trending-ticker-label">
        <Flame className="trending-ticker-flame" size={13} strokeWidth={2.4} aria-hidden />
        Trending
      </div>
      <div className="trending-ticker-mask">
        <div className="trending-ticker-track">
          {loop.map((item, i) => (
            <TickerCell key={`${item.pool}-${item.label}-${i}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TickerCell({ item }: { item: TickerItem }) {
  const letter = item.label.replace(/^\$/, "").slice(0, 1).toUpperCase() || "?";
  const inner = (
    <>
      {item.image ? (
        <img src={item.image} alt="" className="trending-ticker-img" />
      ) : (
        <span className="trending-ticker-fallback">{letter}</span>
      )}
      <span className="trending-ticker-name">{item.label}</span>
      <Flame className="trending-ticker-flame" size={11} strokeWidth={2.4} aria-hidden />
    </>
  );
  if (item.preview) {
    return <span className="trending-ticker-cell">{inner}</span>;
  }
  return (
    <Link
      to="/pool/$chainId/$address"
      params={{ chainId: String(item.chainId), address: item.pool }}
      className="trending-ticker-cell"
    >
      {inner}
    </Link>
  );
}
