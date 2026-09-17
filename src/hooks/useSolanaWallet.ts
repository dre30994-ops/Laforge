import { useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export type SolanaWalletState = {
  /** True once the wallet stack is ready on the client. */
  ready: boolean;
  /** True when a wallet is connected (kept for API compatibility). */
  authenticated: boolean;
  /** True when there is a connected Solana wallet. */
  connected: boolean;
  /** The connected Solana wallet's base58 public key, or null. */
  address: string | null;
  /** Shortened address for display, e.g. "7xKX…9aBc". */
  shortAddress: string | null;
  /** Open the wallet-adapter connect modal. */
  login: () => void;
  /** Disconnect the connected wallet. */
  logout: () => Promise<void>;
};

function shorten(addr: string | null): string | null {
  if (!addr) return null;
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

/**
 * App-facing Solana wallet state, backed by @solana/wallet-adapter. Preserves
 * the previous `SolanaWalletState` shape so downstream components are unchanged.
 *
 * `login` opens the wallet-adapter connect modal; `logout` disconnects.
 */
export function useSolanaWallet(): SolanaWalletState {
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const address = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  const login = useCallback(() => setVisible(true), [setVisible]);
  const logout = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  return {
    // The adapter stack is mounted client-side and always ready to prompt.
    ready: true,
    authenticated: connected,
    connected,
    address,
    shortAddress: shorten(address),
    login,
    logout,
  };
}
