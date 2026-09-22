import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  type Locale,
  LOCALE_STORAGE_KEY,
  chainCopy,
  readStoredLocale,
  translate,
  translateList,
} from "@/lib/i18n";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggle: () => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
  tList: <T>(path: string) => T[];
  chainLabel: (key: string, fallback?: string) => string;
  chainShort: (key: string, fallback?: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang =
      locale === "zh-CN" ? "zh-CN" : locale === "hi" ? "hi" : "en";
    document.documentElement.dataset.locale = locale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const toggle = useCallback(() => {
    setLocaleState((prev) => (prev === "en" ? "zh-CN" : prev === "zh-CN" ? "hi" : "en"));
  }, []);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => translate(locale, path, vars),
    [locale],
  );

  const tList = useCallback(<T,>(path: string) => translateList<T>(locale, path), [locale]);

  const chainLabel = useCallback(
    (key: string, fallback?: string) => chainCopy(t, key, "label", fallback ?? key),
    [t],
  );
  const chainShort = useCallback(
    (key: string, fallback?: string) => chainCopy(t, key, "short", fallback ?? key),
    [t],
  );

  const value = useMemo(
    () => ({ locale, setLocale, toggle, t, tList, chainLabel, chainShort }),
    [locale, setLocale, toggle, t, tList, chainLabel, chainShort],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: "en",
      setLocale: () => {},
      toggle: () => {},
      t: (path, vars) => translate("en", path, vars),
      tList: <T,>(path: string) => translateList<T>("en", path),
      chainLabel: (key, fallback) => fallback ?? key,
      chainShort: (key, fallback) => fallback ?? key,
    };
  }
  return ctx;
}
