import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { officialContracts, shortAddress } from "@/lib/brand";
import { useI18n } from "@/components/LanguageProvider";

function CopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-mid hover:text-hi hover:bg-black/[0.05] transition-colors"
      aria-label={copied ? t("official.copied", { label }) : t("official.copy", { label })}
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

export function OfficialLinks() {
  const { t } = useI18n();
  const contracts = officialContracts();

  return (
    <section className="glass p-6 animate-rise" data-testid="official-links">
      <p className="label-term mb-3">{t("official.verified")}</p>
      <ul className="divide-y divide-black/[0.06]">
        {contracts.map((row) => (
          <li
            key={`${row.chain}-${row.role}-${row.address}`}
            className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-hi">
                {row.chain} · {row.role === "Factory" ? t("official.factory") : t("official.desk")}
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
              {t("official.explorer")}
              <ExternalLink size={11} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
