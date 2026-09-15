"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useConnect, type Connector } from "wagmi";

/**
 * A small modal that lists the available EVM wallets (each installed wallet is
 * surfaced as its own wagmi connector via EIP-6963 discovery) and lets the user
 * pick which one to connect. Replaces the previous "auto-grab the first
 * injected wallet" behaviour so MetaMask isn't silently chosen over Phantom.
 *
 * Dedupes connectors by name (EIP-6963 + a legacy "injected" can both appear),
 * shows each wallet's icon when provided, and closes on a successful connect.
 */
export function WalletPickerModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { connectors, connectAsync, isPending } = useConnect();
  const [error, setError] = useState<string>("");
  const [pendingId, setPendingId] = useState<string>("");

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // Dedupe by lowercased name; prefer a connector that advertises an icon.
  const seen = new Map<string, Connector>();
  for (const c of connectors) {
    const key = (c.name || c.id).toLowerCase();
    const existing = seen.get(key);
    if (!existing || (!existing.icon && c.icon)) seen.set(key, c);
  }
  const wallets = Array.from(seen.values());

  const pick = async (connector: Connector) => {
    setError("");
    setPendingId(connector.uid);
    try {
      await connectAsync({ connector });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not connect that wallet.");
    } finally {
      setPendingId("");
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a wallet"
      onClick={onClose}
    >
      <div
        className="glass glass-gold !rounded-2xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-hi">Connect a wallet</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-lo hover:text-hi text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        {wallets.length === 0 ? (
          <p className="text-sm text-lo">
            No EVM wallets detected. Install Phantom or MetaMask, then reload.
          </p>
        ) : (
          <ul className="space-y-2">
            {wallets.map((c) => (
              <li key={c.uid}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  disabled={isPending}
                  className="w-full flex items-center gap-3 rounded-xl border border-black/10
                             px-4 py-3 text-left hover:border-black/25 hover:bg-black/[0.04]
                             transition-colors disabled:opacity-50"
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" className="h-6 w-6 rounded-md shrink-0" />
                  ) : (
                    <span className="h-6 w-6 rounded-md shrink-0 grid place-items-center text-[10px] font-bold text-white/90"
                      style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}>
                      {(c.name || "?").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="text-sm font-medium text-hi flex-1">{c.name}</span>
                  {pendingId === c.uid && (
                    <span className="label-term !text-[10px]">connecting…</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="mt-3 text-[11px] text-red-300 break-words">{error}</p>
        )}
      </div>
    </div>,
    document.body
  );
}
