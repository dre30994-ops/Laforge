import {
  MOCK_BRONZE_TOKEN,
  MOCK_ECO_TOKEN,
  MOCK_MKT_TOKEN,
  isMockPoolAddress,
} from "@/lib/mockPools";

/**
 * Market quotes for staking tokens on every launch chain (Robinhood, Ethereum,
 * Base, BNB Chain, HyperEVM). Launch-pad tokens are priced from the deepest
 * DEX pair on *that* chain — DexScreener first, GeckoTerminal backup — so a
 * BSC or HyperEVM farm is valued the same way as an Ethereum one.
 */

export type QuoteSource = "dexscreener" | "geckoterminal" | "stable" | "demo";

export type QuoteQuality = "firm" | "thin" | "stale";

export type TokenQuote = {
  token: string;
  chainId: number;
  priceUsd: number;
  liquidityUsd: number | null;
  volumeH24Usd: number | null;
  pair: string | null;
  dex: string | null;
  source: QuoteSource;
  quality: QuoteQuality;
  quotedAt: number;
};

const MEMORY_TTL_MS = 45_000;
const DISK_TTL_MS = 5 * 60_000;
const THIN_LIQUIDITY_USD = 5_000;
const DISK_KEY = "forge.tokenQuote.v1";
const QUOTE_CONCURRENCY = 6;

/**
 * DexScreener chain slugs to try, in order. HyperEVM pair objects use
 * `hyperevm` (same as the DexScreener URL); `hyperliquid` is a fallback.
 */
export const DEXSCREENER_SLUGS: Record<number, string[]> = {
  1: ["ethereum"],
  8453: ["base"],
  56: ["bsc"],
  999: ["hyperevm", "hyperliquid"],
  4663: ["robinhood"],
};

/** @deprecated use DEXSCREENER_SLUGS — kept for existing imports. */
export const DEXSCREENER_CHAIN: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  56: "bsc",
  999: "hyperevm",
  4663: "robinhood",
};

const GECKO_SLUGS: Record<number, string[]> = {
  1: ["eth"],
  8453: ["base"],
  56: ["bsc"],
  999: ["hyperevm"],
};

const STABLES: Record<number, Set<string>> = {
  1: new Set(
    [
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "0xdac17f958d2ee523a2206206994597c13d831ec7",
      "0x6b175474e89094c44da98b954eedeac495271d0f",
    ].map((a) => a.toLowerCase()),
  ),
  8453: new Set(
    [
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
    ].map((a) => a.toLowerCase()),
  ),
  56: new Set(
    [
      "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
      "0x55d398326f99059ff775485246999027b3197955", // USDT
      "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
      "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", // USD1
    ].map((a) => a.toLowerCase()),
  ),
  999: new Set(
    [
      "0xb88339cb7199b77e23db6e890353e22632ba630f", // USDC
      "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", // USDT0
    ].map((a) => a.toLowerCase()),
  ),
};

const DEMO_QUOTES: Record<string, Omit<TokenQuote, "quotedAt" | "token" | "chainId">> = {
  [MOCK_BRONZE_TOKEN.toLowerCase()]: {
    priceUsd: 0.42,
    liquidityUsd: 12_400,
    volumeH24Usd: 48_000,
    pair: null,
    dex: "Launch pad",
    source: "demo",
    quality: "thin",
  },
  [MOCK_ECO_TOKEN.toLowerCase()]: {
    priceUsd: 1.18,
    liquidityUsd: 420_000,
    volumeH24Usd: 890_000,
    pair: null,
    dex: "Launch pad",
    source: "demo",
    quality: "firm",
  },
  [MOCK_MKT_TOKEN.toLowerCase()]: {
    priceUsd: 2.05,
    liquidityUsd: 1_850_000,
    volumeH24Usd: 3_200_000,
    pair: null,
    dex: "Launch pad",
    source: "demo",
    quality: "firm",
  },
};

type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string | number | null;
  priceNative?: string | number | null;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
};

const memory = new Map<string, { quote: TokenQuote; until: number }>();
const inflight = new Map<string, Promise<TokenQuote | null>>();

function cacheKey(chainId: number, token: string): string {
  return `${chainId}:${token.toLowerCase()}`;
}

function slugSet(chainId: number): Set<string> {
  return new Set((DEXSCREENER_SLUGS[chainId] ?? []).map((s) => s.toLowerCase()));
}

function qualityOf(liquidityUsd: number | null, quotedAt: number): QuoteQuality {
  if (Date.now() - quotedAt > DISK_TTL_MS) return "stale";
  if (liquidityUsd != null && liquidityUsd < THIN_LIQUIDITY_USD) return "thin";
  return "firm";
}

