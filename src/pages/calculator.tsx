import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
import { ApyCalculator } from "@/components/ApyCalculator";
import { DemoWarning } from "@/components/DemoWarning";
import { useI18n } from "@/components/LanguageProvider";

/**
 * Dedicated APY calculator page: the projector on its own, plus a short,
 * plain-language walkthrough of how to read it. Reached from the sidebar's
 * "Calculator" entry (/calculator).
 */
export default function CalculatorPage() {
  const { t } = useI18n();
  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[560px] mx-auto space-y-6">
            {/* Header */}
            <header className="animate-rise">
              <Link to="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                {t("calcPage.back")}
              </Link>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi mt-3">
                {t("calcPage.title")}
              </h1>
              <p className="text-mid mt-2 leading-relaxed">
                {t("calcPage.intro")}
              </p>
            </header>

            <DemoWarning />

            {/* The calculator, on its own */}
            <ApyCalculator />

            {/* Brief usage example */}
            <section className="glass p-6 animate-rise">
              <h2 className="label-term !text-[10px] mb-3">{t("calcPage.how")}</h2>

              <ol className="space-y-3 text-sm text-mid leading-relaxed">
                <li className="flex gap-3">
                  <Step n={1} />
                  <span>{t("calcPage.step1")}</span>
                </li>
                <li className="flex gap-3">
                  <Step n={2} />
                  <span>{t("calcPage.step2")}</span>
                </li>
                <li className="flex gap-3">
                  <Step n={3} />
                  <span>{t("calcPage.step3")}</span>
                </li>
              </ol>

              <p className="label-term !text-[9px] !tracking-normal !normal-case mt-5 leading-snug text-lo">
                {t("calcPage.estimates")}
              </p>
            </section>
          </div>
        </main>
    </TerminalShell>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      className="mono shrink-0 grid place-items-center w-6 h-6 rounded-lg text-[11px] font-bold text-[#0a0c0f]"
      style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}
    >
      {n}
    </span>
  );
}
