/**
 * Forge pool-meta worker.
 *
 * KV JSON keyed by lowercased token (and optionally pool) address.
 * R2 raster bytes for image/banner.
 *
 * Banner + socials are persisted only after factory.poolOf(token) → pool.tier()
 * reports tier >= 1 on the *correct chain*. Client-supplied tier is ignored.
 */

export interface Env {
  META: KVNamespace;
  IMAGES: R2Bucket;
  FACTORY_4663?: string;
  RPC_4663?: string;
  FACTORY_1?: string;
  RPC_1?: string;
  FACTORY_8453?: string;
  RPC_8453?: string;
  FACTORY_56?: string;
  RPC_56?: string;
  FACTORY_999?: string;
  RPC_999?: string;
}

type Socials = {
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
};

type PoolMeta = {
  nickname?: string;
  image?: string;
  tier?: number;
  banner?: string;
  socials?: Socials;
  marketing?: { verifiedBadge?: boolean; trendingUntil?: number };
};

const MIN_BRANDED_TIER = 1;
const MAX_TRENDING_WINDOW_SECONDS = 12 * 60 * 60;
const ZERO = "0x0000000000000000000000000000000000000000";
const POOL_OF_SELECTOR = "0x988b1fa7";
const TIER_SELECTOR = "0x16f4d022";

type FactoryEntry = { factory: string; rpc: string };

const DEFAULT_FACTORY_BY_CHAIN: Record<number, FactoryEntry> = {
  4663: {
    factory: "0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
  },
  1: {
    factory: "0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f",
    rpc: "https://ethereum.publicnode.com",
  },
  8453: {
    factory: "0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f",
    rpc: "https://base.publicnode.com",
  },
  56: {
    factory: "0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f",
    rpc: "https://bsc.publicnode.com",
  },
  999: {
    factory: "0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f",
    rpc: "https://rpc.hyperliquid.xyz/evm",
  },
};

function factoryByChain(env: Env): Record<number, FactoryEntry> {
  const pick = (id: number, factory?: string, rpc?: string): FactoryEntry => ({
    factory: factory || DEFAULT_FACTORY_BY_CHAIN[id]!.factory,
    rpc: rpc || DEFAULT_FACTORY_BY_CHAIN[id]!.rpc,
  });
  return {
    4663: pick(4663, env.FACTORY_4663, env.RPC_4663),
    1: pick(1, env.FACTORY_1, env.RPC_1),
    8453: pick(8453, env.FACTORY_8453, env.RPC_8453),
    56: pick(56, env.FACTORY_56, env.RPC_56),
    999: pick(999, env.FACTORY_999, env.RPC_999),
  };
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function normalize(addr: string): string {
  return addr.trim().toLowerCase();
}

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function padAddress(addr: string): string {
  return addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

async function ethCall(rpc: string, to: string, data: string): Promise<string | null> {
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string; error?: { message?: string } };
    if (!body.result || typeof body.result !== "string") return null;
    return body.result;
  } catch {
    return null;
  }
}

function decodeAddress(result: string): string | null {
  const hex = result.replace(/^0x/, "").toLowerCase();
  if (hex.length < 64) return null;
  const addr = `0x${hex.slice(-40)}`;
  if (addr === ZERO) return null;
  return addr;
}

function decodeUint(result: string): number | null {
  const hex = result.replace(/^0x/, "");
  if (!hex) return null;
  const n = Number.parseInt(hex.slice(-2) || "0", 16);
  return Number.isFinite(n) ? n : null;
}

async function resolvePoolOf(rpc: string, factory: string, token: string): Promise<string | null> {
  const data = `${POOL_OF_SELECTOR}${padAddress(token)}`;
  const raw = await ethCall(rpc, factory, data);
  if (!raw) return null;
  return decodeAddress(raw);
}

async function readTier(rpc: string, pool: string): Promise<number | null> {
  const raw = await ethCall(rpc, pool, TIER_SELECTOR);
  if (!raw) return null;
  return decodeUint(raw);
}

