import { useI18n } from "@/components/LanguageProvider";

export function DemoWarning() {
  const { t } = useI18n();
  return (
    <div
      className="rounded-xl px-4 py-3 text-sm leading-relaxed"
      style={{
        border: "1px solid rgba(200,151,26,0.35)",
        background: "rgba(200,151,26,0.08)",
      }}
      role="note"
    >
      <span className="font-semibold text-hi">{t("demo.title")}</span>{" "}
      <span className="text-mid">{t("demo.body")}</span>
    </div>
  );
}
