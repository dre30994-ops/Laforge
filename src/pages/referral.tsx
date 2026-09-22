import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
import { ReferralCard } from "@/components/ReferralCard";
import { ReferralLedger } from "@/components/ReferralLedger";
import { useI18n } from "@/components/LanguageProvider";

const HOPS = [
  { key: "h1", cut: "10–30%", sample: "0.003" },
  { key: "h2", cut: "5% of hop 1", sample: "0.00015" },
  { key: "h3", cut: "2% of hop 2", sample: "0.000003" },
] as const;

export default function ReferralPage() {
  const { t } = useI18n();

  return (
    <TerminalShell>
      <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
        <div className="max-w-[880px] mx-auto space-y-6">
          <header className="animate-rise">
            <Link to="/" className="label-term hover:text-gold-neon transition-colors">
              {t("common.back")}
            </Link>
            <p className="label-term mt-4">{t("refPage.kicker")}</p>
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-hi mt-2">
              {t("refPage.title")}
            </h1>
            <p className="text-mid mt-3 text-lg leading-relaxed max-w-xl">
              {t("refPage.lede")}
            </p>
          </header>

          <ReferralLedger />

          <ReferralCard lite />

          <section className="space-y-3 animate-rise">
            <p className="label-term">{t("refPage.hopsLabel")}</p>
            {HOPS.map((hop, i) => (
              <article
                key={hop.key}
                className="glass p-5 flex items-start gap-4"
              >
                <span className="shrink-0 w-9 h-9 rounded-xl grid place-items-center text-sm font-semibold text-gold-800 bg-gold-200">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <h2 className="text-sm font-semibold text-hi">{t(`refPage.${hop.key}t`)}</h2>
                    <p className="font-mono text-sm text-gold-700">{hop.cut}</p>
                  </div>
                  <p className="text-sm text-mid mt-1.5 leading-relaxed">{t(`refPage.${hop.key}p`)}</p>
                </div>
              </article>
            ))}
            <p className="text-xs text-lo px-1">{t("refPage.cap")}</p>
          </section>

          <section className="glass p-6 animate-rise">
            <p className="label-term mb-3">{t("refPage.exLabel")}</p>
            <p className="text-sm text-mid mb-4">{t("refPage.exBlurb")}</p>
            <ul className="space-y-2">
              {HOPS.map((hop) => (
                <li
                  key={hop.key}
                  className="flex items-center justify-between gap-3 text-sm border-b border-black/[0.06] pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-mid">{t(`refPage.${hop.key}who`)}</span>
                  <span className="font-mono text-hi">{hop.sample} ETH</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 text-sm pt-1">
                <span className="text-mid">{t("refPage.protocol")}</span>
                <span className="font-mono text-hi">{t("refPage.theRest")}</span>
              </li>
            </ul>
            <p className="text-xs text-lo mt-4 leading-relaxed">{t("refPage.override")}</p>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <p className="glass p-5 text-sm text-mid leading-relaxed">{t("refPage.hold")}</p>
            <p className="glass p-5 text-sm text-mid leading-relaxed">{t("refPage.self")}</p>
          </section>
        </div>
      </main>
    </TerminalShell>
  );
}
