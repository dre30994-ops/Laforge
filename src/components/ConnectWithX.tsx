import { useContext, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { resolvePrivyAppId, PrivyReadyContext } from "@/lib/privy";

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
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const handle = user?.twitter?.username;
  const label = busy
    ? "Connecting…"
    : authenticated
      ? handle
        ? `@${handle}`
        : "X connected"
      : "Connect with X";

  return (
    <ConnectWithXButton
      disabled={busy}
      label={label}
      error={error}
      onClick={() => {
        void (async () => {
          setError("");
          if (authenticated) {
            setBusy(true);
            try {
              await logout();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not disconnect X.");
            } finally {
              setBusy(false);
            }
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

