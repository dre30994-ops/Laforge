import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAccount, useConfig } from "wagmi";
import { switchChain } from "wagmi/actions";
import {
  EVM_NETWORKS,
  PRIMARY_NETWORK,
  networkByChainId,
  type EvmNetwork,
  type EvmNetworkKey,
} from "@/lib/evmNetworks";

/** Back-compat: WalletButton still branches on solana vs anything else (EVM). */
export type ActiveChain = "solana" | "robinhood";

type ChainContextValue = {
  /** @deprecated use `family` — "robinhood" means any EVM network. */
  chain: ActiveChain;
  setChain: (c: ActiveChain) => void;
  toggleChain: () => void;
  hydrated: boolean;
  family: "solana" | "evm";
  networkKey: EvmNetworkKey;
  network: EvmNetwork;
  /** Factory the UI currently talks to (follows the selected / wallet chain). */
  factoryAddress: string;
  currentFactoryAddress: string;
  walletChainId: number | undefined;
  walletConnected: boolean;
  isWalletOnSelected: boolean;
  selectNetwork: (key: EvmNetworkKey) => Promise<void>;
  switching: boolean;
  switchError: string;
};

const STORAGE_FAMILY = "forge.chainFamily";
const STORAGE_NETWORK = "forge.evmNetwork";

const ChainContext = createContext<ChainContextValue | null>(null);

function isNetworkKey(v: unknown): v is EvmNetworkKey {
  return v === "robinhood" || v === "ethereum" || v === "base" || v === "bsc" || v === "hyperevm";
}

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const config = useConfig();
  const { chainId: walletChainId, isConnected } = useAccount();

  const [family, setFamily] = useState<"solana" | "evm">("evm");
  const [networkKey, setNetworkKey] = useState<EvmNetworkKey>(PRIMARY_NETWORK);
  const [hydrated, setHydrated] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");

  useEffect(() => {
    try {
      const storedFamily = window.localStorage.getItem(STORAGE_FAMILY);
      const storedNet = window.localStorage.getItem(STORAGE_NETWORK);
      if (storedFamily === "solana" || storedFamily === "evm") setFamily(storedFamily);
      if (isNetworkKey(storedNet)) setNetworkKey(storedNet);
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  // Wallet is source of truth for EVM selection once connected to a known chain.
  useEffect(() => {
    if (!hydrated || !isConnected) return;
    const matched = networkByChainId(walletChainId);
    if (matched) {
      setFamily("evm");
      setNetworkKey(matched.key);
      try {
        window.localStorage.setItem(STORAGE_FAMILY, "evm");
        window.localStorage.setItem(STORAGE_NETWORK, matched.key);
      } catch {
        // ignore
      }
    }
  }, [hydrated, isConnected, walletChainId]);

  const persist = (nextFamily: "solana" | "evm", nextNet: EvmNetworkKey) => {
    try {
      window.localStorage.setItem(STORAGE_FAMILY, nextFamily);
      window.localStorage.setItem(STORAGE_NETWORK, nextNet);
    } catch {
      // ignore
    }
  };

  const setChain = useCallback((c: ActiveChain) => {
    const nextFamily = c === "solana" ? "solana" : "evm";
    setFamily(nextFamily);
    persist(nextFamily, networkKey);
  }, [networkKey]);

  const toggleChain = useCallback(() => {
    setFamily((prev) => {
      const next = prev === "solana" ? "evm" : "solana";
      persist(next, networkKey);
      return next;
    });
  }, [networkKey]);

  const selectNetwork = useCallback(
    async (key: EvmNetworkKey) => {
      setSwitchError("");
      setFamily("evm");
      setNetworkKey(key);
      persist("evm", key);
      const target = EVM_NETWORKS[key];
      if (!isConnected) return;
      if (walletChainId === target.chain.id) return;
      setSwitching(true);
      try {
        await switchChain(config, { chainId: target.chain.id });
      } catch (e: unknown) {
        const msg =
          e instanceof Error
            ? e.message
            : `Could not switch to ${target.label}. Approve the network in your wallet.`;
        setSwitchError(msg);
        throw e instanceof Error ? e : new Error(msg);
      } finally {
        setSwitching(false);
      }
    },
    [config, walletChainId, isConnected],
  );

  const network = EVM_NETWORKS[networkKey];
  const isWalletOnSelected =
    family === "evm" && isConnected && walletChainId === network.chain.id;

  const value = useMemo<ChainContextValue>(
    () => ({
      chain: family === "solana" ? "solana" : "robinhood",
      setChain,
      toggleChain,
      hydrated,
      family,
      networkKey,
      network,
      factoryAddress: network.factory,
      currentFactoryAddress: network.factory,
      walletChainId,
      walletConnected: isConnected,
      isWalletOnSelected,
      selectNetwork,
      switching,
      switchError,
    }),
    [
      family,
      setChain,
      toggleChain,
      hydrated,
      networkKey,
      network,
      walletChainId,
      isConnected,
      isWalletOnSelected,
      selectNetwork,
      switching,
      switchError,
    ],
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain(): ChainContextValue {
  const ctx = useContext(ChainContext);
  if (!ctx) {
    throw new Error("useChain must be used inside ChainProvider");
  }
  return ctx;
}
