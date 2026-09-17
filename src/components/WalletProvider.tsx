import { publicEnv } from "@/lib/publicEnv";
import { useEffect, useMemo, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import type { Adapter } from "@solana/wallet-adapter-base";
import { wagmiConfig } from "@/lib/chains";
import { privyAppId, privyConfig } from "@/lib/privy";
import { PrivyWagmiSync } from "@/components/PrivyWagmiSync";

import "@solana/wallet-adapter-react-ui/styles.css";

const SOLANA_RPC =
  publicEnv("RPC_URL") || "https://api.devnet.solana.com";

export function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);
  const [solanaWallets, setSolanaWallets] = useState<Adapter[]>([]);
  const appId = privyAppId();

  useEffect(() => {
    setSolanaWallets([new PhantomWalletAdapter(), new SolflareWalletAdapter()]);
  }, []);

  const inner = (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {appId ? <PrivyWagmiSync /> : null}
        <ConnectionProvider endpoint={SOLANA_RPC}>
          <SolanaWalletProvider wallets={solanaWallets} autoConnect>
            <WalletModalProvider>{children}</WalletModalProvider>
          </SolanaWalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );

  if (!appId) return inner;

  return (
    <PrivyProvider appId={appId} config={privyConfig}>
      {inner}
    </PrivyProvider>
  );
}
