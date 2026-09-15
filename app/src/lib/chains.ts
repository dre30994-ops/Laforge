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
        process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ||
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
        process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ||
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
  process.env.NEXT_PUBLIC_ROBINHOOD_MAINNET === "1"
    ? robinhoodMainnet
    : robinhoodTestnet;

/** Convenience: the block-explorer base URL for the active chain. */
export const robinhoodExplorerUrl =
  robinhoodChain.blockExplorers?.default.url ??
  "https://explorer.testnet.chain.robinhood.com";

// ─────────────────────────────────────────────────────────────────────────────
// wagmi config — all supported EVM chains for the connect/stake flows.
//
// The connect button connects a wallet; this config declares which chains that
// wallet may operate on. Robinhood Chain is custom (defineChain above); the rest
// come from viem/chains. Add a chain here (+ its factory address env) to support
// it end-to-end.
// ─────────────────────────────────────────────────────────────────────────────
import { createConfig, http } from "wagmi";
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
  mainnet,
  sepolia,
  robinhoodMainnet,
  robinhoodTestnet,
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

/** wagmi config. Uses each chain's default RPC unless overridden via env. */
export const wagmiConfig = createConfig({
  chains: EVM_CHAINS,
  transports: {
    [mainnet.id]: http(process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL),
    [sepolia.id]: http(),
    [robinhoodMainnet.id]: http(),
    [robinhoodTestnet.id]: http(),
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    [baseSepolia.id]: http(),
    [arbitrum.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL),
    [arbitrumSepolia.id]: http(),
    [optimism.id]: http(process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL),
    [optimismSepolia.id]: http(),
    [bsc.id]: http(process.env.NEXT_PUBLIC_BSC_RPC_URL),
    [bscTestnet.id]: http(),
    [polygon.id]: http(process.env.NEXT_PUBLIC_POLYGON_RPC_URL),
    [polygonAmoy.id]: http(),
  },
  ssr: true,
});
