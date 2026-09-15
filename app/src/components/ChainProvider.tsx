"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** The two chains the terminal can operate on. */
export type ActiveChain = "solana" | "robinhood";

type ChainContextValue = {
  /** Currently selected chain. */
  chain: ActiveChain;
  /** Set the active chain explicitly. */
  setChain: (c: ActiveChain) => void;
  /** Flip between the two chains (the lever). */
  toggleChain: () => void;
  /** True once the persisted preference has been read on the client. */
  hydrated: boolean;
};

const STORAGE_KEY = "forge.activeChain";
const DEFAULT_CHAIN: ActiveChain = "robinhood";

const ChainContext = createContext<ChainContextValue>({
  chain: DEFAULT_CHAIN,
  setChain: () => {},
  toggleChain: () => {},
  hydrated: false,
});

function isActiveChain(v: unknown): v is ActiveChain {
  return v === "solana" || v === "robinhood";
}

/**
 * Holds the active chain ('solana' | 'robinhood') for the whole app and
 * persists the user's choice to localStorage. Consumed by the ChainToggle
 * lever and by the chain-aware wallet/staking code.
 *
 * We start from DEFAULT_CHAIN on both server and first client render to avoid a
 * hydration mismatch, then read the persisted value in an effect and flip
 * `hydrated` so UI can react once the real preference is known.
 */
export function ChainProvider({ children }: { children: React.ReactNode }) {
  const [chain, setChainState] = useState<ActiveChain>(DEFAULT_CHAIN);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isActiveChain(stored)) setChainState(stored);
    } catch {
      // localStorage may be unavailable (private mode / SSR guards) — ignore.
    }
    setHydrated(true);
  }, []);

  const setChain = useCallback((c: ActiveChain) => {
    setChainState(c);
    try {
      window.localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // ignore persistence failures
    }
  }, []);

  const toggleChain = useCallback(() => {
    setChainState((prev) => {
      const next: ActiveChain = prev === "solana" ? "robinhood" : "solana";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const value = useMemo<ChainContextValue>(
    () => ({ chain, setChain, toggleChain, hydrated }),
    [chain, setChain, toggleChain, hydrated]
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

/** Read/flip the active chain from anywhere in the tree. */
export function useChain(): ChainContextValue {
  return useContext(ChainContext);
}
