"use client";

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

const STORAGE_KEY = "forge.poolMeta.v1";

/** Backend base URL (Cloudflare Worker). Empty string = localStorage-only. */
const API_BASE = (process.env.NEXT_PUBLIC_POOL_META_API ?? "").replace(/\/$/, "");

/** Max accepted image file size (raw bytes). */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB

/** Minimum accepted image resolution (both dimensions), in pixels. */
export const MIN_IMAGE_DIMENSION = 1000; // 1000 x 1000 px

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

// ── localStorage cache ───────────────────────────────────────────────────────

function readCache(): MetaMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MetaMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // localStorage may be unavailable (private mode / SSR guards) — ignore.
    return {};
  }
}

function writeCache(map: MetaMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded or unavailable — metadata is cosmetic, so fail silently.
  }
}

function cacheGet(token: string): PoolMeta | null {
  return readCache()[token] ?? null;
}

function cacheSet(token: string, meta: PoolMeta | null): void {
  const map = readCache();
  const isEmpty =
    !meta ||
    (!meta.nickname &&
      !meta.image &&
      typeof meta.tier !== "number" &&
      !meta.banner &&
      !meta.socials &&
      !meta.marketing);
  if (isEmpty) {
    delete map[token];
  } else {
    map[token] = meta;
  }
  writeCache(map);
}

