import { useCallback } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useChain } from "@/components/ChainProvider";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";

type WalletButtonProps = {
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Connect Wallet — always green with white label. Shows "Connected" once a
 * wallet is attached (click still disconnects).
 */
export function WalletButton({ className = "" }: WalletButtonProps) {
  const { chain, family } = useChain();
  const sol = useSolanaWallet();
  const { isConnected: evmConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();

  const onEvmClick = useCallback(async () => {
    if (evmConnected) {
      await disconnectAsync();
      return;
    }
    const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];
    if (injected) await connectAsync({ connector: injected });
  }, [evmConnected, disconnectAsync, connectors, connectAsync]);

  const isSolana = family === "solana" || chain === "solana";
  const connected = isSolana ? sol.connected : evmConnected;

  const onClick = useCallback(() => {
    if (isSolana) {
      if (sol.connected) void sol.logout();
      else sol.login();
    } else {
      void onEvmClick();
    }
  }, [isSolana, sol, onEvmClick]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center h-10 px-5 rounded-xl text-xs font-semibold
                  border-none disabled:opacity-50 ${className} text-white`}
      style={{
        background: "linear-gradient(180deg, #22c55e, #16a34a)",
        fontFamily: "var(--font-mono, monospace)",
        color: "#fff",
      }}
      aria-label={connected ? "Disconnect wallet" : "Connect wallet"}
    >
      {connected ? "Connected" : "Connect Wallet"}
    </button>
  );
}
