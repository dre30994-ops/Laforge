import { useI18n } from "@/components/LanguageProvider";

export function ImmutableStakeCard() {
  const { t } = useI18n();
  return (
    <section className="glass p-6 animate-rise" data-testid="immutable-stake-card">
      <p className="label-term mb-2">{t("immutable.kicker")}</p>
      <h2 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight leading-tight hero-title-gold">
        {t("immutable.title")}
      </h2>
      <p className="mt-3 text-sm text-mid leading-relaxed">
        {t("immutable.p1")}
      </p>
      <p className="mt-3 text-sm text-mid leading-relaxed">
        {t("immutable.p2")}
      </p>
    </section>
  );
}
