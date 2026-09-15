"use client";

import { useMemo } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { wagmiConfig } from "@/lib/chains";

// Prebuilt Solana wallet modal styles.
import "@solana/wallet-adapter-react-ui/styles.css";

/** Solana RPC endpoint (defaults to devnet); mirrors useStaking/usePosition. */
const SOLANA_RPC =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

/**
 * Client-side wallet context.
 *
 * EVM: wagmi + viem across all supported chains (see `wagmiConfig` in
 *      lib/chains.ts). Any injected wallet (MetaMask, Phantom's EVM mode,
 *      Rainbow, etc.) can connect and switch between the supported chains.
 * Solana: @solana/wallet-adapter with Phantom + Solflare, plus the prebuilt
 *         connect modal.
 *
 * Both stacks are mounted at once; the UI (WalletButton) picks which one to use
 * based on the active chain toggle (see ChainProvider). No third-party auth
 * vendor — users connect their own wallets.
 */
export function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);
  const solanaWallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider endpoint={SOLANA_RPC}>
          <SolanaWalletProvider wallets={solanaWallets} autoConnect>
            <WalletModalProvider>{children}</WalletModalProvider>
          </SolanaWalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
