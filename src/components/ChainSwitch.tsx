import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useChain } from "@/components/ChainProvider";
import {
  EVM_NETWORKS,
  EVM_VISIBLE_NETWORKS,
  SHOW_SOLANA_IN_SWITCHER,
  type EvmNetworkKey,
} from "@/lib/evmNetworks";

/**
 * Primary = Robinhood. The sidebar lever fans the network list *upward*;
 * the compact (mobile) control drops downward so it isn't clipped.
 */
export function ChainSwitch({ compact = false }: { compact?: boolean }) {
  const {
    family,
    networkKey,
    selectNetwork,
    switching,
    switchError,
    hydrated,
    setChain,
    isWalletOnSelected,
    walletConnected,
  } = useChain();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = EVM_NETWORKS[networkKey];
  const isEvm = family === "evm";
  const dir = compact ? "down" : "up";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function pick(key: EvmNetworkKey) {
    setOpen(false);
    try {
      await selectNetwork(key);
    } catch {
      // switchError is set on the provider
    }
  }

  const Chevron = dir === "up" ? ChevronUp : ChevronDown;

  return (
    <div className="w-full relative" ref={rootRef} data-testid="chain-switch">
      {!compact && (
        <div className="flex items-center justify-between px-1 mb-1.5">
          <span className="label-term !text-[9px]">Switch Network</span>
          <span className="label-term !text-[9px] text-hi">
            {isEvm ? current.short : "Solana"}
          </span>
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          disabled={!hydrated || switching}
          onClick={() => setOpen((v) => !v)}
          className={`relative z-10 w-full rounded-xl border px-3 flex items-center gap-2 text-left
                     disabled:opacity-50 transition-[border-color,box-shadow,background] duration-200
                     ${compact ? "h-9" : "h-10"}
                     ${open
                       ? "border-[rgba(200,151,26,0.45)] bg-[rgba(200,151,26,0.08)]"
                       : "border-black/10 bg-black/[0.03]"}`}
          aria-expanded={open}
          aria-haspopup="listbox"
          data-testid="chain-switch-trigger"
        >
          <ChainGlyph name={isEvm ? networkKey : "solana"} />
          <span className="flex-1 text-[11px] font-semibold text-hi truncate">
            {switching ? "Switching…" : isEvm ? current.label : "Solana"}
          </span>
          <Chevron
            className={`w-3.5 h-3.5 text-lo shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        <ul
          className={`chain-fan ${dir === "up" ? "flex flex-col-reverse" : "flex flex-col"}`}
          data-open={open ? "true" : "false"}
          data-dir={dir}
          role="listbox"
          aria-hidden={!open}
        >
          {EVM_VISIBLE_NETWORKS.map((key) => {
            const n = EVM_NETWORKS[key];
            const active = isEvm && key === networkKey;
            return (
              <li key={key} className="chain-fan-item">
                <button
                  type="button"
                  role="option"
                  tabIndex={open ? 0 : -1}
                  aria-selected={active}
                  onClick={() => void pick(key)}
                  className={`w-full flex items-center gap-2.5 px-2.5 h-11 rounded-lg text-left transition-colors
                              ${active ? "text-hi" : "text-mid hover:text-hi hover:bg-black/[0.04]"}`}
                  style={
                    active
                      ? {
                          background:
                            "linear-gradient(90deg, rgba(200,151,26,0.16), transparent 72%)",
                          boxShadow: "inset 2px 0 0 var(--neon-gold)",
                        }
                      : undefined
                  }
                  data-testid={`chain-option-${key}`}
                >
                  <ChainGlyph name={key} />
                  <span className="flex-1 text-[11px] font-semibold whitespace-nowrap">
                    {key === "hyperevm" ? n.label : n.short}
                  </span>
                  {key === "robinhood" ? (
                    <span
                      className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{
                        color: "var(--amber-deep)",
                        background: "rgba(200,151,26,0.14)",
                      }}
                    >
                      Primary
                    </span>
                  ) : (
                    <span className="label-term !text-[8px] !tracking-wider shrink-0">{n.nativeSymbol}</span>
                  )}
                </button>
              </li>
            );
          })}
          {SHOW_SOLANA_IN_SWITCHER && (
          <li className="chain-fan-item">
            <div className="mx-2 h-px bg-black/[0.06]" />
          </li>
          )}
          {SHOW_SOLANA_IN_SWITCHER && (
          <li className="chain-fan-item">
            <button
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={() => {
                setOpen(false);
                setChain("solana");
              }}
              className={`w-full flex items-center gap-2.5 px-2.5 h-11 rounded-lg text-left text-[11px] font-semibold
                          hover:bg-black/[0.04] ${!isEvm ? "text-hi" : "text-mid hover:text-hi"}`}
              style={
                !isEvm
                  ? {
                      background:
                        "linear-gradient(90deg, rgba(200,151,26,0.16), transparent 72%)",
                      boxShadow: "inset 2px 0 0 var(--neon-gold)",
                    }
                  : undefined
              }
            >
              <ChainGlyph name="solana" />
              <span className="flex-1">Solana</span>
              <span className="label-term !text-[8px] !tracking-wider">SOL</span>
            </button>
          </li>
          )}
        </ul>
      </div>

      {isEvm && walletConnected && !isWalletOnSelected && !switching && (
        <p className="mt-1.5 text-[10px] text-lo leading-snug">
          Wallet will be asked to switch to {current.short} before you create or stake.
        </p>
      )}

      {switchError && (
        <p className="mt-1.5 text-[10px] text-red-500 leading-snug" role="alert">
          {switchError}
        </p>
      )}
    </div>
  );
}

function ChainGlyph({ name }: { name: EvmNetworkKey | "solana" }) {
  const wrap = "w-[18px] h-[18px] rounded-md grid place-items-center shrink-0 overflow-hidden";
  if (name === "ethereum") {
    return (
      <span className={wrap} style={{ background: "#627EEA" }} title="Ethereum">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="#fff" aria-hidden>
          <path d="M8 1.2L3.6 8.1 8 10.6l4.4-2.5L8 1.2z" opacity="0.85" />
          <path d="M8 11.2L3.6 8.7 8 14.8l4.4-6.1L8 11.2z" />
        </svg>
      </span>
    );
  }
  if (name === "base") {
    return (
      <span className={wrap} style={{ background: "#0052FF" }} title="Base">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="#fff" aria-hidden>
          <circle cx="8" cy="8" r="5.2" />
          <circle cx="8" cy="8" r="2.1" fill="#0052FF" />
        </svg>
      </span>
    );
  }
  if (name === "bsc") {
    return (
      <span className={wrap} style={{ background: "#F0B90B" }} title="BNB Smart Chain">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="#0B0E11" aria-hidden>
          <path d="M8 2.2L10.1 4.3 8 6.4 5.9 4.3 8 2.2zm-4.2 4.2L5.9 8.5 3.8 10.6 1.7 8.5l2.1-2.1zm8.4 0L14.3 8.5 12.2 10.6 10.1 8.5l2.1-2.1zM8 9.6l2.1 2.1L8 13.8 5.9 11.7 8 9.6z" />
        </svg>
      </span>
    );
  }
  if (name === "hyperevm") {
    return (
      <span className={wrap} style={{ background: "#0B0E11" }} title="Hyperliquid">
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden>
          <circle cx="6.5" cy="9" r="4.15" fill="#97FCE4" />
          <circle cx="11.5" cy="9" r="4.15" fill="#97FCE4" />
        </svg>
      </span>
    );
  }
  if (name === "solana") {
    return (
      <span className={wrap} style={{ background: "#9945FF" }} title="Solana">
        <span className="text-[9px] font-black text-white">S</span>
      </span>
    );
  }
  return (
    <span className={wrap} style={{ background: "#00C805" }} title="Robinhood">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="#fff" aria-hidden>
        <path d="M20.0559 0.6412C19.5739 0.222 18.873 0.0255 17.786 0.0015c-0.9876-0.0218-2.16 0.1922-3.4893 0.6288-0.1987 0.0699-0.3582 0.1812-0.4994 0.3188a64.271 64.271 0 0 0-3.9086 4.004l-0.0959 0.1048a0.0937 0.0937 0 0 0-0.0113 0.107c0.02 0.035 0.0619 0.0525 0.1011 0.0437l0.1395-0.0306c2.0022-0.4279 4.0236-0.7554 6.0084-0.9715a0.4605 0.4605 0 0 1 0.3626 0.1179 0.4657 0.4657 0 0 1 0.1499 0.3515c-0.0323 1.9693 0.0392 3.9474 0.2144 5.8795l0.0105 0.1267a0.0927 0.0927 0 0 0 0.0706 0.0808c0.006 0.0022 0.013 0.0022 0.0218 0.0044a0.1 0.1 0 0 0 0.0784-0.0394l0.0715-0.1025a55.8263 55.8263 0 0 1 3.614-4.6112c0.1437-0.1637 0.1812-0.2664 0.2074-0.4148 0.401-2.5719-0.2206-4.4757-0.7758-4.9582Zm-4.3967 5.528-0.0026-0.1222a0.0945 0.0945 0 0 0-0.061-0.0852 0.0952 0.0952 0 0 0-0.102 0.0263l-0.081 0.0917c-3.3995 3.932-6.2577 8.2942-8.4927 12.9686l-0.0523 0.109a0.093 0.093 0 0 0 0.0149 0.1049 0.095 0.095 0 0 0 0.0653 0.0284 0.123 0.123 0 0 0 0.0375-0.0065l0.1116-0.0459c1.9098-0.7903 3.8597-1.4759 5.7957-2.037a0.4419 0.4419 0 0 0 0.2693-0.2227c0.849-1.6549 2.8207-4.86 2.8207-4.86 0.0497-0.072 0.0366-0.179 0.0366-0.179s-0.3382-3.8316-0.36-5.7704zM6.7317 17.341c0.068-0.131 0.3783-0.7292 0.448-0.8624l0.013-0.024c2.0781-3.919 4.6112-7.6174 7.526-10.9884l0.081-0.0939a0.0974 0.0974 0 0 0 0.0105-0.1047 0.094 0.094 0 0 0-0.0941-0.048l-0.122 0.0174a60.3806 60.3806 0 0 0-5.7574 1.085c-0.19 0.0524-0.312 0.1769-0.3382 0.2052a64.6783 64.6783 0 0 0-4.02 5.3534c-0.061 0.0939-0.0829 0.2162-0.0672 0.3166 0.013 0.0982 0.312 2.4016 0.7662 4.17-1.1262 3.2421-2.133 7.5148-2.133 7.5148a0.0947 0.0947 0 0 0 0.0131 0.0808 0.0888 0.0888 0 0 0 0.0741 0.0371h0.6416a0.0987 0.0987 0 0 0 0.0923-0.0612l0.0436-0.12c0.6546-1.786 1.4017-3.55 2.2271-5.2704 0.1918-0.3974 0.5954-1.2074 0.5954-1.2074Zm3.8257 1.489-0.1595 0.0525c-1.026 0.3405-2.5435 0.8667-3.906 1.4933-0.0723 0.035-0.1202 0.131-0.1202 0.131-0.0262 0.059-0.0567 0.131-0.0915 0.2117l-0.0044 0.011c-0.1534 0.3471-0.3626 0.8689-0.4541 1.0829l-0.0698 0.1681a0.067 0.067 0 0 0 0.0175 0.0764 0.0615 0.0615 0 0 0 0.0453 0.0197c0.0087 0 0.02-0.0022 0.0305-0.0065l0.1639-0.0786c.3739-0.1769 0.8455-0.4454 1.3388-0.6812l0.0175-0.0087a885.5338 885.5338 0 0 0 2.6411-1.2554s0.1029-0.0546 0.1552-0.1572l0.4785-0.9606a0.0703 0.0703 0 0 0-0.0087-0.0765 0.0685 0.0685 0 0 0-0.074-0.0218z" />
      </svg>
    </span>
  );
}

export { ChainGlyph };
