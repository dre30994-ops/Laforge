import { publicEnv } from "@/lib/publicEnv";
import { useEffect, useMemo, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import type { Adapter } from "@solana/wallet-adapter-base";
import { wagmiConfig } from "@/lib/chains";

import "@solana/wallet-adapter-react-ui/styles.css";

const SOLANA_RPC =
  publicEnv("RPC_URL") || "https://api.devnet.solana.com";

export function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);
  const [solanaWallets, setSolanaWallets] = useState<Adapter[]>([]);

  useEffect(() => {
    setSolanaWallets([new PhantomWalletAdapter(), new SolflareWalletAdapter()]);
  }, []);

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
