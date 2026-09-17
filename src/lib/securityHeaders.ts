/**
 * Browser security headers for Privy’s embedded-wallet iframe and clickjacking.
 *
 * - CSP `frame-src` / `child-src` allow Privy’s iframe (auth.privy.io / *.privy.io)
 *   plus WalletConnect / Cloudflare Turnstile.
 * - CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY` stop other sites
 *   from embedding Laforge (clickjacking).
 *
 * @see https://docs.privy.io/security/implementation-guide/content-security-policy
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://auth.privy.io https://*.privy.io",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://auth.privy.io https://*.privy.io",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com https://auth.privy.io",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://auth.privy.io https://*.privy.io https://twitter.com https://x.com",
  "frame-ancestors 'none'",
  "child-src https://auth.privy.io https://*.privy.io https://verify.walletconnect.com https://verify.walletconnect.org blob:",
  "frame-src https://auth.privy.io https://*.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://twitter.com https://x.com",
  "connect-src 'self' https: wss: blob: https://auth.privy.io https://*.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
