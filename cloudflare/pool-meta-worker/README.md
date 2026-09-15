# Pool Metadata Worker (Cloudflare)

A tiny Cloudflare Worker that stores **shared, display-only** metadata for
staking pools — a nickname and an image — keyed by the pool's **token address**.

- **KV** (`POOL_META`) holds the metadata JSON (`{ nickname?, image? }`).
- **R2** (`POOL_IMAGES`) holds the image bytes.
- Startup cost is **$0** on Cloudflare's free tier (KV free reads/writes, R2 with
  no egress fees).

The frontend (`app/src/lib/poolMeta.ts`) calls this Worker and keeps
`localStorage` as an offline cache/fallback, so the UI still works if the
backend is unreachable.

## API

| Method | Path            | Body                                             | Returns |
| ------ | --------------- | ------------------------------------------------ | ------- |
| `GET`  | `/pools`        | —                                                | `{ [token]: { nickname?, image? } }` |
| `GET`  | `/pools/:token` | —                                                | `{ nickname?, image? }` (404 if none) |
| `PUT`  | `/pools/:token` | `{ nickname?, imageBase64?, imageContentType? }` | stored `{ nickname?, image? }` (image = URL) |
| `GET`  | `/images/:key`  | —                                                | image bytes (fallback if no public R2 URL) |

`imageBase64` may be a raw base64 string or a full `data:image/...;base64,...`
data URL. Images are capped at 512 KB.

## One-time setup

From this directory (`cloudflare/pool-meta-worker`):

```bash
npm install
npx wrangler login          # authenticate with your Cloudflare account
```

### 1. Create the KV namespace

The KV namespace is named **`Laforge_cloud`**:

```bash
npx wrangler kv namespace create Laforge_cloud
npx wrangler kv namespace create Laforge_cloud --preview
```

Copy the returned `id` and `preview_id` into `wrangler.toml` under
`[[kv_namespaces]]` (replace the `REPLACE_WITH_...` placeholders). Leave
`binding = "POOL_META"` as-is — that is the name the Worker code uses and does
not need to match the namespace title.

### 2. Create the R2 bucket

```bash
npx wrangler r2 bucket create laforge-bucket
```

(The bucket name already matches `wrangler.toml`.)

### 3. (Optional but recommended) Make images publicly readable

Images are served fastest directly from R2. Enable public access on the bucket:

- In the Cloudflare dashboard: **R2 → laforge-bucket → Settings → Public access →
  enable the `r2.dev` URL** (or attach a custom domain).
- Put that URL in `wrangler.toml` as `IMAGE_PUBLIC_BASE_URL`, e.g.
  `IMAGE_PUBLIC_BASE_URL = "https://pub-xxxxxxxx.r2.dev"`.

If you leave `IMAGE_PUBLIC_BASE_URL` blank, the Worker serves images itself at
`/images/<key>` (works fine, just routes image bytes through the Worker).

### 4. Restrict CORS (optional)

By default `ALLOWED_ORIGINS = "*"`. To lock it to your app, set a
comma-separated list in `wrangler.toml`:

```toml
ALLOWED_ORIGINS = "https://yourapp.com,http://localhost:3000"
```

## Run locally

```bash
npm run dev        # wrangler dev — serves on http://localhost:8787
```

## Deploy

```bash
npm run deploy     # wrangler deploy
```

Wrangler prints the deployed URL, e.g.
`https://pool-meta-worker.<your-subdomain>.workers.dev`.

## Point the frontend at it

In `app/.env.local`:

```bash
NEXT_PUBLIC_POOL_META_API=https://pool-meta-worker.<your-subdomain>.workers.dev
```

Rebuild/restart the Next.js app. If this var is unset, the app silently falls
back to `localStorage`-only (per-browser) metadata.

## Quick smoke test

```bash
# Write
curl -X PUT "$API/pools/0xTOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"Golden Anvil Pool"}'

# Read one
curl "$API/pools/0xTOKEN"

# Read all
curl "$API/pools"
```
