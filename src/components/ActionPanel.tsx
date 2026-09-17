import { useState } from "react";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { useStaking } from "@/hooks/useStaking";
import { usePosition } from "@/hooks/usePosition";
import { DECIMALS, toBaseUnits } from "@/lib/economics";

type ActionTab = "stake" | "unstake" | "claim" | "compound";

export function ActionPanel() {
  const [activeTab, setActiveTab] = useState<ActionTab>("stake");
  const [amount, setAmount] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const { connected, login } = useSolanaWallet();
  const { stake, unstake, claim, compound, reset, result, walletReady } = useStaking();
  const { data: pos, refetch, enabled: posEnabled } = usePosition();
  const busy = result.status === "building" || result.status === "signing";

  // Real on-chain values when connected + mint configured; else 0.
  const walletBalance = posEnabled ? Number(pos.walletBalance) : 0;
  const stakedAmount = posEnabled ? Number(pos.staked) : 0;
  const pendingRewards = posEnabled ? Number(pos.pending) : 0;
  const currentMultiplier = posEnabled ? pos.tenureMultiplier : 1.0;

  const fmt = (n: number) => (n / 10 ** DECIMALS).toLocaleString();

  const handleMax = () => {
    if (activeTab === "stake") setAmount(fmt(walletBalance));
    if (activeTab === "unstake") setAmount(fmt(stakedAmount));
  };

  const confirmMsg =
    activeTab === "unstake"
      ? `Resets ${currentMultiplier.toFixed(2)}x → 1.00x · 5% exit tax`
      : activeTab === "compound"
      ? `Dilutes your tenure multiplier`
      : "";

  const runAction = async () => {
    reset();
    if (activeTab === "stake" || activeTab === "unstake") {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      const base = BigInt(toBaseUnits(parsed));
      const sig = activeTab === "stake" ? await stake(base) : await unstake(base);
      if (sig) void refetch();
    } else if (activeTab === "claim") {
      const sig = await claim();
      if (sig) void refetch();
    } else if (activeTab === "compound") {
      const sig = await compound();
      if (sig) void refetch();
    }
  };

  const handleAction = async () => {
    if (!connected) {
      login();
      return;
    }
    if ((activeTab === "unstake" || activeTab === "compound") && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    setShowConfirm(false);
    await runAction();
    // Clear the input only on a successful stake/unstake.
    if (activeTab === "stake" || activeTab === "unstake") setAmount("");
  };

  const switchTab = (key: ActionTab) => {
    setActiveTab(key);
    setShowConfirm(false);
    setAmount("");
    reset();
  };

  const tabs: { key: ActionTab; label: string }[] = [
    { key: "stake", label: "⚒️ Stake" },
    { key: "unstake", label: "🛡️ Exit" },
    { key: "claim", label: "💰 Claim" },
    { key: "compound", label: "🔄 Fold" },
  ];

  const actionLabel: Record<ActionTab, string> = {
    stake: "Stake",
    unstake: "Unstake",
    claim: "Claim Rewards",
    compound: "Compound",
  };

  const primaryLabel = !connected
    ? "Connect Wallet"
    : busy
    ? result.status === "signing"
      ? "Confirm in wallet…"
      : "Preparing…"
    : actionLabel[activeTab];

  const inputDisabled =
    (activeTab === "stake" || activeTab === "unstake") && !amount;

  return (
    <div className="card-medieval !p-3 text-sm">
      {/* Tabs - 2x2 grid for compactness */}
      <div className="grid grid-cols-2 gap-1 mb-3">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            disabled={busy}
            className={`py-1.5 px-2 text-xs font-medieval rounded transition-all
              ${
                activeTab === tab.key
                  ? "bg-gold-900/50 text-gold-300 border border-gold-600/40"
                  : "text-medieval-muted hover:text-parchment-200 border border-transparent"
              } disabled:opacity-50`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Amount input (stake/unstake) */}
      {(activeTab === "stake" || activeTab === "unstake") && (
        <div className="space-y-1.5 mb-3">
          <div className="flex justify-between text-xs text-medieval-muted">
            <span>{activeTab === "stake" ? "Bal" : "Staked"}</span>
            <span>{fmt(activeTab === "stake" ? walletBalance : stakedAmount)}</span>
          </div>
          <div className="relative">
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount..."
              disabled={busy}
              className="input-medieval !py-2 !text-sm !pr-12 disabled:opacity-50"
            />
            <button
              onClick={handleMax}
              disabled={busy}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 
                         text-[10px] font-medieval text-gold-400 bg-gold-900/30 
                         rounded border border-gold-700/30 hover:bg-gold-800/40 disabled:opacity-50"
            >
              MAX
            </button>
          </div>
        </div>
      )}

      {/* Claim/compound display */}
      {(activeTab === "claim" || activeTab === "compound") && (
        <div className="mb-3 text-center py-2">
          <div className="text-xs text-medieval-muted">Pending</div>
          <div className="text-lg font-medieval font-bold text-gold-300">
            {fmt(pendingRewards)}
          </div>
        </div>
      )}

      {/* Confirm warning */}
      {showConfirm && (
        <div className="mb-2 p-2 bg-gold-950/60 border border-gold-700/30 rounded text-xs text-parchment-200">
          ⚠️ {confirmMsg}
          <div className="flex gap-1 mt-2">
            <button onClick={handleAction} className="btn-gold !py-1 !px-3 !text-xs flex-1">
              Yes
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="btn-ghost !py-1 !px-3 !text-xs flex-1"
            >
              No
            </button>
          </div>
        </div>
      )}

      {/* Action button */}
      {!showConfirm && (
        <button
          onClick={handleAction}
          disabled={busy || (connected && inputDisabled) || (!walletReady && connected)}
          className="btn-gold w-full !py-2 !text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {primaryLabel}
        </button>
      )}

      {/* Status feedback */}
      {result.status === "success" && result.signature && (
        <div className="mt-2 p-2 bg-green-900/20 border border-green-700/30 rounded text-[11px] text-green-300 break-all">
          ✓ Sent.{" "}
          <a
            href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-green-200"
          >
            {result.signature.slice(0, 8)}…{result.signature.slice(-8)}
          </a>
        </div>
      )}
      {result.status === "error" && result.error && (
        <div className="mt-2 p-2 bg-red-900/20 border border-red-700/30 rounded text-[11px] text-red-300 break-words">
          ✕ {result.error}
        </div>
      )}
    </div>
  );
}
