import { usePrivy } from "@privy-io/react-auth";
import { privyAppId } from "@/lib/privy";

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
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
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
  );
}

function ConnectWithXLive() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const handle = user?.twitter?.username;
  const label = authenticated ? (handle ? `@${handle}` : "X connected") : "Connect with X";

  return (
    <ConnectWithXButton
      disabled={!ready}
      label={label}
      onClick={() => {
        if (authenticated) void logout();
        else void login({ loginMethods: ["twitter"] });
      }}
    />
  );
}

export function ConnectWithX() {
  if (!privyAppId()) {
    return (
      <ConnectWithXButton
        label="Connect with X"
        onClick={() => {
          console.warn("Set VITE_PRIVY_APP_ID to enable Connect with X.");
        }}
      />
    );
  }
  return <ConnectWithXLive />;
}
