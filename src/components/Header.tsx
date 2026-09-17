import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { WalletButton } from "@/components/WalletButton";

export function Header() {
  const { connected } = useSolanaWallet();

  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-4 
                        border-b border-medieval-border/50 bg-medieval-bg/60 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="text-2xl">🏰</div>
        <div>
          <h1 className="text-lg font-medieval font-bold text-gold-400 tracking-wider">
            THE FORGE
          </h1>
          <p className="text-xs text-medieval-muted -mt-0.5">14-Day Staking</p>
        </div>
      </div>

      <nav className="hidden md:flex items-center gap-6 text-sm font-medieval text-medieval-muted">
        <a href="#" className="hover:text-gold-400 transition-colors">Dashboard</a>
        <a href="#" className="hover:text-gold-400 transition-colors">History</a>
        <a href="#" className="hover:text-gold-400 transition-colors">Docs</a>
      </nav>

      <div className="flex items-center gap-3">
        {connected && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 
                          bg-green-900/20 border border-green-700/30 rounded-md">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400">Live</span>
          </div>
        )}
        <WalletButton className="px-4 h-10 rounded-md font-medieval text-sm" />
      </div>
    </header>
  );
}
