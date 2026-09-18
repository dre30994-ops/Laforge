function runtimePrivyAppId(): string {
  const id =
    process.env.VITE_PRIVY_APP_ID ||
    process.env.NEXT_PUBLIC_PRIVY_APP_ID ||
    process.env.PRIVY_APP_ID ||
    process.env.PRIVY_ID ||
    "";
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : "";
}

type NitroEvent = { url?: { pathname?: string } };

/**
 * Serve the Privy app ID from Vercel runtime env, and stamp it into HTML.
 */
export default async function privyBootstrapMiddleware(
  event: NitroEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url?.pathname ?? "";
  if (path === "/api/privy-id") {
    return Response.json(
      { appId: runtimePrivyAppId() },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const result = await next();
  const id = runtimePrivyAppId();
  if (!id || !(result instanceof Response)) return result;
  const type = result.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return result;

  const html = await result.text();
  if (html.includes("window.__PRIVY_APP_ID__")) {
    return new Response(html, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
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
