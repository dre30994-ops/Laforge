import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { ChainProvider } from "@/components/ChainProvider";
import { WalletContextProvider } from "@/components/WalletProvider";
import { MusicProvider } from "@/components/MusicProvider";
import { MusicToggle } from "@/components/MusicToggle";
import { TrendingCarousel } from "@/components/TrendingCarousel";
import { LanguageProvider } from "@/components/LanguageProvider";
import appCss from "../styles.css?url";

const APP_NAME = "Laforge — Staking Terminal";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "A premium DeFi staking terminal. Create pools, track staked value, and project APY.",
      },
      { name: "theme-color", content: "#d4a528" },
    ],
    links: [
      { rel: "icon", href: "/icon2_nobg.png" },
      { rel: "apple-touch-icon", href: "/icon2_nobg.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body
        className="min-h-screen antialiased"
        style={{ fontFamily: "var(--font-sans, system-ui, sans-serif)" }}
      >
        <PreviewHostBridge />
        <AuthProvider>
          <LanguageProvider>
            <WalletContextProvider>
              <ChainProvider>
                <MusicProvider>
                  <TrendingCarousel />
                  <Outlet />
                  <MusicToggle />
                </MusicProvider>
              </ChainProvider>
            </WalletContextProvider>
          </LanguageProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
