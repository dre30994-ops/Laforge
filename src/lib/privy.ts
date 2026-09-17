import { publicEnv } from "@/lib/publicEnv";
import { robinhoodChain, EVM_CHAINS } from "@/lib/chains";
import type { PrivyClientConfig } from "@privy-io/react-auth";

export function privyAppId(): string {
  return publicEnv("PRIVY_APP_ID") || publicEnv("PRIVY_ID") || "";
}

export const privyConfig: PrivyClientConfig = {
  loginMethods: ["twitter"],
  appearance: {
    theme: "dark",
    accentColor: "#d4a528",
    logo: "/icon2_nobg.png",
    landingHeader: "Connect with X",
    walletChainType: "ethereum-only",
  },
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" },
  },
  defaultChain: robinhoodChain,
  supportedChains: [...EVM_CHAINS],
};
