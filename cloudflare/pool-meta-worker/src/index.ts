/**
 * Pool metadata Worker — shared, off-chain, display-only metadata for staking
 * pools (nickname, image, and — for the Marketing tier — a banner and social
 * links), keyed by the pool's token address.
 *
 * Storage:
 *   - KV (POOL_META):   token(lowercase) -> JSON { nickname?, image?, tier?, banner?, socials?, marketing? }
 *   - R2 (POOL_IMAGES): raw image bytes at key `images/<token>.<ext>` (pool image)
 *                       and `images/<token>-banner.<ext>` (banner)
 *
 * Routes:
 *   GET  /pools           -> { [token]: PoolMeta }                (all metadata)
 *   GET  /pools/:token    -> PoolMeta                             (single; 404 if none)
 *   PUT  /pools/:token    -> body { nickname?, imageBase64?, imageContentType?,
 *                                   bannerBase64?, bannerContentType?, socials?, tier? }
 *                            stores metadata; uploads images to R2; returns the
 *                            stored record with resolvable image URLs.
 *   GET  /images/:key     -> serves an image from R2 (fallback when no public
 *                            R2 base URL is configured).
 *
 * Marketing-tier gating: `banner` and `socials` are only persisted/returned for
 * pools that actually paid for the Marketing tier. This is verified SERVER-SIDE
 * by reading the pool's on-chain `tier()` (resolved via the factory's
 * `poolOf(token)`) over JSON-RPC — the client's claimed tier is not trusted. If
 * RPC/config is unavailable the gated fields are dropped (fail closed).
 *
 * All responses are JSON (except /images) and CORS-enabled.
 */

export interface Env {
  POOL_META: KVNamespace;
  POOL_IMAGES: R2Bucket;
  ALLOWED_ORIGINS: string;
  IMAGE_PUBLIC_BASE_URL: string;
  /** Max write requests per IP per window (default 10). */
  RATE_LIMIT_MAX?: string;
  /** Rate-limit window length in seconds (default 60). */
  RATE_LIMIT_WINDOW_SECONDS?: string;
  /** JSON-RPC endpoint used to verify a pool's on-chain tier (Marketing gating). */
  RPC_URL?: string;
  /** StakingFactory address used to resolve poolOf(token) for tier verification. */
  FACTORY_ADDRESS?: string;
}

/** Social links (Marketing tier only). All values are validated https URLs. */
type Socials = {
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
};

/** Stored + returned metadata shape. `image`/`banner` are fully-qualified URLs. */
type PoolMeta = {
  nickname?: string;
  image?: string;
  /** Pricing tier index (0=Bronze, 1=Ecosystem, 2=Marketing), display-only. */
  tier?: number;
  /** Banner image URL (Marketing tier only). */
  banner?: string;
  /** Social links (Marketing tier only). */
  socials?: Socials;
  /** Marketing-tier perks (verified on-chain; time-bounded server-side). */
  marketing?: {
    /** Show a "verified safe" badge. */
    verifiedBadge?: boolean;
    /** Unix seconds until which the pool appears on the trending carousel. */
    trendingUntil?: number;
  };
};

/**
 * Lowest tier that unlocks branded metadata (banner + social links).
 * Ecosystem (1) and Marketing (2) both qualify; Bronze (0) does not.
 */
const MIN_BRANDED_TIER = 1;

/** Tier index that unlocks Marketing perks (verified badge + trending window). */
const MARKETING_TIER = 2;

/**
 * Max trending window the server will honor, in seconds. A client cannot
 * request a longer feature than this; `trendingUntil` is clamped to
 * `now + MAX_TRENDING_WINDOW_SECONDS`. Matches the app's 12h product spec.
 */
const MAX_TRENDING_WINDOW_SECONDS = 12 * 60 * 60;

/**
 * TTLs for the verification caches (seconds; KV minimum is 60s).
 *
 * A pool's `tier()` is immutable, so it's cached long by POOL ADDRESS. But a
 * token can be re-pointed to a NEW pool after the old one ends (possibly a
 * different tier), so the `poolOf(token)` resolution is cached only briefly.
 * Keying tier by pool address (not token) means a re-created pool is verified
 * fresh once its short poolOf cache expires — no stale tier can leak through.
 */
