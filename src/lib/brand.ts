import { isAddress } from "viem";
import { publicEnv } from "@/lib/publicEnv";
import {
  EVM_NETWORKS,
  EVM_VISIBLE_NETWORKS,
  explorerAddressUrl,
  networkByChainId,
  type EvmNetwork,
} from "@/lib/evmNetworks";

/** Official project X account. */
export const X_HANDLE = "Laforge_World";
export const X_URL = publicEnv("X_URL") || `https://x.com/${X_HANDLE}`;

/**
 * Project token contract. Override with VITE_TOKEN_CA / NEXT_PUBLIC_TOKEN_CA.
 * Leave empty to hide the CA row until the token is live.
 */
export const TOKEN_SYMBOL = publicEnv("TOKEN_SYMBOL") || "LAFORGE";
export const TOKEN_CA = (publicEnv("TOKEN_CA") || "").trim();
export const TOKEN_CHAIN_ID = Number(publicEnv("TOKEN_CHAIN_ID") || "4663");

export type OfficialContract = {
  chain: string;
  role: "Factory" | "Marketing desk";
  address: string;
  href: string;
};

export function tokenNetwork(): EvmNetwork | undefined {
  return networkByChainId(TOKEN_CHAIN_ID) ?? EVM_NETWORKS.robinhood;
}

export function tokenExplorerUrl(): string | null {
  if (!hasTokenCa()) return null;
  const net = tokenNetwork();
  if (!net) return null;
  return explorerAddressUrl(net, TOKEN_CA);
}

export function hasTokenCa(): boolean {
  return isAddress(TOKEN_CA);
}

/** Verified protocol contracts shown on the dashboard — visible chains only. */
export function officialContracts(): OfficialContract[] {
  const rows: OfficialContract[] = [];
  for (const key of EVM_VISIBLE_NETWORKS) {
    const n = EVM_NETWORKS[key];
    if (n.factory) {
      rows.push({
        chain: n.short,
        role: "Factory",
        address: n.factory,
        href: explorerAddressUrl(n, n.factory),
      });
    }
    if (n.desk) {
      rows.push({
        chain: n.short,
        role: "Marketing desk",
        address: n.desk,
        href: explorerAddressUrl(n, n.desk),
      });
    }
  }
  return rows;
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
