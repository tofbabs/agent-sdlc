# Telemetry ingest Worker

Cloudflare Worker + D1 behind the v1 wire contract in
`docs/adr/0003-telemetry-ingest-backend-identity-and-retention.md`.
`src/handler.mjs` is pure and tested under plain Node (`scripts/ingest.test.sh`);
`src/worker.mjs` only adapts D1 to it.

## One-time setup (human)

1. `npx wrangler d1 create agentic-sdlc-ingest`, then put the id in
   `wrangler.toml` (`REPLACE_WITH_D1_DATABASE_ID`).
2. Choose the custom hostname and replace `REPLACE_WITH_INGEST_HOSTNAME` and
   `REPLACE_WITH_ZONE` in `wrangler.toml`. **workers.dev stays disabled
   (`workers_dev = false`); the custom hostname is the only entry point**, so
   the WAF rule below cannot be bypassed.
3. `npx wrangler secret put IP_SALT` (any long random string; it is mixed with
   the UTC day before hashing IPs for `/v1/register` limiting, so no IP is stored).
4. Add the repository secret `CLOUDFLARE_API_TOKEN` (Workers + D1 edit).

## WAF rate-limiting rule (configuration, not code)

On the custom hostname, rate limiting rule:

- expression: URI path starts with `/v1/`
- characteristics: IP
- limit: **20 requests per 10 seconds**, action: block

Per-IP flooding is stopped here, before the Worker runs. The Worker enforces
the per-token daily cap (100 accepted reports) and the `/v1/register` limits
(1 per daily-salted IP hash per 60 s, 500 per UTC day).

## Kill switch

Set `KILL_SWITCH = "on"` in `wrangler.toml` and deploy: `/v1/register` and
`/v1/reports` answer `503 {"stop":true}` with `Retry-After`.

## Manual query

```sh
npx wrangler d1 execute agentic-sdlc-ingest --remote \
  --command "SELECT count(*) AS reports, count(DISTINCT repo_id) AS repos FROM reports"
```

## Deploy

`.github/workflows/ingest-deploy.yml` runs on pushes to `main` touching
`ingest/**` or the shared schema/vocabulary modules: tests, D1 migrations,
then `wrangler deploy`.