const POOL_TIER_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h — tier is immutable per pool
const POOL_OF_CACHE_TTL_SECONDS = 300; // 5m — token→pool can change on re-creation

/** Max length for a single social URL. */
const MAX_SOCIAL_URL_LEN = 200;

/** Max decoded image size accepted for upload (15 MB). */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const KV_INDEX_KEY = "__index__"; // tracks known tokens for the /pools listing

/** Rate-limit defaults (per client IP, applied to write requests). */
const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean); // e.g. ["pools", "0x.."]

      // GET /images/<key...>
      if (parts[0] === "images" && request.method === "GET") {
        return serveImage(parts.slice(1).join("/"), env, cors);
      }

      if (parts[0] === "pools") {
        // GET /pools  → all metadata
        if (parts.length === 1 && request.method === "GET") {
          return json(await listAll(env, url.origin), cors);
        }
        // /pools/:token
        if (parts.length === 2) {
          const token = normalize(parts[1]);
          if (request.method === "GET") {
            const meta = await readMeta(env, token);
            return meta ? json(meta, cors) : json({ error: "not found" }, cors, 404);
          }
          if (request.method === "PUT" || request.method === "POST") {
            const limited = await enforceRateLimit(request, env, cors);
            if (limited) return limited;
            return handlePut(request, env, token, url.origin, cors);
          }
        }
      }

      return json({ error: "not found" }, cors, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal error";
      return json({ error: message }, cors, 500);
    }
  },
};

// ── Handlers ──────────────────────────────────────────────────────────────

