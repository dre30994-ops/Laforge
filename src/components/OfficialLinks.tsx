import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import {
  hasTokenCa,
  officialContracts,
  shortAddress,
  TOKEN_CA,
  TOKEN_SYMBOL,
  tokenExplorerUrl,
  X_HANDLE,
  X_URL,
} from "@/lib/brand";

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.743l7.72-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-mid hover:text-hi hover:bg-black/[0.05] transition-colors"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* ignore */
        }
      }}
    >
      {copied ? <Check size={13} strokeWidth={2.4} /> : <Copy size={13} strokeWidth={2.2} />}
    </button>
  );
}

export function OfficialLinks({
  compact = false,
  contractsOnly = false,
}: {
  compact?: boolean;
  contractsOnly?: boolean;
}) {
  const contracts = officialContracts();
  const tokenHref = tokenExplorerUrl();

  if (compact) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2" data-testid="official-links-compact">
        <a
          href={X_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold text-white/90 border border-white/20 bg-white/8 hover:bg-white/14 transition-colors"
        >
          <XMark className="w-3.5 h-3.5" />
          @{X_HANDLE}
        </a>
        {hasTokenCa() && (
          <a
            href={tokenHref ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-xs font-mono text-white/85 border border-white/20 bg-white/8 hover:bg-white/14 transition-colors"
            title={`${TOKEN_SYMBOL} CA ${TOKEN_CA}`}
          >
            {TOKEN_SYMBOL} · {shortAddress(TOKEN_CA)}
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    );
  }

  return (
    <section className="glass p-6 animate-rise" data-testid="official-links">
      {!contractsOnly && (
        <>
      <p className="label-term mb-3">Official</p>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <a
          href={X_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-semibold text-hi border border-black/10 bg-black/[0.03] hover:border-gold-400/50 hover:text-gold-700 transition-colors"
        >
          <XMark className="w-3.5 h-3.5" />
          @{X_HANDLE}
          <ExternalLink size={12} className="text-lo" />
        </a>
        {hasTokenCa() && (
          <div className="inline-flex items-center gap-1 h-9 pl-3 pr-1 rounded-lg border border-black/10 bg-black/[0.03]">
            <span className="label-term !tracking-normal !normal-case !text-[10px] mr-1">
              {TOKEN_SYMBOL} CA
            </span>
            {tokenHref ? (
              <a
                href={tokenHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-hi hover:text-gold-700"
                title={TOKEN_CA}
              >
                {shortAddress(TOKEN_CA)}
              </a>
            ) : (
              <span className="font-mono text-xs text-hi" title={TOKEN_CA}>
                {shortAddress(TOKEN_CA)}
              </span>
            )}
            <CopyButton value={TOKEN_CA} label={`${TOKEN_SYMBOL} contract`} />
          </div>
        )}
      </div>
        </>
      )}

      <p className="label-term mb-3">Verified contracts</p>
      <ul className="divide-y divide-black/[0.06]">
        {contracts.map((row) => (
          <li
            key={`${row.chain}-${row.role}-${row.address}`}
            className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-hi">
                {row.chain} · {row.role}
              </p>
              <p className="font-mono text-[11px] text-mid truncate" title={row.address}>
                {shortAddress(row.address)}
              </p>
            </div>
            <CopyButton value={row.address} label={`${row.chain} ${row.role}`} />
            <a
              href={row.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[11px] font-semibold text-hi border border-black/10 hover:border-gold-400/50 hover:text-gold-700 transition-colors"
            >
              Explorer
              <ExternalLink size={11} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SidebarXLink() {
  return (
    <a
      href={X_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="nav-item mt-1"
      aria-label={`Laforge on X, ${X_HANDLE}`}
    >
      <XMark className="w-[16px] h-[16px] shrink-0" />
      <span>X · @{X_HANDLE}</span>
    </a>
  );
}
