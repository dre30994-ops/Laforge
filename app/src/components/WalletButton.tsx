"use client";

import { useCallback, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useChain } from "@/components/ChainProvider";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { WalletPickerModal } from "@/components/WalletPickerModal";

type WalletButtonProps = {
  className?: string;
  style?: React.CSSProperties;
};

/**
 * One "Connect Wallet" button that adapts to the active chain (ChainProvider):
 *   - Solana  → @solana/wallet-adapter (opens its connect modal / disconnects).
 *   - Robinhood/EVM → wagmi (connects an injected wallet / disconnects).
 *
 * Shows the shortened address when connected; clicking while connected
 * disconnects. Both hook stacks are called unconditionally (rules of hooks);
 * the active chain selects which one drives the button.
 */
export function WalletButton({ className = "", style }: WalletButtonProps) {
  const { chain } = useChain();

  // Solana (wallet-adapter) — always called.
  const sol = useSolanaWallet();

  // EVM (wagmi) — always called.
  const { isConnected: evmConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();

  // Wallet picker (EVM only; Solana uses the wallet-adapter modal).
  const [pickerOpen, setPickerOpen] = useState(false);

  const onEvmClick = useCallback(async () => {
    if (evmConnected) {
      await disconnectAsync();
      return;
    }
    // Open the picker so the user chooses which installed wallet to connect.
    setPickerOpen(true);
  }, [evmConnected, disconnectAsync]);

  const isSolana = chain === "solana";

  const connected = isSolana ? sol.connected : evmConnected;

  // When connected, show a plain "Connected" label (white) rather than the
  // wallet address. Clicking still disconnects.
  const label = connected ? "Connected" : "Connect Wallet";

  const onClick = useCallback(() => {
    if (isSolana) {
      if (sol.connected) void sol.logout();
      else sol.login();
    } else {
      void onEvmClick();
    }
  }, [isSolana, sol, onEvmClick]);

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={`${className} !text-white`}
        style={{
          // Spread the caller's style FIRST, then force the green background so
          // it wins over any gold gradient the caller passes via `style`
          // (e.g. the Sidebar). Matches the green Create/Stake CTA.
          ...style,
          background: "linear-gradient(180deg, #22c55e, #16a34a)",
          borderColor: "transparent",
        }}
        aria-label={connected ? "Disconnect wallet" : "Connect wallet"}
      >
        {label}
      </button>
      <WalletPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