async function handlePut(
  request: Request,
  env: Env,
  token: string,
  workerOrigin: string,
  cors: Record<string, string>
): Promise<Response> {
  if (!token) return json({ error: "missing token" }, cors, 400);

  const body = (await request.json().catch(() => null)) as
    | {
        nickname?: string;
        imageBase64?: string;
        imageContentType?: string;
        image?: string;
        bannerBase64?: string;
        bannerContentType?: string;
        socials?: Socials;
        tier?: number;
        marketing?: { verifiedBadge?: boolean; trendingUntil?: number };
      }
    | null;
  if (!body || typeof body !== "object") {
    return json({ error: "invalid JSON body" }, cors, 400);
  }

  // Start from the EXISTING stored record so this behaves as a partial update:
  // fields the client omits (e.g. an already-hosted image, or banner/socials on
  // a marketing-add-on write) are preserved, and only fields present in the
  // body override them. Without this, buying the add-on — which sends just
  // `marketing` — would wipe the pool's nickname/image.
  const existing = (await readMeta(env, token)) ?? {};
  const meta: PoolMeta = { ...existing };

  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (nickname) meta.nickname = nickname.slice(0, 80);

  // Tier is display-only metadata; the authoritative value for gating is read
  // on-chain below. Persist the client-provided index only as a hint.
  if (typeof body.tier === "number" && body.tier >= 0 && body.tier <= 2) {
    meta.tier = Math.floor(body.tier);
  }

  // Image: accept a base64 payload (data URL or raw base64) and store in R2.
  const rawImage = body.imageBase64 ?? body.image;
  if (rawImage) {
    const decoded = decodeImage(rawImage, body.imageContentType);
    if ("error" in decoded) return json({ error: decoded.error }, cors, 400);
    if (decoded.bytes.byteLength > MAX_IMAGE_BYTES) {
      return json(
        { error: `image too large (max ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB)` },
        cors,
        400
      );
    }
    const ext = extForContentType(decoded.contentType);
    const key = `images/${token}.${ext}`;
    await env.POOL_IMAGES.put(key, decoded.bytes, {
      httpMetadata: { contentType: decoded.contentType },
    });
    meta.image = imageUrl(env, key, workerOrigin);
  }

  // ── Branded-tier gating for banner + socials ───────────────────────────
  // These fields are only stored if the pool paid for a branded tier
  // (Ecosystem or Marketing), verified by reading its on-chain tier() (resolved
  // via the factory). The client's claimed tier is NOT trusted. Fails closed
  // (drops the fields) when RPC/config is missing or the pool is Bronze.
  const wantsGated = !!(body.bannerBase64 || body.socials);
  if (wantsGated) {
    const isBranded = await verifyBrandedTier(env, token);
    if (isBranded) {
      // Banner image -> R2 (separate key from the pool image).
      if (body.bannerBase64) {
        const decoded = decodeImage(body.bannerBase64, body.bannerContentType);
        if ("error" in decoded) return json({ error: decoded.error }, cors, 400);
        if (decoded.bytes.byteLength > MAX_IMAGE_BYTES) {
          return json(
            { error: `banner too large (max ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB)` },
            cors,
            400
          );
        }
        const ext = extForContentType(decoded.contentType);
        const key = `images/${token}-banner.${ext}`;
        await env.POOL_IMAGES.put(key, decoded.bytes, {
          httpMetadata: { contentType: decoded.contentType },
        });
        meta.banner = imageUrl(env, key, workerOrigin);
      }
      // Socials: sanitize + validate each URL (https, length, host allowlist).
      if (body.socials) {
        const socials = sanitizeSocials(body.socials);
        if (Object.keys(socials).length > 0) meta.socials = socials;
      }
    }
    // If not a branded tier (or unverifiable), banner/socials are dropped.
  }

  // ── Trending window + verified badge ───────────────────────────────────
  // `marketing.trendingUntil` drives the trending carousel. It is granted by
  // either path in the product:
  //   (a) launching a MARKETING-tier pool, or
  //   (b) buying the paid "Marketing add-on" (a flat ETH payment) on ANY pool.
  //
  // The add-on payment is a plain value transfer with no on-chain per-pool
  // record, so the Worker CANNOT cryptographically verify it. We therefore
  // gate the trending window on the pool merely EXISTING in the factory
  // (`poolOf(token)` resolves to a real pool) and clamp the window to at most
  // MAX_TRENDING_WINDOW_SECONDS from now. `verifiedBadge` is stricter: it is a
  // safety signal, so it is only granted to the on-chain MARKETING tier.
  //
  // NOTE: because add-on payment isn't verifiable on-chain, a determined caller
  // could set a (bounded) trending window without paying. The clamp limits the
  // blast radius; a tamper-proof fix requires an on-chain add-on registry the
  // Worker can read. Tracked as a follow-up.
  if (body.marketing) {
    const pool = await resolvePoolForToken(env, token);
    if (pool) {
      const nowSec = Math.floor(Date.now() / 1000);
      // Merge onto any existing marketing perks so a partial update (e.g. the
      // add-on sending only `trendingUntil`) doesn't drop an existing badge.
      const cleaned: NonNullable<PoolMeta["marketing"]> = { ...(existing.marketing ?? {}) };

      // Verified badge → Marketing tier only.
      if (body.marketing.verifiedBadge === true) {
        const tier = await tierForPool(env, pool);
        if (tier === MARKETING_TIER) cleaned.verifiedBadge = true;
      }

      // Trending window → any real pool, clamped to [now, now + 12h].
      const requested = body.marketing.trendingUntil;
      if (typeof requested === "number" && Number.isFinite(requested)) {
        const maxUntil = nowSec + MAX_TRENDING_WINDOW_SECONDS;
        const until = Math.min(Math.floor(requested), maxUntil);
        if (until > nowSec) cleaned.trendingUntil = until;
      }

      if (cleaned.verifiedBadge || cleaned.trendingUntil) meta.marketing = cleaned;
    }
    // If the pool doesn't resolve on-chain, marketing perks are dropped.
  }

  // If nothing to store, delete the record entirely.
  if (
    !meta.nickname &&
    !meta.image &&
    typeof meta.tier !== "number" &&
    !meta.banner &&
    !meta.socials &&
    !meta.marketing
  ) {
    await env.POOL_META.delete(token);
    await removeFromIndex(env, token);
    return json({}, cors);
  }

  await env.POOL_META.put(token, JSON.stringify(meta));
  await addToIndex(env, token);
  return json(meta, cors);
}

