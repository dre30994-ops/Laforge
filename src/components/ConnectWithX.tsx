import { useContext, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LogOut } from "lucide-react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { resolvePrivyAppId, PrivyReadyContext } from "@/lib/privy";
import { useChain } from "@/components/ChainProvider";
import { explorerAddressUrl } from "@/lib/evmNetworks";
import { shortAddress } from "@/lib/brand";

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.743l7.72-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function ConnectWithXButton({
  onClick,
  label,
  disabled,
  error,
  open,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  error?: string;
  open?: boolean;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-expanded={open}
        className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-xs font-semibold
                   text-white border border-black/20 disabled:opacity-50"
        style={{
          background: "linear-gradient(180deg, #1a1a1a, #0a0a0a)",
          fontFamily: "var(--font-mono, monospace)",
        }}
        aria-label={label}
        data-testid="connect-with-x"
      >
        <XMark className="w-3.5 h-3.5" />
        {label}
      </button>
      {error ? (
        <p className="absolute left-0 top-full mt-1 max-w-[220px] text-[10px] leading-snug text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ConnectWithXLive() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { address: wagmiAddress } = useAccount();
  const { network, selectNetwork, networkKey } = useChain();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const handle = user?.twitter?.username;
  const privyWallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const address = privyWallet?.address || wagmiAddress || "";
  const label = busy
    ? "Connecting…"
    : authenticated
      ? handle
        ? `@${handle}`
        : "X connected"
      : "Connect with X";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!authenticated || !privyWallet) return;
    const target = network.chain.id;
    void privyWallet.switchChain(target).catch(() => {
      /* chain may already match, or Privy dashboard may not allow it */
    });
  }, [authenticated, privyWallet, network.chain.id]);

  const explorer = address ? explorerAddressUrl(network, address) : null;

  return (
    <div className="relative" ref={rootRef}>
      <ConnectWithXButton
        disabled={busy}
        label={label}
        error={error}
        open={open}
        onClick={() => {
          void (async () => {
            setError("");
            if (authenticated) {
              setOpen((v) => !v);
              return;
            }
            if (!ready) {
              setError("Privy is still loading. Try again in a second.");
              return;
            }
            setBusy(true);
            try {
              await login();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not open X login.");
            } finally {
              setBusy(false);
            }
          })();
        }}
      />

      {open && authenticated ? (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[55] w-[min(20rem,calc(100vw-2rem))] rounded-2xl p-3.5"
          style={{
            background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,248,242,0.96))",
            border: "1px solid color-mix(in srgb, var(--neon-gold) 32%, transparent)",
            boxShadow: "0 18px 40px -16px rgba(80, 60, 10, 0.35)",
            fontFamily: "var(--font-mono, monospace)",
          }}
          role="dialog"
          aria-label="X wallet"
        >
          <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-mid">Signed in with X</p>
          <p className="mt-1 text-sm font-semibold text-hi">{handle ? `@${handle}` : "X connected"}</p>

          <div className="mt-3 rounded-xl border border-black/8 bg-black/[0.03] px-3 py-2.5">
            <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-mid">
              Wallet · {network.label}
            </p>
            {address ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <code className="text-xs text-hi truncate">{shortAddress(address)}</code>
                <button
                  type="button"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-mid hover:text-hi hover:bg-black/[0.05]"
                  aria-label="Copy wallet address"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(address);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1400);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {copied ? <Check size={13} strokeWidth={2.4} /> : <Copy size={13} strokeWidth={2.2} />}
                </button>
                {explorer ? (
                  <a
                    href={explorer}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-mid hover:text-hi hover:bg-black/[0.05]"
                    aria-label="View on explorer"
                  >
                    <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-mid">Creating your wallet…</p>
            )}
            <p className="mt-2 text-[11px] text-mid leading-snug">
              Create Stake uses this wallet on {network.short}. Switch networks in the chain menu to
              deploy on another chain.
            </p>
          </div>

          {networkKey !== "robinhood" && networkKey !== "ethereum" ? (
            <button
              type="button"
              className="mt-2 text-[11px] text-mid hover:text-hi underline-offset-2 hover:underline"
              onClick={() => void selectNetwork("robinhood")}
            >
              Switch to Robinhood Chain
            </button>
          ) : null}

          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-mid hover:text-hi"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <LogOut size={12} />
            Disconnect X
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ConnectWithX() {
  const privyReady = useContext(PrivyReadyContext);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!privyReady) void resolvePrivyAppId();
  }, [privyReady]);

  if (!privyReady) {
    return (
      <ConnectWithXButton
        label="Connect with X"
        error={error}
        onClick={() => {
          void (async () => {
            const id = await resolvePrivyAppId();
            if (!id) {
              setError(
                "Privy App ID is not on this deploy. In Vercel → Settings → Environment Variables add VITE_PRIVY_APP_ID (the App ID from dashboard.privy.io), apply to Production, then Redeploy.",
              );
            }
          })();
        }}
      />
    );
  }
  return <ConnectWithXLive />;
}
