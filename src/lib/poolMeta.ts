import { publicEnv } from "@/lib/publicEnv";
import { sanitizeImageSrc, sanitizeSocials } from "@/lib/sanitize";
import { getMockMeta } from "@/lib/mockPools";
// Shared, off-chain, display-only metadata for staking pools (a nickname and
// an image), keyed by the pool's token address (one pool per token).
//
// The StakingFactory contract has no field for a nickname/image, so this data
// lives in a small Cloudflare Worker (KV + R2) — see cloudflare/pool-meta-worker.
// That makes the metadata visible to *everyone*, not just the browser that
// created the pool.
//
// localStorage is kept as an offline cache + fallback:
//   - Reads return the cached value immediately and refresh from the backend.
//   - Writes always update the cache, even if the backend call fails, so the
//     creating user never loses their input.
//
// If NEXT_PUBLIC_POOL_META_API is unset, the module degrades gracefully to
// localStorage-only (per-browser) behaviour.
//
// Addresses are normalized to lowercase so lookups are case-insensitive.
// Images, banners, and social links are sanitized on every read and write.

const STORAGE_KEY = "forge.poolMeta.v1";

/** Backend base URL (Cloudflare Worker). Empty string = localStorage-only. */
const API_BASE = (publicEnv("POOL_META_API") ?? "").replace(/\/$/, "");

/** Max accepted image file size (raw bytes). */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB

/** Minimum accepted image resolution (both dimensions), in pixels. */
export const MIN_IMAGE_DIMENSION = 400;

/**
 * Allowed raster image content types. SVG is deliberately excluded: it is an
 * XML document that can carry scripts/event handlers and, if ever served as a
 * top-level document, enables stored XSS. Only bitmap formats are accepted.
 */
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type PoolMeta = {
  /** Human-friendly display name for the pool. */
  nickname?: string;
  /** Image URL (backend) or data URL (offline fallback). */
  image?: string;
  /** Pricing tier index (0=Bronze, 1=Ecosystem, 2=Marketing). Display-only. */
  tier?: number;
  /** Banner image URL/data URL (Ecosystem + Marketing only). */
  banner?: string;
  /** Social links (Ecosystem + Marketing only). */
  socials?: {
    website?: string;
    twitter?: string;
    telegram?: string;
    discord?: string;
  };
  /** Marketing tier perks (display-only, enforced by the app). */
  marketing?: {
    /** Show a "verified safe" lock badge. */
    verifiedBadge?: boolean;
    /** Unix seconds until which the pool appears on the trending list. */
    trendingUntil?: number;
  };
};

type MetaMap = Record<string, PoolMeta>;

/** True when a shared backend is configured. */
export function hasBackend(): boolean {
  return !!API_BASE;
}

function normalize(tokenAddress: string): string {
  return tokenAddress.trim().toLowerCase();
}

/** Resolve display meta for a pool using token or pool address. */
export function metaForPool(
  map: MetaMap,
  token?: string | null,
  pool?: string | null,
): PoolMeta | null {
  if (token) {
    const hit = map[normalize(token)];
    if (hit) return hit;
  }
  if (pool) {
    const hit = map[normalize(pool)];
    if (hit) return hit;
  }
  return null;
}

/** Drop javascript:/data: tricks and keep only http(s) + raster images. */
export function sanitizePoolMeta(meta: PoolMeta | null | undefined): PoolMeta | null {
  if (!meta) return null;
  const nickname = meta.nickname?.trim().slice(0, 80) || undefined;
  const image = sanitizeImageSrc(meta.image);
  const banner = sanitizeImageSrc(meta.banner);
  const socials = sanitizeSocials(meta.socials);
  const out: PoolMeta = {};
  if (nickname) out.nickname = nickname;
  if (image) out.image = image;
  if (banner) out.banner = banner;
  if (socials) out.socials = socials;
  if (typeof meta.tier === "number" && meta.tier >= 0 && meta.tier <= 2) out.tier = meta.tier;
  if (meta.marketing) {
    const cleaned: NonNullable<PoolMeta["marketing"]> = {};
    if (meta.marketing.verifiedBadge) cleaned.verifiedBadge = true;
    if (
      typeof meta.marketing.trendingUntil === "number" &&
      Number.isFinite(meta.marketing.trendingUntil)
    ) {
      cleaned.trendingUntil = meta.marketing.trendingUntil;
    }
    if (cleaned.verifiedBadge || cleaned.trendingUntil) out.marketing = cleaned;
  }
  if (
    !out.nickname &&
    !out.image &&
    typeof out.tier !== "number" &&
    !out.banner &&
    !out.socials &&
    !out.marketing
  ) {
    return null;
  }
  return out;
}

function sanitizeMap(map: MetaMap): MetaMap {
  const out: MetaMap = {};
  for (const [token, meta] of Object.entries(map)) {
    const cleaned = sanitizePoolMeta(meta);
    if (cleaned) out[token] = cleaned;
  }
  return out;
}

// ── localStorage cache ───────────────────────────────────────────────────────

function readCache(): MetaMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MetaMap;
    return parsed && typeof parsed === "object" ? sanitizeMap(parsed) : {};
  } catch {
    return {};
  }
}

