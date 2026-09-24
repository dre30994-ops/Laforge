import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { ChainProvider } from "@/components/ChainProvider";
import { WalletContextProvider } from "@/components/WalletProvider";
import { TrendingCarousel } from "@/components/TrendingCarousel";
import { LanguageProvider } from "@/components/LanguageProvider";
import { ThemeBoot } from "@/components/ThemeToggle";
import { ReferralCapture } from "@/components/ReferralCapture";
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
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap",
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
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('laforge.theme')==='night')document.documentElement.dataset.theme='night'}catch(e){}",
          }}
        />
      </head>
      <body
        className="min-h-screen antialiased"
        style={{ fontFamily: "var(--font-sans, system-ui, sans-serif)" }}
      >
        <PreviewHostBridge />
        <ThemeBoot />
        <AuthProvider>
          <LanguageProvider>
            <WalletContextProvider>
              <ChainProvider>
                <ReferralCapture />
                <TrendingCarousel />
                <Outlet />
              </ChainProvider>
            </WalletContextProvider>
          </LanguageProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
