import { useLayoutEffect, useSyncExternalStore } from "react";
import { useI18n } from "@/components/LanguageProvider";
import { getTheme, hydrateTheme, subscribeTheme, toggleTheme } from "@/lib/theme";

/** Apply the saved theme before paint so the first frame matches the button. */
export function ThemeBoot() {
  useLayoutEffect(() => {
    hydrateTheme();
  }, []);
  return null;
}

export function ThemeToggle() {
  const { t } = useI18n();
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "day" as const);
  const night = theme === "night";

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-pressed={night}
      aria-label={night ? t("theme.toDay") : t("theme.toNight")}
      onClick={toggleTheme}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg shrink-0 self-center"
      style={{
        border: "1px solid rgba(232, 196, 90, 0.7)",
        background: night
          ? "linear-gradient(180deg, #2a2418, #12100c)"
          : "linear-gradient(180deg, #fff8d6, #f3e4a4)",
        boxShadow: night
          ? "inset 0 1px 0 rgba(255,244,200,0.2), 0 0 0 1px rgba(232,197,106,0.15)"
          : "inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 3px rgba(180,140,30,0.18)",
      }}
    >
      <span
        aria-hidden
        className="block h-3.5 w-3.5 rounded-full"
        style={{
          background: night
            ? "radial-gradient(circle at 35% 30%, #fff6d2, #e8c56a 46%, #8a6410)"
            : "radial-gradient(circle at 35% 30%, #3a3324 0 46%, #e8c56a 47% 62%, #0c0b09 63%)",
          boxShadow: night ? "0 0 8px rgba(232,197,106,0.65)" : "0 0 0 1px rgba(90,60,8,0.35)",
        }}
      />
    </button>
  );
}
