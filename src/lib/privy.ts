import { publicEnv } from "@/lib/publicEnv";
import { robinhoodChain, EVM_CHAINS } from "@/lib/chains";
import type { PrivyClientConfig } from "@privy-io/react-auth";

declare global {
  interface Window {
    __PRIVY_APP_ID__?: string;
  }
}

function fromProcess(): string {
  if (typeof process === "undefined" || !process.env) return "";
  return (
    process.env.VITE_PRIVY_APP_ID ||
    process.env.NEXT_PUBLIC_PRIVY_APP_ID ||
    process.env.PRIVY_APP_ID ||
    process.env.PRIVY_ID ||
    ""
  );
}

function fromWindow(): string {
  if (typeof window === "undefined") return "";
  const id = window.__PRIVY_APP_ID__;
  return typeof id === "string" ? id : "";
}

export function privyAppId(): string {
  return fromWindow() || publicEnv("PRIVY_APP_ID") || publicEnv("PRIVY_ID") || fromProcess();
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
