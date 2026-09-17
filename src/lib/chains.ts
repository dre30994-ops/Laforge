import { publicEnv } from "@/lib/publicEnv";
import { defineChain } from "viem";

/**
 * Robinhood Chain — an Arbitrum Orbit EVM L2 (native gas token: ETH).
 *
 * Robinhood Chain is not in `viem/chains`, so we build the chain objects with
 * `defineChain`. These are consumed by the wagmi config (EVM_CHAINS /
 * wagmiConfig below) and the viem clients in `factoryClient.ts`.
 *
 * Network facts (from https://docs.robinhood.com/chain/connecting/):
 *   mainnet  chainId 4663   rpc https://rpc.mainnet.chain.robinhood.com
 *   testnet  chainId 46630  rpc https://rpc.testnet.chain.robinhood.com
 */

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  rpcUrls: {
    default: {
      http: [
        publicEnv("ROBINHOOD_RPC_URL") ||
          "https://rpc.testnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  rpcUrls: {
    default: {
      http: [
        publicEnv("ROBINHOOD_RPC_URL") ||
          "https://rpc.mainnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});

/**
 * The active Robinhood Chain used across the app. Testnet-first per project
 * decision; set NEXT_PUBLIC_ROBINHOOD_MAINNET=1 to switch to mainnet later.
 */
export const robinhoodChain =
  publicEnv("ROBINHOOD_MAINNET") === "1"
    ? robinhoodMainnet
    : robinhoodTestnet;

/** Convenience: the block-explorer base URL for the active chain. */
export const robinhoodExplorerUrl =
  robinhoodChain.blockExplorers?.default.url ??
  "https://explorer.testnet.chain.robinhood.com";

export const hyperEvm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: {
      http: [publicEnv("HYPEREVM_RPC_URL") || "https://rpc.hyperliquid.xyz/evm"],
    },
  },
  blockExplorers: {
    default: { name: "HyperEVMScan", url: "https://hyperevmscan.io" },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// wagmi config — all supported EVM chains for the connect/stake flows.
//
// The connect button connects a wallet; this config declares which chains that
// wallet may operate on. Robinhood Chain is custom (defineChain above); the rest
// come from viem/chains. Add a chain here (+ its factory address env) to support
// it end-to-end.
// ─────────────────────────────────────────────────────────────────────────────
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  arbitrum,
  arbitrumSepolia,
  optimism,
  optimismSepolia,
  bsc,
  bscTestnet,
  polygon,
  polygonAmoy,
} from "wagmi/chains";

/** All EVM chains the app supports, mainnets + testnets. */
export const EVM_CHAINS = [
  robinhoodMainnet,
  robinhoodTestnet,
  mainnet,
  sepolia,
  hyperEvm,
  base,
  baseSepolia,
  arbitrum,
  arbitrumSepolia,
  optimism,
  optimismSepolia,
  bsc,
  bscTestnet,
  polygon,
  polygonAmoy,
] as const;

function rpc(name: string) {
  const url = publicEnv(name);
  return url ? http(url) : http();
}

/** wagmi config. Uses each chain's default RPC unless overridden via env. */
export const wagmiConfig = createConfig({
  chains: EVM_CHAINS,
  connectors: [injected()],
  transports: {
    [mainnet.id]: rpc("ETHEREUM_RPC_URL"),
    [sepolia.id]: http(),
    [robinhoodMainnet.id]: http(
      publicEnv("ROBINHOOD_RPC_URL") || "https://rpc.mainnet.chain.robinhood.com",
    ),
    [robinhoodTestnet.id]: http(),
    [hyperEvm.id]: http(
      publicEnv("HYPEREVM_RPC_URL") || "https://rpc.hyperliquid.xyz/evm",
    ),
    [base.id]: rpc("BASE_RPC_URL"),
    [baseSepolia.id]: http(),
    [arbitrum.id]: rpc("ARBITRUM_RPC_URL"),
    [arbitrumSepolia.id]: http(),
    [optimism.id]: rpc("OPTIMISM_RPC_URL"),
    [optimismSepolia.id]: http(),
    [bsc.id]: rpc("BSC_RPC_URL"),
    [bscTestnet.id]: http(),
    [polygon.id]: rpc("POLYGON_RPC_URL"),
    [polygonAmoy.id]: http(),
  },
  ssr: true,
});
