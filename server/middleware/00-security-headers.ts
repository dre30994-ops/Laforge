import { SECURITY_HEADERS } from "../../src/lib/securityHeaders";

type HeaderBag = { set(name: string, value: string): void };

function applySecurityHeaders(headers: HeaderBag) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
}

/**
 * Apply Privy-aligned CSP + X-Frame-Options on every Nitro response.
 * Vercel CDN/static also gets these via vercel.json.
 */
export default async function securityHeadersMiddleware(
  event: { res?: { headers?: HeaderBag } },
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (result instanceof Response) {
    const headers = new Headers(result.headers);
    applySecurityHeaders(headers);
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers,
    });
  }
  if (event.res?.headers) applySecurityHeaders(event.res.headers);
  return result;
}
