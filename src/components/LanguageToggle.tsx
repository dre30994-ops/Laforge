import { useI18n } from "@/components/LanguageProvider";

/**
 * Compact EN / 简 segmented control. Gold when active, sits beside Connect with X.
 */
export function LanguageToggle({
  tone = "light",
}: {
  tone?: "light" | "dark";
}) {
  const { locale, setLocale, t } = useI18n();
  const dark = tone === "dark";

  return (
    <div
      role="group"
      aria-label={t("lang.group")}
      data-testid="language-toggle"
      className={
        dark
          ? "inline-flex h-8 items-center rounded-lg p-px shrink-0 self-center border border-white/20 bg-white/8"
          : "inline-flex h-8 items-center rounded-lg p-px shrink-0 self-center"
      }
      style={
        dark
          ? { boxShadow: "0 0 0 1px rgba(255,207,77,0.12), inset 0 1px 0 rgba(255,255,255,0.08)" }
          : {
              border: "1px solid color-mix(in srgb, var(--neon-gold) 55%, transparent)",
              background:
                "linear-gradient(180deg, rgba(255,252,242,0.98), rgba(248,240,214,0.92))",
              boxShadow:
                "0 1px 2px rgba(120,90,20,0.12), inset 0 1px 0 rgba(255,255,255,0.8)",
            }
      }
    >
      <LangSide
        active={locale === "en"}
        dark={dark}
        label={t("lang.en")}
        ariaLabel={t("lang.toEn")}
        onClick={() => setLocale("en")}
      />
      <LangSide
        active={locale === "zh-CN"}
        dark={dark}
        label={t("lang.zh")}
        ariaLabel={t("lang.toZh")}
        onClick={() => setLocale("zh-CN")}
      />
    </div>
  );
}

function LangSide({
  active,
  dark,
  label,
  ariaLabel,
  onClick,
}: {
  active: boolean;
  dark: boolean;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`h-7 min-w-[1.85rem] px-2 rounded-md text-[10px] font-semibold tracking-[0.18em]
                  transition-[color,background,box-shadow] duration-150 ${
                    dark
                      ? active
                        ? "text-bark-950"
                        : "text-white/65 hover:text-white"
                      : active
                        ? "text-bark-950"
                        : "text-lo hover:text-hi"
                  }`}
      style={{
        fontFamily: "var(--font-mono, monospace)",
        background: active
          ? "linear-gradient(180deg, var(--neon-gold), var(--amber))"
          : "transparent",
        boxShadow: active ? "0 1px 4px rgba(180,130,20,0.35)" : "none",
      }}
    >
      {label}
    </button>
  );
}