function writeCache(map: MetaMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeMap(map)));
  } catch {
    // Quota exceeded or unavailable — metadata is cosmetic, so fail silently.
  }
}

function cacheGet(token: string): PoolMeta | null {
  return readCache()[token] ?? null;
}

function slimForLocal(meta: PoolMeta): PoolMeta {
  const out: PoolMeta = { ...meta };
  if (out.image && out.image.startsWith("data:") && out.image.length > 400_000) {
    delete out.image;
  }
  if (out.banner && out.banner.startsWith("data:") && out.banner.length > 400_000) {
    delete out.banner;
  }
  return out;
}

function cacheSet(token: string, meta: PoolMeta | null): void {
  const map = readCache();
  const cleaned = sanitizePoolMeta(meta);
  if (!cleaned) {
    delete map[token];
    writeCache(map);
    void idbPut(token, null);
    return;
  }
  map[token] = slimForLocal(cleaned);
  writeCache(map);
  void idbPut(token, cleaned);
}

function cacheMerge(entries: MetaMap): void {
  const map = readCache();
  for (const [token, meta] of Object.entries(entries)) {
    const cleaned = sanitizePoolMeta(meta);
    if (!cleaned) continue;
    map[token] = slimForLocal({ ...map[token], ...cleaned });
    void idbPut(token, { ...map[token], ...cleaned });
  }
  writeCache(map);
}

// IndexedDB keeps large banners/images that can exceed localStorage quota.
const IDB_NAME = "forge-pool-meta";
const IDB_STORE = "meta";

function openMetaDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(token: string, meta: PoolMeta | null): Promise<void> {
  const db = await openMetaDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      if (!meta) store.delete(token);
      else store.put(meta, token);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbGetAll(): Promise<MetaMap> {
  const db = await openMetaDb();
  if (!db) return {};
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).openCursor();
      const out: MetaMap = {};
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(sanitizeMap(out));
          return;
        }
        const key = String(cursor.key);
        const cleaned = sanitizePoolMeta(cursor.value as PoolMeta);
        if (cleaned) out[key] = cleaned;
        cursor.continue();
      };
      req.onerror = () => resolve({});
    } catch {
      resolve({});
    }
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up display metadata for a pool by its token address. Returns the cached
 * value immediately when the backend is unreachable; otherwise returns the
 * backend value (and refreshes the cache).
 */
