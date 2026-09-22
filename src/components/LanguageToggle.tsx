import { useI18n } from "@/components/LanguageProvider";

/**
 * Compact EN / HI / 简 segmented control. Light-gold shell, brighter gold when active.
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
      className="inline-flex h-8 items-center rounded-lg p-px shrink-0 self-center"
      style={{
        border: "1px solid rgba(232, 196, 90, 0.7)",
        background: dark
          ? "linear-gradient(180deg, rgba(246, 222, 122, 0.28), rgba(212, 165, 40, 0.18))"
          : "linear-gradient(180deg, #fff8d6, #f3e4a4)",
        boxShadow: dark
          ? "inset 0 1px 0 rgba(255,248,214,0.25), 0 0 0 1px rgba(255,207,77,0.12)"
          : "inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 3px rgba(180,140,30,0.18)",
      }}
    >
      <LangSide
        active={locale === "en"}
        dark={dark}
        label={t("lang.en")}
        ariaLabel={t("lang.toEn")}
        onClick={() => setLocale("en")}
      />
      <LangSide
        active={locale === "hi"}
        dark={dark}
        label={t("lang.hi")}
        ariaLabel={t("lang.toHi")}
        onClick={() => setLocale("hi")}
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
      className={`h-7 min-w-[1.7rem] px-1.5 rounded-md text-[10px] font-semibold tracking-[0.12em]
                  transition-[color,background,box-shadow] duration-150 ${
                    active ? "text-gold-950" : dark ? "text-gold-100/80 hover:text-white" : "text-gold-800/70 hover:text-gold-950"
                  }`}
      style={{
        fontFamily: "var(--font-mono, monospace)",
        background: active
          ? "linear-gradient(180deg, #fff6c4, #f0d56a)"
          : "transparent",
        boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 4px rgba(201,151,20,0.28)" : "none",
      }}
    >
      {label}
    </button>
  );
}
