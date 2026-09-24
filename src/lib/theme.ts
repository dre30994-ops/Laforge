export type ThemeName = "day" | "night";

const KEY = "laforge.theme";

let theme: ThemeName = "day";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function applyTheme(next: ThemeName) {
  theme = next;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = next;
  }
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode */
  }
  emit();
}

/** Read the saved choice. Safe to call after hydration. */
export function hydrateTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    saved = null;
  }
  applyTheme(saved === "night" ? "night" : "day");
}

export function toggleTheme() {
  applyTheme(theme === "night" ? "day" : "night");
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTheme() {
  return theme;
}
