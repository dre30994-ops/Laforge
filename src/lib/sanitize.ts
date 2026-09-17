/**
 * URL / image sanitizers for pool metadata (socials, banners, images).
 * Rejects javascript:, data: (except raster images), and credentialed URLs.
 */

const RASTER_DATA = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/]+=*$/i;
const SAME_ORIGIN_IMAGE = /^\/(?!\/)[a-z0-9._/~-]+\.(png|jpe?g|webp|gif)$/i;
/** ~15 MB raw file as a base64 data URL, plus header slack. */
const MAX_IMAGE_CHARS = 24_000_000;

export function sanitizeHttpUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function sanitizeImageSrc(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || value.length > MAX_IMAGE_CHARS) return undefined;
  if (value.startsWith("data:")) {
    const compact = value.replace(/\s+/g, "");
    return RASTER_DATA.test(compact) ? compact : undefined;
  }
  if (SAME_ORIGIN_IMAGE.test(value) && !value.includes("..")) {
    return value;
  }
  return sanitizeHttpUrl(value);
}

export function sanitizeSocials(socials: {
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
} | undefined): { website?: string; twitter?: string; telegram?: string; discord?: string } | undefined {
  if (!socials) return undefined;
  const cleaned = {
    website: sanitizeHttpUrl(socials.website),
    twitter: allowHosts(sanitizeHttpUrl(socials.twitter), ["x.com", "twitter.com"]),
    telegram: allowHosts(sanitizeHttpUrl(socials.telegram), ["t.me", "telegram.me", "telegram.org"]),
    discord: allowHosts(sanitizeHttpUrl(socials.discord), ["discord.gg", "discord.com"]),
  };
  if (cleaned.website || cleaned.twitter || cleaned.telegram || cleaned.discord) return cleaned;
  return undefined;
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