async function serveImage(
  key: string,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  if (!key) return json({ error: "missing key" }, cors, 400);
  const obj = await env.POOL_IMAGES.get(key);
  if (!obj) return json({ error: "not found" }, cors, 404);
  const headers = new Headers(cors);
  headers.set("Content-Type", obj.httpMetadata?.contentType ?? "application/octet-stream");
  // Defense-in-depth: stored types are already validated raster formats, but
  // prevent browsers from content-sniffing the response into anything else.
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

// ── Rate limiting ─────────────────────────────────────────────────────────

/**
 * Simple per-IP, fixed-window rate limiter for write requests, backed by KV.
 *
 * Keyed by `ratelimit:<ip>:<windowBucket>` with a KV TTL equal to the window,
 * so counters auto-expire and need no cleanup. This is a *soft* limit — KV is
 * eventually consistent, so bursts across edge locations may slip a few extra
 * requests through. That's fine here: the goal is cheap spam insurance for
 * public, cosmetic data, not a hard security boundary.
 *
 * Returns a 429 Response when the limit is exceeded, or null to proceed.
 */
async function enforceRateLimit(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response | null> {
  const max = intFromEnv(env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX);
  const windowSec = intFromEnv(
    env.RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_RATE_LIMIT_WINDOW_SECONDS
  );

  // Disabled if max <= 0.
  if (max <= 0) return null;

  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";

  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSec);
  const key = `ratelimit:${ip}:${bucket}`;

  const current = Number((await env.POOL_META.get(key)) ?? "0");
  if (current >= max) {
    const retryAfter = (bucket + 1) * windowSec - now;
    return json({ error: "rate limit exceeded. slow down." }, cors, 429, {
      "Retry-After": String(Math.max(1, retryAfter)),
    });
  }

  // Increment. Set TTL to the window so the counter self-expires. (KV requires
  // a minimum TTL of 60s, so we floor it there.)
  await env.POOL_META.put(key, String(current + 1), {
    expirationTtl: Math.max(60, windowSec),
  });

  return null;
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const n = value !== undefined ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// ── KV helpers ──────────────────────────────────────────────────────────────

async function readMeta(env: Env, token: string): Promise<PoolMeta | null> {
  const raw = await env.POOL_META.get(token);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PoolMeta;
  } catch {
    return null;
  }
}

async function listAll(env: Env, _workerOrigin: string): Promise<Record<string, PoolMeta>> {
  const index = await readIndex(env);
  const out: Record<string, PoolMeta> = {};
  // Read each known token's metadata. Volumes here are small (one entry per
  // pool), so sequential-ish parallel reads are fine.
  await Promise.all(
    index.map(async (token) => {
      const meta = await readMeta(env, token);
      if (meta) out[token] = meta;
    })
  );
  return out;
}

async function readIndex(env: Env): Promise<string[]> {
  const raw = await env.POOL_META.get(KV_INDEX_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

async function addToIndex(env: Env, token: string): Promise<void> {
  const index = await readIndex(env);
  if (!index.includes(token)) {
    index.push(token);
    await env.POOL_META.put(KV_INDEX_KEY, JSON.stringify(index));
  }
}

async function removeFromIndex(env: Env, token: string): Promise<void> {
  const index = await readIndex(env);
  const next = index.filter((t) => t !== token);
  if (next.length !== index.length) {
    await env.POOL_META.put(KV_INDEX_KEY, JSON.stringify(next));
  }
}

// ── Image decoding / URLs ────────────────────────────────────────────────────

/**
 * Decode a base64 image payload and authoritatively determine its type by
 * sniffing magic bytes — the client-supplied content type is NOT trusted.
 *
 * Only raster formats (PNG, JPEG, GIF, WebP) are accepted. SVG/XML/HTML and any
 * other payload have no recognized raster signature and are rejected, which
 * closes the stored-XSS vector that scriptable SVGs would otherwise open.
 *
 * The returned `contentType` is derived from the sniffed bytes, so a file that
 * lies about its type in the data URL / hint cannot be stored under a mismatched
 * content type.
 */
function decodeImage(
  input: string,
  _contentTypeHint?: string
): { bytes: Uint8Array; contentType: string } | { error: string } {
  let base64 = input.trim();

  // Strip a data URL prefix if present: data:image/png;base64,XXXX
  // The declared type here is intentionally ignored; bytes are the source of truth.
  const m = base64.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) {
    base64 = m[2];
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return { error: "invalid base64 image data" };
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    return {
      error:
        "unsupported or unrecognized image. Allowed: PNG, JPEG, WebP, GIF (SVG is not allowed).",
    };
  }

  return { bytes, contentType: sniffed };
}

/**
 * Inspect the leading bytes of a buffer and return its raster image content
 * type, or null if it doesn't match a recognized/allowed format.
 *
 * Signatures:
 *   PNG  : 89 50 4E 47 0D 0A 1A 0A
 *   JPEG : FF D8 FF
 *   GIF  : "GIF87a" / "GIF89a"
 *   WebP : "RIFF" .... "WEBP"
 */
function sniffImageType(b: Uint8Array): string | null {
  if (b.length < 12) return null;

  // PNG
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF ("GIF87a" or "GIF89a")
  if (
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    return "image/gif";
  }

  // WebP: "RIFF"????"WEBP"
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function extForContentType(ct: string): string {
  switch (ct) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "img";
  }
}

/** Build a resolvable URL for a stored R2 object key. */
function imageUrl(env: Env, key: string, workerOrigin: string): string {
  const base = env.IMAGE_PUBLIC_BASE_URL?.trim();
  if (base) {
    return `${base.replace(/\/$/, "")}/${key}`;
  }
  // Fall back to serving through this Worker.
  return `${workerOrigin}/${key}`;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function normalize(token: string): string {
  return decodeURIComponent(token).trim().toLowerCase();
}

// ── Social link sanitization ────────────────────────────────────────────────

/**
 * Validate + normalize social links. Each must be an https URL, within a length
 * cap, and (except the free-form website) match an allowlisted host. Invalid or
 * disallowed entries are dropped. Returns only the fields that passed.
 */
function sanitizeSocials(input: unknown): Socials {
  const out: Socials = {};
  if (!input || typeof input !== "object") return out;
  const s = input as Record<string, unknown>;

  const website = validUrl(s.website, null);
  if (website) out.website = website;

  const twitter = validUrl(s.twitter, ["x.com", "twitter.com", "www.x.com", "www.twitter.com"]);
  if (twitter) out.twitter = twitter;

  const telegram = validUrl(s.telegram, ["t.me", "telegram.me", "www.t.me"]);
  if (telegram) out.telegram = telegram;

  const discord = validUrl(s.discord, ["discord.gg", "discord.com", "www.discord.com"]);
  if (discord) out.discord = discord;

  return out;
}

/**
 * Return a cleaned https URL if `value` is a valid, length-bounded https URL and
 * (when `hosts` is provided) its hostname is in the allowlist; otherwise null.
 */
function validUrl(value: unknown, hosts: string[] | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v.length > MAX_SOCIAL_URL_LEN) return undefined;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (hosts) {
    const host = url.hostname.toLowerCase();
    if (!hosts.includes(host)) return undefined;
  }
  return url.toString();
}

// ── On-chain Marketing tier verification (JSON-RPC eth_call) ─────────────────

/**
 * True if the pool for `token` was created under a branded tier (Ecosystem or
 * Marketing), verified on-chain: resolve the pool via `factory.poolOf(token)`,
 * then read `pool.tier()`. Fails closed (returns false) if RPC/config is missing
 * or any call fails.
 */
async function verifyBrandedTier(env: Env, token: string): Promise<boolean> {
  const rpc = env.RPC_URL?.trim();
  const factory = env.FACTORY_ADDRESS?.trim();
  if (!rpc || !factory || !/^0x[0-9a-fA-F]{40}$/.test(factory)) return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return false;

  try {
    const pool = await resolvePoolOf(env, rpc, factory, token);
    if (!pool) return false;
    const tier = await resolvePoolTier(env, rpc, pool);
    return tier !== null && tier >= MIN_BRANDED_TIER;
  } catch {
    return false;
  }
}

/**
 * Resolve the pool address for `token` via the factory, or null if there is no
 * pool or RPC/config is unavailable (fail closed). Reuses the cached
 * `resolvePoolOf`.
 */
async function resolvePoolForToken(env: Env, token: string): Promise<string | null> {
  const rpc = env.RPC_URL?.trim();
  const factory = env.FACTORY_ADDRESS?.trim();
  if (!rpc || !factory || !/^0x[0-9a-fA-F]{40}$/.test(factory)) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return null;
  try {
    return await resolvePoolOf(env, rpc, factory, token);
  } catch {
    return null;
  }
}

/**
 * Read the tier for an already-resolved pool address, or null on failure.
 * Reuses the cached `resolvePoolTier`.
 */
async function tierForPool(env: Env, pool: string): Promise<number | null> {
  const rpc = env.RPC_URL?.trim();
  if (!rpc) return null;
  try {
    return await resolvePoolTier(env, rpc, pool);
  } catch {
    return null;
  }
}

/**
 * Resolve `factory.poolOf(token)` -> pool address (lowercased, "0x…"), or null.
 * Cached under `poolof:<token>` with a short TTL. Only a successful, non-zero
 * resolution is cached (fail-closed results are never cached).
 */
async function resolvePoolOf(
  env: Env,
  rpc: string,
  factory: string,
  token: string
): Promise<string | null> {
  const cacheKey = `poolof:${token.toLowerCase()}`;
  const cached = await env.POOL_META.get(cacheKey);
  if (cached !== null) return cached || null;

  // poolOf(address) selector = 0x988b1fa7; arg is the token address, left-padded.
  const data = "0x988b1fa7" + token.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const word = await ethCall(rpc, factory, data);
  if (!word) return null;
  const pool = "0x" + word.slice(-40).toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(pool) || /^0x0{40}$/.test(pool)) return null;

  await env.POOL_META.put(cacheKey, pool, { expirationTtl: POOL_OF_CACHE_TTL_SECONDS });
  return pool;
}

/**
 * Read `pool.tier()` -> tier index, or null. Cached long under `tier:<pool>`
 * (keyed by pool address, whose tier is immutable). Only a real, successful
 * read is cached.
 */
async function resolvePoolTier(env: Env, rpc: string, pool: string): Promise<number | null> {
  const cacheKey = `tier:${pool.toLowerCase()}`;
  const cached = await env.POOL_META.get(cacheKey);
  if (cached !== null) {
    const n = Number(cached);
    return Number.isNaN(n) ? null : n;
  }

  // tier() selector = 0x16f4d022; returns uint8 (right-most byte of the word).
  const word = await ethCall(rpc, pool, "0x16f4d022");
  if (!word) return null;
  const tier = parseInt(word.slice(-2), 16);
  if (Number.isNaN(tier)) return null;

  await env.POOL_META.put(cacheKey, String(tier), {
    expirationTtl: POOL_TIER_CACHE_TTL_SECONDS,
  });
  return tier;
}

/**
 * Minimal JSON-RPC eth_call. Returns the hex result WITHOUT the 0x prefix, or
 * null on error. `data` is the ABI-encoded calldata (with 0x).
 */
async function ethCall(rpc: string, to: string, data: string): Promise<string | null> {
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
  const j = (await res.json().catch(() => null)) as { result?: string; error?: unknown } | null;
  if (!j || typeof j.result !== "string" || j.error) return null;
  const hex = j.result.replace(/^0x/, "");
  return hex.length >= 64 ? hex : null;
}

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  const list = (allowed || "*").split(",").map((s) => s.trim());
  const allowAll = list.includes("*");
  const allowOrigin = allowAll ? "*" : list.includes(origin) ? origin : list[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  data: unknown,
  cors: Record<string, string>,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", ...extraHeaders },
  });
}