function entryForHint(
  map: Record<number, FactoryEntry>,
  chainId?: number,
  factoryHint?: string,
): FactoryEntry | null {
  if (chainId && map[chainId]) return map[chainId];
  if (factoryHint) {
    const needle = factoryHint.toLowerCase();
    for (const entry of Object.values(map)) {
      if (entry.factory.toLowerCase() === needle) return entry;
    }
  }
  return null;
}

/**
 * Resolve on-chain pool + tier. Fail closed: missing RPC/factory → tier 0,
 * so branded fields are dropped rather than trusted from the client.
 */
async function resolveOnchain(
  env: Env,
  token: string,
  opts: { chainId?: number; factory?: string; pool?: string },
): Promise<{ pool: string | null; tier: number }> {
  const map = factoryByChain(env);
  const hinted = entryForHint(map, opts.chainId, opts.factory);

  const tryEntry = async (entry: FactoryEntry): Promise<{ pool: string | null; tier: number } | null> => {
    const pool = (opts.pool && isAddress(opts.pool) ? opts.pool : null) || (await resolvePoolOf(entry.rpc, entry.factory, token));
    if (!pool) return null;
    // Confirm this factory actually owns the token unless the client already
    // passed the pool and we just need its tier.
    if (!opts.pool) {
      const owned = await resolvePoolOf(entry.rpc, entry.factory, token);
      if (!owned || owned.toLowerCase() !== pool.toLowerCase()) return null;
    } else {
      const owned = await resolvePoolOf(entry.rpc, entry.factory, token);
      if (owned && owned.toLowerCase() !== pool.toLowerCase()) return null;
    }
    const cached = await env.META.get(`tier:${pool.toLowerCase()}`);
    if (cached != null && cached !== "") {
      const n = Number(cached);
      if (Number.isInteger(n) && n >= 0 && n <= 2) return { pool, tier: n };
    }
    const tier = await readTier(entry.rpc, pool);
    if (tier == null) return { pool, tier: 0 };
    await env.META.put(`tier:${pool.toLowerCase()}`, String(tier), { expirationTtl: 24 * 60 * 60 });
    return { pool, tier };
  };

  if (hinted) {
    const hit = await tryEntry(hinted);
    if (hit) return hit;
    return { pool: null, tier: 0 };
  }

  for (const entry of Object.values(map)) {
    const hit = await tryEntry(entry);
    if (hit?.pool) return hit;
  }
  return { pool: null, tier: 0 };
}

function sanitizeHttp(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value || value.length > 200) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function allowHosts(url: string | undefined, hosts: string[]): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return hosts.some((h) => host === h || host.endsWith(`.${h}`)) ? url : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeSocials(socials: Socials | undefined): Socials | undefined {
  if (!socials) return undefined;
  const cleaned: Socials = {
    website: sanitizeHttp(socials.website),
    twitter: allowHosts(sanitizeHttp(socials.twitter), ["x.com", "twitter.com"]),
    telegram: allowHosts(sanitizeHttp(socials.telegram), ["t.me", "telegram.me", "telegram.org"]),
    discord: allowHosts(sanitizeHttp(socials.discord), ["discord.gg", "discord.com"]),
  };
  if (cleaned.website || cleaned.twitter || cleaned.telegram || cleaned.discord) return cleaned;
  return undefined;
}

function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function decodeDataUrl(input: unknown): { bytes: Uint8Array; contentType: string } | null {
  if (typeof input !== "string" || !input.startsWith("data:")) return null;
  const match = input.match(/^data:([^;]+);base64,([a-zA-Z0-9+/]+=*)$/);
  if (!match) return null;
  try {
    const raw = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    const sniffed = sniffImage(raw);
    if (!sniffed) return null;
    return { bytes: raw, contentType: sniffed };
  } catch {
    return null;
  }
}

async function putImage(env: Env, key: string, bytes: Uint8Array, contentType: string, origin: string): Promise<string | undefined> {
  try {
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
    return `${origin}/images/${key}`;
  } catch {
    return undefined;
  }
}

