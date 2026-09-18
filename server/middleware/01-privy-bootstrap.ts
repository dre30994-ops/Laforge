function runtimePrivyAppId(): string {
  const id =
    process.env.VITE_PRIVY_APP_ID ||
    process.env.NEXT_PUBLIC_PRIVY_APP_ID ||
    process.env.PRIVY_APP_ID ||
    process.env.PRIVY_ID ||
    "";
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : "";
}

/**
 * Stamp the Privy app ID into HTML at runtime so the client can read it even
 * when Vite didn't inline VITE_PRIVY_APP_ID at build time.
 */
export default async function privyBootstrapMiddleware(
  _event: unknown,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  const id = runtimePrivyAppId();
  if (!id || !(result instanceof Response)) return result;
  const type = result.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return result;

  const html = await result.text();
  if (html.includes("window.__PRIVY_APP_ID__")) {
    return new Response(html, { status: result.status, statusText: result.statusText, headers: result.headers });
  }
  const snippet = `<script>window.__PRIVY_APP_ID__=${JSON.stringify(id)};</script>`;
  const patched = html.includes("</head>")
    ? html.replace("</head>", `${snippet}</head>`)
    : snippet + html;
  const headers = new Headers(result.headers);
  headers.delete("content-length");
  return new Response(patched, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}
