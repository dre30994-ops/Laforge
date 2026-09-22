import { getAddress, isAddress } from "viem";

export const REFERRAL_STORAGE_KEY = "laforge.ref";

export function captureReferralFromSearch(search = ""): string | null {
  if (typeof window === "undefined") return null;
  const raw = search || window.location.search;
  const value = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw).get("ref");
  if (!value || !isAddress(value)) return readStoredReferral();
  const addr = getAddress(value);
  try {
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, addr);
  } catch {
    /* ignore */
  }
  return addr;
}

export function readStoredReferral(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (raw && isAddress(raw)) return getAddress(raw);
  } catch {
    /* ignore */
  }
  return null;
}

export function referralForLauncher(launcher?: string | null): string | null {
  const stored = readStoredReferral();
  if (!stored) return null;
  if (launcher && isAddress(launcher) && getAddress(launcher) === stored) return null;
  return stored;
}

export function referralShareUrl(origin: string, address: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/?ref=${getAddress(address)}`;
}
