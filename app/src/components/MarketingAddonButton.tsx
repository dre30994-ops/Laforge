"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { formatEther } from "viem";
import { useAccount, useConnect, useConfig } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { robinhoodChain, robinhoodExplorerUrl } from "@/lib/chains";
import {
  purchaseMarketingAddon,
  waitForPoolTx,
  MARKETING_ADDON_DURATION_SECONDS,
  MARKETING_ADDON_WEI,
} from "@/lib/poolClient";
import { getPoolMeta, setPoolMeta, type PoolMeta } from "@/lib/poolMeta";
import { emitPoolsChanged } from "@/lib/poolEvents";
import { isPreviewAddress } from "@/lib/previewPools";

type Status = "idle" | "preparing" | "signing" | "confirming" | "done" | "error";

/**
 * "Trending add-on" button — sits beside the pool image on the pool detail page.
 * Opens a modal explaining the add-on, its 0.06 ETH cost, and a Pay button.
 * Paying sends 0.06 ETH (to the fee recipient) and, on success, marks THIS pool
 * as trending for 12h via its off-chain metadata (drives the trending carousel).
 *
 * The add-on is tied to the pool the user is viewing (its token address).
 */
export function MarketingAddonButton({
  poolAddress,
  tokenAddress,
}: {
  poolAddress: string;
  tokenAddress: string;
}) {
  const [open, setOpen] = useState(false);

  // Preview/mock pools have no real chain contract → hide the paid add-on.
  if (isPreviewAddress(poolAddress)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Promote this pool to Trending"
        className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold
                   text-white border-none shadow-md cursor-pointer transition-transform
                   hover:opacity-95 active:scale-[0.98]"
        style={{ background: "linear-gradient(180deg, #8b5cf6, #6d28d9)" }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M21 7v5h-5" />
        </svg>
        Marketing Add-on
      </button>
      {open && (
        <AddonModal
          tokenAddress={tokenAddress}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AddonModal({
  tokenAddress,
  onClose,
}: {
  tokenAddress: string;
  onClose: () => void;
}) {
  const config = useConfig();
  const { isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const busy = status === "preparing" || status === "signing" || status === "confirming";
  const priceEth = formatEther(MARKETING_ADDON_WEI);

  const getWallet = async () => {
    if (!isConnected) {
      const phantom = connectors.find((c) => /phantom/i.test(c.name) || /phantom/i.test(c.id));
      const injected = connectors.find((c) => c.type === "injected");
      const target = phantom ?? injected ?? connectors[0];
      if (!target) throw new Error("No EVM wallet available.");
      await connectAsync({ connector: target });
    }
    await switchChain(config, { chainId: robinhoodChain.id });
    const wc = await getWalletClient(config, { chainId: robinhoodChain.id });
    if (!wc) throw new Error("Could not obtain a wallet client.");
    return wc;
  };

  const pay = async () => {
    setError("");
    setStatus("preparing");
    try {
      const wc = await getWallet();
      setStatus("signing");
      const { txHash } = await purchaseMarketingAddon(wc);
      setTxHash(txHash);
      setStatus("confirming");
      const ok = await waitForPoolTx(txHash);
      if (!ok) {
        setStatus("error");
        setError("Payment reverted.");
        return;
      }
      // Mark this pool trending for 12h via its off-chain metadata. Preserve any
      // existing metadata (nickname/image/banner/socials/verified badge).
      const existing = (await getPoolMeta(tokenAddress).catch(() => null)) as PoolMeta | null;
      const now = Math.floor(Date.now() / 1000);
      await setPoolMeta(tokenAddress, {
        ...(existing ?? {}),
        marketing: {
          ...(existing?.marketing ?? {}),
          trendingUntil: now + MARKETING_ADDON_DURATION_SECONDS,
        },
      });
      emitPoolsChanged();
      setStatus("done");
    } catch (e: unknown) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Payment failed.");
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Trending add-on"
      onClick={onClose}
    >
      <div
        className="glass glass-gold !rounded-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-hi">Promote to Trending</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-lo hover:text-hi text-lg leading-none px-1">×</button>
        </div>

        <p className="text-sm text-mid leading-relaxed">
          The Trending add-on features <span className="text-hi font-semibold">this pool</span> at
          the top of the app&apos;s trending carousel for{" "}
          <span className="text-hi font-semibold">12 hours</span> — extra visibility for stakers
          browsing the dashboard. It can be purchased at any time, for any pool, independent of the
          pool&apos;s tier.
        </p>

        <div className="mt-4 rounded-xl border border-black/[0.08] bg-black/[0.02] p-3 flex items-center justify-between">
          <span className="label-term !normal-case !tracking-normal text-lo">One-time cost</span>
          <span className="mono text-lg font-bold text-gold-neon">{priceEth} ETH</span>
        </div>

        {status === "done" ? (
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12px] text-pos">
            ✓ This pool is now trending for the next 12 hours.
            {txHash && (
              <div className="mt-1 break-all">
                <a href={`${robinhoodExplorerUrl}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="underline">
                  View payment ↗
                </a>
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={pay}
              disabled={busy}
              className="btn-neon mt-4 w-full disabled:opacity-50"
            >
              {status === "signing"
                ? "Confirm in wallet…"
                : status === "confirming"
                ? "Confirming…"
                : status === "preparing"
                ? "Preparing…"
                : `Pay ${priceEth} ETH`}
            </button>
            {error && <p className="mt-3 text-[12px] text-red-300 break-words">✕ {error}</p>}
            <p className="mt-3 label-term !text-[9px] !normal-case !tracking-normal text-lo leading-snug">
              Payment is sent to the platform fee recipient. Trending is a promotional placement,
              not a change to the pool&apos;s on-chain terms or rewards.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