function cacheMerge(entries: MetaMap): void {
  const map = readCache();
  for (const [token, meta] of Object.entries(entries)) {
    if (
      meta &&
      (meta.nickname ||
        meta.image ||
        typeof meta.tier === "number" ||
        meta.banner ||
        meta.socials ||
        meta.marketing)
    ) {
      map[token] = meta;
    }
  }
  writeCache(map);
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

  if (!API_BASE) return cacheGet(token);

  try {
    const res = await fetch(`${API_BASE}/pools/${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) {
      cacheSet(token, null);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta = (await res.json()) as PoolMeta;
    cacheSet(token, meta);
    return meta;
  } catch {
    // Backend unreachable — fall back to the cache.
    return cacheGet(token);
  }
}

/**
 * Fetch metadata for all pools in one request (used by the pool directory).
 * Falls back to the entire local cache when the backend is unreachable.
 */
export async function getAllPoolMeta(): Promise<MetaMap> {
  if (!API_BASE) return readCache();

  try {
    const res = await fetch(`${API_BASE}/pools`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const map = (await res.json()) as MetaMap;
    cacheMerge(map);
    return map;
  } catch {
    return readCache();
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
 * Returns the stored record (with a hosted image URL when the backend is used),
 * or throws only if there is truly nothing to store.
 */
export async function setPoolMeta(
  tokenAddress: string,
  meta: PoolMeta
): Promise<PoolMeta> {
  if (!tokenAddress) throw new Error("Missing token address.");
  const token = normalize(tokenAddress);

  const nickname = meta.nickname?.trim() || undefined;
  // Image/banner: accept only safe raster data URLs or https-hosted images.
  // Anything else (SVG, javascript:, data:text/html, http:) is dropped — it can
  // never reach the cache, the backend, or an <img>/<a> in the UI.
  const image = sanitizeImageRef(meta.image);
  const local: PoolMeta = {};
  if (nickname) local.nickname = nickname;
  if (image) local.image = image;
  // Extra tiered metadata (currently persisted to the local cache; the shared
  // backend stores nickname/image only). These drive the tier badge/banner and
  // social links in the pool directory.
  if (typeof meta.tier === "number") local.tier = meta.tier;
  const banner = sanitizeImageRef(meta.banner);
  if (banner) local.banner = banner;
  if (meta.socials) {
    // Strict client-side sanitize (https + host allowlist), mirroring the
    // Worker. Neutralizes javascript:/data: and other XSS schemes before the
    // value is ever cached or rendered.
    const cleaned = sanitizeSocials(meta.socials);
    if (cleaned) local.socials = cleaned;
  }
  if (meta.marketing) {
    const m = meta.marketing;
    const cleaned: NonNullable<PoolMeta["marketing"]> = {};
    if (m.verifiedBadge) cleaned.verifiedBadge = true;
    if (typeof m.trendingUntil === "number") cleaned.trendingUntil = m.trendingUntil;
    if (cleaned.verifiedBadge || cleaned.trendingUntil) local.marketing = cleaned;
  }

  // Always update the cache first (offline-safe).
  cacheSet(token, local);

  if (!API_BASE) return local;

  // Send to the backend. Images (which may be data URLs) are uploaded as
  // base64 payloads; the backend returns hosted image URLs. The banner and
  // socials are only *persisted* server-side for pools the backend verifies as
  // Marketing tier (it re-checks on-chain), but we always send them — the
  // backend decides. `tier` is a display hint.
  const body: {
    nickname?: string;
    imageBase64?: string;
    imageContentType?: string;
    bannerBase64?: string;
    bannerContentType?: string;
    socials?: NonNullable<PoolMeta["socials"]>;
    tier?: number;
    marketing?: NonNullable<PoolMeta["marketing"]>;
  } = {};
  if (nickname) body.nickname = nickname;
  // Only upload NEW images, i.e. data URLs. A hosted "https://…" URL means the
  // image is already stored on the backend — re-sending it as a base64 upload
  // would make the Worker try to atob() a URL and reject the whole write (400).
  // Omitting it tells the Worker to keep the previously stored image.
  if (image && isDataUrl(image)) {
    body.imageBase64 = image;
    const ct = contentTypeFromDataUrl(image);
    if (ct) body.imageContentType = ct;
  }
  if (typeof local.tier === "number") body.tier = local.tier;
  if (local.banner && isDataUrl(local.banner)) {
    body.bannerBase64 = local.banner;
    const ct = contentTypeFromDataUrl(local.banner);
    if (ct) body.bannerContentType = ct;
  }
  if (local.socials) body.socials = local.socials;
  // The backend now persists the marketing perks too (verified badge +
  // trending window), gated + time-clamped server-side. Send them; the backend
  // decides what to honor.
  if (local.marketing) body.marketing = local.marketing;

  try {
    const res = await fetch(`${API_BASE}/pools/${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stored = (await res.json()) as PoolMeta;
    // The backend is the source of truth for gated fields (banner/socials and
    // now marketing, which it verifies on-chain and time-clamps). Use exactly
    // what it returns; cache it for offline reads.
    cacheSet(token, stored);
    return stored;
  } catch {
    // Backend failed — keep the local cache copy so the UI still shows it.
    return local;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function contentTypeFromDataUrl(input: string): string | null {
  const m = input.match(/^data:([^;]+);base64,/);
  return m ? m[1] : null;
}

/** True when the string is an inline data URL (a new upload payload). */
function isDataUrl(input: string): boolean {
  return /^data:/i.test(input.trim());
}

// ── Client-side XSS sanitizers (mirror the Worker's server-side gates) ────────
//
// The Worker independently validates socials (https + host allowlist) and image
// bytes (magic-byte sniff, SVG rejected). These client-side mirrors are
// defense-in-depth: they stop a malicious value from ever being cached locally
// or rendered from the offline cache (which is served BEFORE/without the backend
// on the create form and detail pages). Never trust a URL/data-URL that hasn't
// passed one of these.

/** Max length for a single social URL (mirrors the Worker). */
const MAX_SOCIAL_URL_LEN = 200;

/** Allowed hosts per social field. `website` is free-form (any https host). */
const SOCIAL_HOST_ALLOWLIST: Record<
  keyof NonNullable<PoolMeta["socials"]>,
  string[] | null
> = {
  website: null,
  twitter: ["x.com", "twitter.com", "www.x.com", "www.twitter.com"],
  telegram: ["t.me", "telegram.me", "www.t.me"],
  discord: ["discord.gg", "discord.com", "www.discord.com"],
};

/**
 * Return a safe, normalized https URL, or undefined if the input is unsafe.
 *
 * Rejects anything that isn't an https URL — this is what neutralizes
 * `javascript:`, `data:`, `vbscript:`, `file:`, and plain `http:` (downgrade)
 * schemes that would otherwise be XSS/clickjacking vectors when rendered into an
 * <a href>. Optionally enforces a hostname allowlist.
 */
export function sanitizeSocialUrl(
  value: string | undefined,
  field: keyof NonNullable<PoolMeta["socials"]>
): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v.length > MAX_SOCIAL_URL_LEN) return undefined;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return undefined;
  }
  // Only https. This is the core XSS guard: no javascript:/data:/http: etc.
  if (url.protocol !== "https:") return undefined;
  const hosts = SOCIAL_HOST_ALLOWLIST[field];
  if (hosts && !hosts.includes(url.hostname.toLowerCase())) return undefined;
  return url.toString();
}

/**
 * Sanitize a whole socials object, dropping any field whose URL is unsafe or
 * disallowed. Returns only the fields that passed (or undefined if none did).
 */
export function sanitizeSocials(
  input: PoolMeta["socials"]
): PoolMeta["socials"] | undefined {
  if (!input) return undefined;
  const out: NonNullable<PoolMeta["socials"]> = {};
  const website = sanitizeSocialUrl(input.website, "website");
  if (website) out.website = website;
  const twitter = sanitizeSocialUrl(input.twitter, "twitter");
  if (twitter) out.twitter = twitter;
  const telegram = sanitizeSocialUrl(input.telegram, "telegram");
  if (telegram) out.telegram = telegram;
  const discord = sanitizeSocialUrl(input.discord, "discord");
  if (discord) out.discord = discord;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Return the string only if it is a safe raster-image reference: either a
 * `data:image/<raster>;base64,` URL (produced by fileToDataUrl) or an https URL
 * (a hosted image from the backend). Rejects SVG data URLs (scriptable) and any
 * non-image / non-https scheme. Undefined otherwise.
 */
export function sanitizeImageRef(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v) return undefined;
  // Hosted image: must be https (never javascript:/data:text/html/etc.).
  if (/^https:\/\//i.test(v)) return v;
  // Inline upload: only raster image data URLs. SVG is explicitly excluded
  // because it is a scriptable XML document (stored-XSS vector).
  const m = v.match(/^data:(image\/(png|jpeg|jpg|gif|webp));base64,/i);
  if (m) return v;
  return undefined;
}

/**
 * Read a File as a base64 data URL, rejecting non-images, oversized files, or
 * images below the minimum resolution. Used by the create-pool form to preview
 * the image and as the upload payload.
 *
 * Enforced limits:
 *   - Type: must be one of ALLOWED_IMAGE_TYPES (raster only; SVG rejected).
 *   - Size: raw file <= MAX_IMAGE_BYTES (15 MB).
 *   - Resolution: both dimensions >= MIN_IMAGE_DIMENSION (1000 px).
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
      // Verify resolution by decoding the image before accepting it.
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
        resolve(result);
      };
      img.onerror = () => reject(new Error("Could not read the image file."));
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}
