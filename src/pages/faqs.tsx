import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
import { useI18n } from "@/components/LanguageProvider";

export default function FaqsPage() {
  const { t, tList } = useI18n();
  const items = tList<{ q: string; a: string }>("faqs.items");

  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[880px] mx-auto space-y-6">
            <header className="animate-rise">
              <Link to="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                {t("common.back")}
              </Link>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi mt-3">
                {t("faqs.title")}
              </h1>
              <p className="text-mid mt-2 leading-relaxed">
                {t("faqs.intro")}
              </p>
            </header>

            <div className="space-y-3">
              {items.map((item) => (
                <section key={item.q} className="glass p-5 animate-rise">
                  <h2 className="text-sm font-semibold text-hi">{item.q}</h2>
                  <p className="text-sm text-mid mt-2 leading-relaxed">{item.a}</p>
                </section>
              ))}
            </div>
          </div>
        </main>
    </TerminalShell>
  );
}
