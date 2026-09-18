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
import { PrivyErrorBoundary } from "@/components/PrivyErrorBoundary";

import "@solana/wallet-adapter-react-ui/styles.css";

const SOLANA_RPC =
  publicEnv("RPC_URL") || "https://api.devnet.solana.com";

export function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);
  const [solanaWallets, setSolanaWallets] = useState<Adapter[]>([]);
  const [clientReady, setClientReady] = useState(false);
  const appId = clientReady ? privyAppId() : "";

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    setSolanaWallets([new PhantomWalletAdapter(), new SolflareWalletAdapter()]);
  }, []);

  const shell = (withPrivySync: boolean) => (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {withPrivySync ? <PrivyWagmiSync /> : null}
        <ConnectionProvider endpoint={SOLANA_RPC}>
          <SolanaWalletProvider wallets={solanaWallets} autoConnect>
            <WalletModalProvider>{children}</WalletModalProvider>
          </SolanaWalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );

  // Privy is browser-only. Mounting it during SSR (or letting it throw) paints
  // a blank white page. Wait until the client, then isolate failures.
  if (!appId || !clientReady) return shell(false);

  return (
    <PrivyErrorBoundary fallback={shell(false)}>
      <PrivyProvider appId={appId} config={privyConfig}>
        {shell(true)}
      </PrivyProvider>
    </PrivyErrorBoundary>
  );
}
