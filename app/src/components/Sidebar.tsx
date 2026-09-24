"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { WalletButton } from "@/components/WalletButton";
import { ChainToggle } from "@/components/ChainToggle";
import { CreatePoolButton } from "@/components/CreatePoolButton";

type IconProps = { className?: string };

const Icons = {
  dashboard: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  stake: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  ),
  roadmap: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M9 4l-6 3v13l6-3 6 3 6-3V4l-6 3-6-3z" />
      <path d="M9 4v13" />
      <path d="M15 7v13" />
    </svg>
  ),
  yield: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M3 17l5-5 4 4 8-9" />
      <path d="M21 7v5h-5" />
    </svg>
  ),
  calculator: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="8" y2="11" />
      <line x1="12" y1="11" x2="12" y2="11" />
      <line x1="16" y1="11" x2="16" y2="11" />
      <line x1="8" y1="15" x2="8" y2="15" />
      <line x1="12" y1="15" x2="12" y2="15" />
      <line x1="16" y1="15" x2="16" y2="18" />
    </svg>
  ),
  history: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  ),
  docs: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  ),
  faq: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.2" />
      <line x1="12" y1="17" x2="12" y2="17" />
    </svg>
  ),
};

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: Icons.dashboard, href: "/dashboard", match: "/dashboard" },
  { key: "stake", label: "Stake", icon: Icons.stake, href: "/stake", match: "/stake" },
  { key: "roadmap", label: "Roadmap", icon: Icons.roadmap, href: "/roadmap", match: "/roadmap", className: "text-[#22c55e]" },
  { key: "yield", label: "Yield", icon: Icons.yield, href: "/yield", match: "/yield" },
  { key: "calculator", label: "Calculator", icon: Icons.calculator, href: "/calculator", match: "/calculator" },
  { key: "history", label: "History", icon: Icons.history, href: "/history", match: "/history" },
  { key: "docs", label: "Docs", icon: Icons.docs, href: "/docs", match: "/docs" },
  { key: "faq", label: "FAQ", icon: Icons.faq, href: "/faq", match: "/faq" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { connected } = useSolanaWallet();

  // Each button only gets the gold accent when you're actually on its page,
  // matched against the item's own route. Dashboard is the home page, so it's
  // active on "/". Docs is active on "/docs". Stake/Yield/Calculator/History
  // navigate to the dashboard but have no dedicated route yet, so they stay
  // un-accented (their match paths don't exist).
  const isActive = (match: string) => pathname === match;

  return (
    <aside className="glass !rounded-2xl flex flex-col w-full h-full p-4 relative z-10">
      {/* Brand — links back to the landing page */}
      <Link
        href="/"
        className="flex items-center gap-3 px-1 pb-5 mb-4 border-b border-black/[0.06]
                   rounded-lg hover:opacity-90 transition-opacity"
        aria-label="Forge — back to landing page"
      >
        <img
          src="/icon2_nobg.png"
          alt="Forge"
          width={36}
          height={36}
          className="w-9 h-9 rounded-lg"
        />
        <div>
          <div className="text-sm font-semibold tracking-tight text-hi">Forge</div>
          <div className="label-term !text-[9px]">Staking Terminal</div>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.match);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`nav-item ${active ? "active" : ""} ${("className" in item ? item.className : "") ?? ""}`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Create Stake — opens the same "Create Pool" modal as the top-right
            Create button, sharing identical behavior via CreatePoolButton. */}
        <CreatePoolButton
          label="Create Stake"
          showIcon={false}
          className="mt-3 w-full flex items-center justify-center h-10 rounded-xl text-xs font-semibold
                     text-white border-none transition-opacity hover:opacity-90"
          style={{
            background: "linear-gradient(180deg, #22c55e, #16a34a)",
            fontFamily: "var(--font-mono, monospace)",
          }}
        />
      </nav>

      {/* Status + wallet */}
      <div className="mt-4 pt-4 border-t border-black/[0.06] space-y-3">
        <div className="flex items-center gap-2 px-1">
          <span className="pulse-dot" />
          <span className="label-term !text-[10px]">
            {connected ? "Wallet Live" : "Network · Devnet"}
          </span>
        </div>

        {/* Chain lever — flip between Solana and Robinhood (EVM) */}
        <ChainToggle />

        <WalletButton
          className="!w-full w-full flex items-center justify-center h-10 rounded-xl text-xs font-semibold
                     text-[#0a0c0f] border-none disabled:opacity-50"
          style={{
            background: "linear-gradient(180deg, var(--neon-gold), var(--amber))",
            fontFamily: "var(--font-mono, monospace)",
          }}
        />
      </div>
    </aside>
  );
}