function readDisk(): Record<string, TokenQuote> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TokenQuote>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDisk(key: string, quote: TokenQuote): void {
  if (typeof window === "undefined") return;
  try {
    const map = readDisk();
    map[key] = quote;
    const keys = Object.keys(map);
    if (keys.length > 80) {
      keys
        .sort((a, b) => (map[a]?.quotedAt ?? 0) - (map[b]?.quotedAt ?? 0))
        .slice(0, keys.length - 80)
        .forEach((k) => delete map[k]);
    }
    window.localStorage.setItem(DISK_KEY, JSON.stringify(map));
  } catch {
    // quota
  }
}

function remember(key: string, quote: TokenQuote): TokenQuote {
  memory.set(key, { quote, until: Date.now() + MEMORY_TTL_MS });
  writeDisk(key, quote);
  return quote;
}

async function fetchJson(urls: string[]): Promise<unknown> {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Laforge/1.0)",
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return await res.json();
    } catch {
      // try next origin (direct API, then same-origin proxy)
    }
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function asPairs(raw: unknown): DexPair[] {
  if (Array.isArray(raw)) return raw as DexPair[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { pairs?: DexPair[] }).pairs)) {
    return (raw as { pairs: DexPair[] }).pairs;
  }
  return [];
}

/** USD price of `token` in a pair. Inverts when the token is the quote side (WHYPE, WBNB). */
function pairPriceUsd(pair: DexPair, token: string): number | null {
  const want = token.toLowerCase();
  const priceUsd = num(pair.priceUsd);
  if (priceUsd == null) return null;
  const base = pair.baseToken?.address?.toLowerCase();
  const quote = pair.quoteToken?.address?.toLowerCase();
  if (base === want) return priceUsd;
  if (quote === want) {
    const native = num(pair.priceNative);
    if (native == null) return null;
    const inverted = priceUsd / native;
    return Number.isFinite(inverted) && inverted > 0 ? inverted : null;
  }
  return null;
}

function quoteFromPairs(
  pairs: DexPair[],
  chainId: number,
  token: string,
  source: QuoteSource,
): TokenQuote | null {
  const slugs = slugSet(chainId);
  const onChain = pairs.filter((p) => {
    if (!p.chainId) return slugs.size === 0;
    return slugs.has(p.chainId.toLowerCase());
  });
  const pool = onChain.length > 0 ? onChain : pairs;
  const scored = pool
    .map((p) => ({ p, priceUsd: pairPriceUsd(p, token), liq: p.liquidity?.usd ?? 0 }))
    .filter((row): row is { p: DexPair; priceUsd: number; liq: number } => row.priceUsd != null);
  scored.sort((a, b) => b.liq - a.liq);
  const best = scored[0];
  if (!best) return null;
  const quotedAt = Date.now();
  return {
    token: token.toLowerCase(),
    chainId,
    priceUsd: best.priceUsd,
    liquidityUsd: best.p.liquidity?.usd ?? null,
    volumeH24Usd: best.p.volume?.h24 ?? null,
    pair: best.p.pairAddress ?? null,
    dex: best.p.dexId ?? null,
    source,
    quality: qualityOf(best.p.liquidity?.usd ?? null, quotedAt),
    quotedAt,
  };
}

async function fromDexScreener(chainId: number, token: string): Promise<TokenQuote | null> {
  const slugs = DEXSCREENER_SLUGS[chainId] ?? [];
  // token-pairs first: wrapped natives (WHYPE, WBNB) are usually the quote side
  // and /tokens/v1 often returns a single thin pair.
  for (const slug of slugs) {
    const paths = [`/token-pairs/v1/${slug}/${token}`, `/tokens/v1/${slug}/${token}`];
    for (const path of paths) {
      const raw = await fetchJson([
        `https://api.dexscreener.com${path}`,
        `/api/dexscreener${path}`,
      ]);
      const hit = quoteFromPairs(asPairs(raw), chainId, token, "dexscreener");
      if (hit) return hit;
    }
  }

  const legacy = `/latest/dex/tokens/${token}`;
  const raw = await fetchJson([
    `https://api.dexscreener.com${legacy}`,
    `/api/dexscreener${legacy}`,
  ]);
  return quoteFromPairs(asPairs(raw), chainId, token, "dexscreener");
}

function geckoPriceMap(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const attrs = (raw as { data?: { attributes?: { token_prices?: Record<string, string> } } })
    .data?.attributes?.token_prices;
  return attrs && typeof attrs === "object" ? attrs : null;
}

function geckoAttrPrice(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const attrs = (raw as { data?: { attributes?: { price_usd?: string; volume_usd?: { h24?: string } } } })
    .data?.attributes;
  return num(attrs?.price_usd);
}

