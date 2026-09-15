# Saved Suggestions (for later implementation)

Project: `C:\Users\dre30\Projects\test4` — Laforge Staking Terminal (Next.js app under `app/`).

---

## 1. Environment variable configuration (the "Factory address is not configured" fix)

Root cause of the `Factory address is not configured (NEXT_PUBLIC_STAKING_FACTORY)` message in the Pools card view (`PoolDirectory` on `/dashboard`): there is **no `app/.env.local` file**, so all `NEXT_PUBLIC_*` vars are unset.

How the message happens:
- `app/src/lib/factoryClient.ts` line 22: `export const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_STAKING_FACTORY ?? "";`
- `app/src/components/PoolDirectory.tsx`: `const factoryConfigured = !!FACTORY_ADDRESS;` — if false, renders the "not configured" EmptyCard.
- `factoryClient.ts` also validates with `isAddress()`; throws if unset or malformed.

Fix steps:
1. Create `app/.env.local` (auto-loaded by Next.js, gitignored).
2. Add `NEXT_PUBLIC_STAKING_FACTORY=0xYourDeployedStakingFactoryAddress` (must be a valid EVM address).
3. Restart dev server (`NEXT_PUBLIC_*` are inlined at build time; a running server won't pick up changes until restart via `npm run dev`).

Note: Requires an actual deployed `StakingFactory` contract on the Robinhood/EVM chain. Source: `evm/contracts/StakingFactory.sol`. Deploy first, then use the resulting address.

Other env vars found in code (all currently unset; likely wanted in `app/.env.local`):
- `NEXT_PUBLIC_ROBINHOOD_RPC_URL` — RPC endpoint for the EVM chain (`app/src/lib/chains.ts`).
- `NEXT_PUBLIC_ROBINHOOD_MAINNET=1` — switch to mainnet (default is devnet/testnet) (`app/src/lib/chains.ts`).
- `NEXT_PUBLIC_POOL_META_API` — Cloudflare Worker URL for pool nicknames/images; without it, metadata is localStorage-only (`app/src/lib/poolMeta.ts`).
- `NEXT_PUBLIC_PRIVY_APP_ID` — wallet features via Privy; without it wallet is disabled (`app/src/components/WalletProvider.tsx`).
- `NEXT_PUBLIC_STAKING_MINT` — Solana staking token mint (`app/src/lib/stakingClient.ts`, `usePosition.ts`, stake page).
- `NEXT_PUBLIC_PROGRAM_ID` — Solana program id (`app/src/lib/stakingClient.ts`).
- `NEXT_PUBLIC_RPC_URL` — Solana RPC, defaults to `https://api.devnet.solana.com` (`app/src/hooks/usePosition.ts`, `useStaking.ts`).

Suggested action later: Either create a starter `app/.env.local` with real values, or add a committed `app/.env.example` template documenting all these keys with placeholder comments.

---

## 2. Image upload security/limits — residual TODOs

Already implemented (in `app/src/lib/poolMeta.ts` + `cloudflare/pool-meta-worker/src/index.ts`):
- 15MB max file size, 1000x1000 min resolution.
- Raster allowlist (PNG/JPEG/WebP/GIF); SVG disallowed.
- Magic-byte sniffing on the worker (content-type derived from bytes, not client hint).
- `X-Content-Type-Options: nosniff` on served images.

Residual TODOs flagged but NOT done:
- (a) Worker-side resolution check (currently client-only).
- (b) Optional `Content-Security-Policy` / `Content-Disposition` on `serveImage`, or serving images from a cookieless `IMAGE_PUBLIC_BASE_URL` origin.
- (c) localStorage ~5MB quota can't hold 15MB data URLs offline — would need IndexedDB for offline persistence of large images.
- (d) SVGs fail the 1000x1000 check since they report 0 natural dimensions (moot now that SVG is disallowed).
