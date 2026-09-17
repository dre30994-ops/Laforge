import { publicEnv } from "@/lib/publicEnv";
import { defineChain } from "viem";

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

export const robinhoodChain =
  publicEnv("ROBINHOOD_MAINNET") === "1"
    ? robinhoodMainnet
    : robinhoodTestnet;

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
