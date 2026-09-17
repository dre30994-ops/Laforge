import { publicEnv } from "@/lib/publicEnv";
import { type Chain } from "viem";
import { mainnet, base, bsc } from "viem/chains";
import { hyperEvm, robinhoodMainnet } from "@/lib/chains";

/** Keys for the EVM networks the terminal actually launches pools on. */
export type EvmNetworkKey = "robinhood" | "ethereum" | "base" | "bsc" | "hyperevm";

export type EvmNetwork = {
  key: EvmNetworkKey;
  label: string;
  short: string;
  chain: Chain;
  factory: string;
  /** Sidecar that accepts the marketing fee at any time. Empty until deployed. */
  desk: string;
  explorer: string;
  nativeSymbol: string;
  /** Launch fees in wei, bronze / ecosystem / marketing. */
  fees: { bronze: bigint; ecosystem: bigint; marketing: bigint };
  /** Short hint shown under the token address field. */
  addressHint: string;
};

function factoryEnv(name: string, fallback: string): string {
  return publicEnv(name) || fallback;
}

function deskEnv(name: string, fallback = ""): string {
  return publicEnv(name) || fallback;
}

/** Same CREATE address the deployer hit on ETH / Base / BSC / HyperEVM. */
const SHARED_FACTORY = "0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f";
/** Patched factory on Robinhood Chain. */
const ROBINHOOD_FACTORY = "0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691";
/** Live Marketing desks (community boost sidecar). */
const ROBINHOOD_DESK = "0x5a0eA0fA6813D21c257bE07915a1306BdeA3037A";
/** Same CREATE address on Ethereum, Base, and HyperEVM. */
const SHARED_DESK = "0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691";

const ETH_FEES = {
  bronze: 10_000_000_000_000_000n,
  ecosystem: 30_000_000_000_000_000n,
  marketing: 60_000_000_000_000_000n,
};

export const EVM_NETWORKS: Record<EvmNetworkKey, EvmNetwork> = {
  robinhood: {
    key: "robinhood",
    label: "Robinhood Chain",
    short: "Robinhood",
    chain: robinhoodMainnet,
    factory: factoryEnv("STAKING_FACTORY_ROBINHOOD", publicEnv("STAKING_FACTORY") || ROBINHOOD_FACTORY),
    desk: deskEnv("MARKETING_DESK_ROBINHOOD", ROBINHOOD_DESK),
    explorer: "https://robinhoodchain.blockscout.com",
    nativeSymbol: "ETH",
    fees: ETH_FEES,
    addressHint: "0x + 40 hex characters (Robinhood / EVM).",
  },
  ethereum: {
    key: "ethereum",
    label: "Ethereum",
    short: "Ethereum",
    chain: mainnet,
    factory: factoryEnv("STAKING_FACTORY_ETHEREUM", SHARED_FACTORY),
    desk: deskEnv("MARKETING_DESK_ETHEREUM", SHARED_DESK),
    explorer: "https://etherscan.io",
    nativeSymbol: "ETH",
    fees: ETH_FEES,
    addressHint: "0x + 40 hex characters (Ethereum mainnet).",
  },
  hyperevm: {
    key: "hyperevm",
    label: "Hyperliquid",
    short: "HyperEVM",
    chain: hyperEvm,
    factory: factoryEnv("STAKING_FACTORY_HYPEREVM", SHARED_FACTORY),
    desk: deskEnv("MARKETING_DESK_HYPEREVM", SHARED_DESK),
    explorer: "https://hyperevmscan.io",
    nativeSymbol: "HYPE",
    fees: {
      bronze: 310_000_000_000_000_000n,
      ecosystem: 920_000_000_000_000_000n,
      marketing: 1_850_000_000_000_000_000n,
    },
    addressHint: "0x + 40 hex characters (HyperEVM / Hyperliquid).",
  },
  base: {
    key: "base",
    label: "Base",
    short: "Base",
    chain: base,
    factory: factoryEnv("STAKING_FACTORY_BASE", SHARED_FACTORY),
    desk: deskEnv("MARKETING_DESK_BASE", SHARED_DESK),
    explorer: "https://basescan.org",
    nativeSymbol: "ETH",
    fees: ETH_FEES,
    addressHint: "0x + 40 hex characters (Base).",
  },
  bsc: {
    key: "bsc",
    label: "BNB Smart Chain",
    short: "BNB Chain",
    chain: bsc,
    factory: factoryEnv("STAKING_FACTORY_BSC", SHARED_FACTORY),
    desk: deskEnv("MARKETING_DESK_BSC", SHARED_DESK),
    explorer: "https://bscscan.com",
    nativeSymbol: "BNB",
    fees: {
      bronze: 35_000_000_000_000_000n,
      ecosystem: 100_000_000_000_000_000n,
      marketing: 200_000_000_000_000_000n,
    },
    addressHint: "0x + 40 hex characters (BNB Smart Chain).",
  },
};

/** Display order of every launch chain (full catalog — keep styling/config here). */
export const EVM_NETWORK_CATALOG: EvmNetworkKey[] = [
  "robinhood",
  "ethereum",
  "hyperevm",
  "base",
  "bsc",
];

/**
 * Chains shown in the switcher / create picker right now.
 * Hidden chains stay fully wired (factories, fees, glyphs) so they can be
 * re-enabled one at a time without restyling.
 */
export const EVM_VISIBLE_NETWORKS: EvmNetworkKey[] = ["robinhood", "ethereum"];

/** @deprecated use EVM_NETWORK_CATALOG — kept so listPools still fans out every factory. */
export const EVM_NETWORK_ORDER: EvmNetworkKey[] = EVM_NETWORK_CATALOG;

export const SHOW_SOLANA_IN_SWITCHER = false;

export const PRIMARY_NETWORK: EvmNetworkKey = "robinhood";

export function networkByChainId(chainId: number | undefined): EvmNetwork | undefined {
  if (!chainId) return undefined;
  return EVM_NETWORK_ORDER.map((k) => EVM_NETWORKS[k]).find((n) => n.chain.id === chainId);
}

export function networkByKey(key: string | undefined): EvmNetwork | undefined {
  if (!key) return undefined;
  return EVM_NETWORKS[key as EvmNetworkKey];
}

export function explorerAddressUrl(network: EvmNetwork, address: string): string {
  return `${network.explorer.replace(/\/$/, "")}/address/${address}`;
}

export function explorerTxUrl(network: EvmNetwork, hash: string): string {
  return `${network.explorer.replace(/\/$/, "")}/tx/${hash}`;
}
