/** Browser-safe public env (Vite `VITE_*` or `NEXT_PUBLIC_*`). */
export function publicEnv(name: string): string {
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  for (const key of [`VITE_${name}`, `NEXT_PUBLIC_${name}`]) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}
