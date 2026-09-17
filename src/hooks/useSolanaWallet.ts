import { useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export type SolanaWalletState = {
  ready: boolean;
  authenticated: boolean;
  connected: boolean;
  address: string | null;
  shortAddress: string | null;
  login: () => void;
  logout: () => Promise<void>;
};

function shorten(addr: string | null): string | null {
  if (!addr) return null;
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export function useSolanaWallet(): SolanaWalletState {
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const address = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  const login = useCallback(() => setVisible(true), [setVisible]);
  const logout = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  return {
    ready: true,
    authenticated: connected,
    connected,
    address,
    shortAddress: shorten(address),
    login,
    logout,
  };
}