export async function getPoolMeta(tokenAddress: string): Promise<PoolMeta | null> {
  if (!tokenAddress) return null;
  const token = normalize(tokenAddress);
  const idb = await idbGetAll();
  const cached = cacheGet(token);
  const mock = getMockMeta(token);
  const local = sanitizePoolMeta({
    ...mock,
    ...cached,
    ...idb[token],
    nickname: idb[token]?.nickname || cached?.nickname || mock?.nickname,
    image: idb[token]?.image || cached?.image || mock?.image,
    banner: idb[token]?.banner || cached?.banner || mock?.banner,
    socials: idb[token]?.socials ?? cached?.socials ?? mock?.socials,
    marketing: idb[token]?.marketing ?? cached?.marketing ?? mock?.marketing,
    tier: typeof idb[token]?.tier === "number" ? idb[token]?.tier : (typeof cached?.tier === "number" ? cached.tier : mock?.tier),
  });

  if (!API_BASE) return local;

  try {
    const res = await fetch(`${API_BASE}/pools/${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) {
      return local;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remote = sanitizePoolMeta((await res.json()) as PoolMeta);
    const merged = sanitizePoolMeta({
      ...local,
      ...remote,
      nickname: remote?.nickname || local?.nickname,
      image: remote?.image || local?.image,
      banner: remote?.banner || local?.banner,
      socials: remote?.socials ?? local?.socials,
      tier: typeof remote?.tier === "number" ? remote.tier : local?.tier,
      marketing: remote?.marketing ?? local?.marketing,
    });
    cacheSet(token, merged);
    return merged;
  } catch {
    return local;
  }
}

/**
 * Fetch metadata for all pools in one request (used by the pool directory).
 * Falls back to the entire local cache when the backend is unreachable.
 */
export async function getAllPoolMeta(): Promise<MetaMap> {
  const local = readCache();
  const idb = await idbGetAll();
  const base: MetaMap = { ...local };
  for (const [token, meta] of Object.entries(idb)) {
    base[token] = sanitizePoolMeta({
      ...local[token],
      ...meta,
      nickname: meta.nickname || local[token]?.nickname,
      image: meta.image || local[token]?.image,
      banner: meta.banner || local[token]?.banner,
      socials: meta.socials ?? local[token]?.socials,
      marketing: meta.marketing ?? local[token]?.marketing,
      tier: typeof meta.tier === "number" ? meta.tier : local[token]?.tier,
    }) ?? meta;
  }
  if (!API_BASE) return base;

  try {
    const res = await fetch(`${API_BASE}/pools`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const map = sanitizeMap((await res.json()) as MetaMap);
    const merged: MetaMap = { ...base };
    for (const [token, meta] of Object.entries(map)) {
      const prev = base[token];
      const combined = sanitizePoolMeta({
        ...prev,
        ...meta,
        nickname: meta.nickname || prev?.nickname,
        image: meta.image || prev?.image,
        banner: meta.banner || prev?.banner,
        socials: meta.socials ?? prev?.socials,
        tier: typeof meta.tier === "number" ? meta.tier : prev?.tier,
        marketing: meta.marketing ?? prev?.marketing,
      });
      if (combined) merged[token] = combined;
    }
    cacheMerge(merged);
    return merged;
  } catch {
    return base;
  }
}

/**
 * Persist display metadata for a pool by its token address. Writes to the
 * shared backend when configured (uploading the image), and always updates the
 * local cache so the creating user never loses their input.
 *
 * `meta.image` may be a data URL (from `fileToDataUrl`) — it is uploaded and
 * replaced by a hosted URL in the returned/cached record.
 *
 * Banner + socials are always sent so Ecosystem/Marketing pools render them
 * everywhere. The worker re-validates type by sniffing bytes and gates branded
 * fields by on-chain tier.
 */
export async function setPoolMeta(
  tokenAddress: string,
  meta: PoolMeta,
  opts?: { chainId?: number; factory?: string; pool?: string },
): Promise<PoolMeta> {
  if (!tokenAddress) throw new Error("Missing token address.");
  const token = normalize(tokenAddress);

  const local = sanitizePoolMeta({
    nickname: meta.nickname,
    image: meta.image,
    tier: meta.tier,
    banner: meta.banner,
    socials: meta.socials,
    marketing: meta.marketing,
  }) ?? {};

  cacheSet(token, local);

  if (!API_BASE) return local;

  const body: {
    nickname?: string;
    imageBase64?: string;
    imageContentType?: string;
    bannerBase64?: string;
    bannerContentType?: string;
    socials?: NonNullable<PoolMeta["socials"]>;
    tier?: number;
    marketing?: PoolMeta["marketing"];
    chainId?: number;
    factory?: string;
    pool?: string;
  } = {};
  if (local.nickname) body.nickname = local.nickname;
  if (local.image?.startsWith("data:")) {
    body.imageBase64 = local.image;
    const ct = contentTypeFromDataUrl(local.image);
    if (ct) body.imageContentType = ct;
  }
  if (typeof local.tier === "number") body.tier = local.tier;
  if (local.banner?.startsWith("data:")) {
    body.bannerBase64 = local.banner;
    const ct = contentTypeFromDataUrl(local.banner);
    if (ct) body.bannerContentType = ct;
  }
  if (local.socials) body.socials = local.socials;
  if (local.marketing) body.marketing = local.marketing;
  if (opts?.chainId) body.chainId = opts.chainId;
  if (opts?.factory) body.factory = opts.factory;
  if (opts?.pool) body.pool = opts.pool;

  try {
    const res = await fetch(`${API_BASE}/pools/${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stored = sanitizePoolMeta((await res.json()) as PoolMeta) ?? {};
    const merged: PoolMeta = {
      ...local,
      ...stored,
      nickname: stored.nickname || local.nickname,
      image: stored.image || local.image,
      banner: stored.banner || local.banner,
      socials: stored.socials ?? local.socials,
      tier: typeof stored.tier === "number" ? stored.tier : local.tier,
      marketing: stored.marketing ?? local.marketing,
    };
    cacheSet(token, merged);
    return merged;
  } catch {
    return local;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function contentTypeFromDataUrl(input: string): string | null {
  const m = input.match(/^data:([^;]+);base64,/);
  return m ? m[1] : null;
}

/**
 * Read a File as a base64 data URL, rejecting non-images, oversized files, or
 * images below the minimum resolution. Used by the create-pool form to preview
 * the image and as the upload payload.
 *
 * Enforced limits:
 *   - Type: must be one of ALLOWED_IMAGE_TYPES (raster only; SVG rejected).
 *   - Size: raw file <= MAX_IMAGE_BYTES (15 MB).
 *   - Resolution: both dimensions >= MIN_IMAGE_DIMENSION (400 px).
 *
 * Note: this is a client-side UX gate only. The backend independently
 * re-validates the type by sniffing the actual bytes (the browser is untrusted).
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      reject(
        new Error(
          `Unsupported image type. Allowed: PNG, JPEG, WebP, GIF (SVG is not allowed).`
        )
      );
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(
        new Error(
          `Image is too large (max ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB). Try a smaller image.`
        )
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("Could not read the image file."));
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (
          img.naturalWidth < MIN_IMAGE_DIMENSION ||
          img.naturalHeight < MIN_IMAGE_DIMENSION
        ) {
          reject(
            new Error(
              `Image resolution is too low (min ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}px). ` +
                `This image is ${img.naturalWidth}x${img.naturalHeight}px.`
            )
          );
          return;
        }
        const safe = sanitizeImageSrc(result);
        if (!safe) {
          reject(new Error("Image failed sanitization."));
          return;
        }
        resolve(safe);
      };
      img.onerror = () => reject(new Error("Could not read the image file."));
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}