function gateMeta(meta: PoolMeta, tier: number): PoolMeta {
  const out: PoolMeta = {};
  if (meta.nickname) out.nickname = meta.nickname.slice(0, 80);
  if (meta.image) out.image = meta.image;
  out.tier = tier;
  if (tier >= MIN_BRANDED_TIER) {
    if (meta.banner) out.banner = meta.banner;
    if (meta.socials) out.socials = meta.socials;
  }
  if (meta.marketing) {
    const marketing: NonNullable<PoolMeta["marketing"]> = {};
    if (tier === 2 && meta.marketing.verifiedBadge) marketing.verifiedBadge = true;
    if (typeof meta.marketing.trendingUntil === "number" && Number.isFinite(meta.marketing.trendingUntil)) {
      const now = Math.floor(Date.now() / 1000);
      marketing.trendingUntil = Math.min(meta.marketing.trendingUntil, now + MAX_TRENDING_WINDOW_SECONDS);
    }
    if (marketing.verifiedBadge || marketing.trendingUntil) out.marketing = marketing;
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const origin = url.origin;

    if (request.method === "GET" && url.pathname.startsWith("/images/")) {
      const key = url.pathname.slice("/images/".length);
      const obj = await env.IMAGES.get(key);
      if (!obj) return new Response("Not found", { status: 404, headers: CORS });
      const headers = new Headers(CORS);
      headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
      headers.set("Content-Disposition", "inline");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(obj.body, { headers });
    }

    if (request.method === "GET" && url.pathname === "/pools") {
      const list = await env.META.list({ prefix: "meta:" });
      const map: Record<string, PoolMeta> = {};
      await Promise.all(
        list.keys.map(async (k) => {
          const raw = await env.META.get(k.name);
          if (!raw) return;
          try {
            map[k.name.slice("meta:".length)] = JSON.parse(raw) as PoolMeta;
          } catch {
            // skip
          }
        }),
      );
      return json(map);
    }

    const putMatch = url.pathname.match(/^\/pools\/(0x[0-9a-fA-F]{40})$/);
    if (putMatch && request.method === "GET") {
      const token = normalize(putMatch[1]);
      const raw = await env.META.get(`meta:${token}`);
      if (!raw) return json({ error: "not found" }, 404);
      return json(JSON.parse(raw));
    }

    if (putMatch && request.method === "PUT") {
      const token = normalize(putMatch[1]);
      let body: Record<string, unknown> = {};
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "invalid json" }, 400);
      }

      const chainId = typeof body.chainId === "number" ? body.chainId : Number(body.chainId);
      const factory = typeof body.factory === "string" ? body.factory : undefined;
      const poolHint = typeof body.pool === "string" ? body.pool : undefined;

      const onchain = await resolveOnchain(env, token, {
        chainId: Number.isInteger(chainId) ? chainId : undefined,
        factory,
        pool: poolHint,
      });

      const existingRaw = await env.META.get(`meta:${token}`);
      const existing: PoolMeta = existingRaw ? (JSON.parse(existingRaw) as PoolMeta) : {};

      const next: PoolMeta = { ...existing };
      if (typeof body.nickname === "string") next.nickname = body.nickname.trim().slice(0, 80);

      const imageDecoded = decodeDataUrl(body.imageBase64);
      if (imageDecoded) {
        const hosted = await putImage(env, `${token}/image`, imageDecoded.bytes, imageDecoded.contentType, origin);
        if (hosted) next.image = hosted;
      }

      const bannerDecoded = decodeDataUrl(body.bannerBase64);
      if (bannerDecoded) {
        const hosted = await putImage(env, `${token}/banner`, bannerDecoded.bytes, bannerDecoded.contentType, origin);
        if (hosted) next.banner = hosted;
      }

      if (body.socials && typeof body.socials === "object") {
        next.socials = sanitizeSocials(body.socials as Socials);
      }
      if (body.marketing && typeof body.marketing === "object") {
        next.marketing = body.marketing as PoolMeta["marketing"];
      }

      const gated = gateMeta(next, onchain.tier);
      await env.META.put(`meta:${token}`, JSON.stringify(gated));
      if (onchain.pool) {
        await env.META.put(`meta:${onchain.pool.toLowerCase()}`, JSON.stringify(gated));
        await env.META.put(`poolof:${token}`, onchain.pool.toLowerCase(), { expirationTtl: 5 * 60 });
      }
      return json(gated);
    }

    return json({ error: "not found" }, 404);
  },
};
