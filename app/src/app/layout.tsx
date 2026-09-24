import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ChainProvider } from "@/components/ChainProvider";
import { WalletContextProvider } from "@/components/WalletProvider";
import { MusicProvider } from "@/components/MusicProvider";
import { MusicToggle } from "@/components/MusicToggle";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Forge",
  description:
    "A premium DeFi staking terminal. Track staked value, accumulating yield, and project your APY.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon2_nobg.png",
    shortcut: "/icon2_nobg.png",
    apple: "/icon2_nobg.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#d4a528",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body
        className="min-h-screen antialiased"
        style={{ fontFamily: "var(--font-sans, system-ui, sans-serif)" }}
      >
        <ChainProvider>
          <WalletContextProvider>
            <MusicProvider>
              {children}
              <MusicToggle />
            </MusicProvider>
          </WalletContextProvider>
        </ChainProvider>
      </body>
    </html>
  );
}