async function fromGeckoTerminal(chainId: number, token: string): Promise<TokenQuote | null> {
  const nets = GECKO_SLUGS[chainId] ?? [];
  const addr = token.toLowerCase();
  for (const net of nets) {
    const simple = `/api/v2/simple/networks/${net}/token_price/${addr}`;
    const simpleJson = await fetchJson([
      `https://api.geckoterminal.com${simple}`,
      `/api/geckoterminal${simple}`,
    ]);
    const map = geckoPriceMap(simpleJson);
    let priceUsd: number | null = null;
    if (map) {
      for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === addr) {
          priceUsd = num(v);
          break;
        }
      }
    }
    if (priceUsd == null) {
      const path = `/api/v2/networks/${net}/tokens/${addr}`;
      const json = await fetchJson([
        `https://api.geckoterminal.com${path}`,
        `/api/geckoterminal${path}`,
      ]);
      priceUsd = geckoAttrPrice(json);
    }
    if (priceUsd == null) continue;
    const quotedAt = Date.now();
    return {
      token: addr,
      chainId,
      priceUsd,
      liquidityUsd: null,
      volumeH24Usd: null,
      pair: null,
      dex: null,
      source: "geckoterminal",
      quality: qualityOf(null, quotedAt),
      quotedAt,
    };
  }
  return null;
}

function demoQuote(chainId: number, token: string): TokenQuote | null {
  const seed = DEMO_QUOTES[token.toLowerCase()];
  if (!seed) return null;
  return {
    ...seed,
    token: token.toLowerCase(),
    chainId,
    quotedAt: Date.now(),
  };
}

function stableQuote(chainId: number, token: string): TokenQuote | null {
  if (!STABLES[chainId]?.has(token.toLowerCase())) return null;
  const quotedAt = Date.now();
  return {
    token: token.toLowerCase(),
    chainId,
    priceUsd: 1,
    liquidityUsd: null,
    volumeH24Usd: null,
    pair: null,
    dex: null,
    source: "stable",
    quality: "firm",
    quotedAt,
  };
}

/**
 * USD price for a token on a launch chain. Prefers the deepest DEX pair so
 * freshly launched pad tokens resolve before any CEX listing exists.
 */
export async function fetchTokenQuote(chainId: number, token: string): Promise<TokenQuote | null> {
  if (!token) return null;
  const key = cacheKey(chainId, token);
  const now = Date.now();
  const mem = memory.get(key);
  if (mem && mem.until > now) return mem.quote;

  const pending = inflight.get(key);
  if (pending) return pending;

  const run = (async (): Promise<TokenQuote | null> => {
    const demo = isMockPoolAddress(token) ? demoQuote(chainId, token) : null;
    if (demo) return remember(key, demo);

    const stable = stableQuote(chainId, token);
    if (stable) return remember(key, stable);

    const disk = readDisk()[key];
    const dex = await fromDexScreener(chainId, token);
    if (dex) return remember(key, dex);
    const gecko = await fromGeckoTerminal(chainId, token);
    if (gecko) return remember(key, gecko);

    if (disk && now - disk.quotedAt < DISK_TTL_MS * 3) {
      return remember(key, { ...disk, quality: "stale" });
    }
    return disk ?? null;
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

async function mapLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const n = Math.min(limit, Math.max(items.length, 1));
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
}

/** Quote many tokens; inflight cache dedupes identical chain+token pairs. */
export async function fetchTokenQuotes(
  items: { chainId: number; token: string }[],
): Promise<Map<string, TokenQuote>> {
  const out = new Map<string, TokenQuote>();
  const unique = new Map<string, { chainId: number; token: string }>();
  for (const i of items) {
    if (!i.token) continue;
    unique.set(cacheKey(i.chainId, i.token), i);
  }
  await mapLimited([...unique.values()], QUOTE_CONCURRENCY, async (i) => {
    const q = await fetchTokenQuote(i.chainId, i.token);
    if (q) out.set(cacheKey(i.chainId, i.token), q);
  });
  return out;
}

export function quoteMapKey(chainId: number, token: string): string {
  return cacheKey(chainId, token);
}

export function formatUsdPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  if (price >= 1_000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toPrecision(3)}`;
}

export function formatUsd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs === 0) return `${sign}$0`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `${sign}$${abs.toFixed(4)}`;
}

export function quoteLabel(q: TokenQuote): string {
  if (q.source === "demo") return "Launch pad quote";
  if (q.source === "stable") return "Stable";
  if (q.source === "geckoterminal") return "GeckoTerminal";
  if (q.dex) return `DexScreener · ${q.dex}`;
  return "DexScreener";
}
