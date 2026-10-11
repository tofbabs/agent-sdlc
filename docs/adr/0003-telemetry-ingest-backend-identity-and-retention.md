# 0003. Telemetry ingest: Cloudflare Worker + D1, per-clone tokens, 90-day retention

- Status: ACCEPTED
- Date: 2026-10-07
- Reversibility: ONE-WAY (once released clients carry the endpoint URL, the
  wire contract and the token scheme, and once `docs/setup.md` has promised a
  retention period to consuming projects, changing any of them strands
  clients already in the field and breaks a promise already made)
- Resolves: ARCH-1, ARCH-2 and ARCH-4 of `backlog/EPIC-4.md`
- Builds on: ADR-0001 (schema 1, vocabulary module, versioning policy) and
  ADR-0002 (decision IDs, `<git common dir>/agentic-sdlc/` local stores).
  Contradicts neither.

## Context

`02-telemetry-export.md` asks for a maintainer-owned endpoint and store that
opted-in consuming projects write run reports to. The threat model is the
binding constraint. Any secret shipped in the plugin is public, so the design
has to limit damage rather than keep attackers out:

- volumetric DDoS absorbed at an edge, per-IP and per-token limits, the store
  never directly reachable;
- **hard** spend caps, no egress fees, fail closed (429/drop) over quota, a
  body cap of about 16 KB;
- strict schema checks at the edge, using the same vocabulary as the client;
- first write wins on the idempotency key;
- per-token contribution caps and token age recorded for poisoning
  resistance;
- a kill switch the client obeys.

The repo already constrains the answer in several ways:

- the client is plain Node 22 with no dependencies;
- the ingest code must not live under `plugins/`;
- ADR-0001 requires the edge validator to ship in lockstep with any additive
  vocabulary change;
- ADR-0002 already keeps per-clone, cross-worktree state in
  `<git common dir>/agentic-sdlc/`;
- `run-report.mjs` rewrites a run's report at every SessionEnd under the
  same `run_id`, with `run.sessions` incremented. So a bare `run_id` first
  write would keep the least complete version.

Measured: real schema-1 reports in this repo are 1.5 to 2.6 KB
pretty-printed.

## Options

### Platform and store
- **A: Cloudflare Worker + D1 (SQLite) on the Workers Free plan.**
  - The edge network and DDoS mitigation are in front of every request.
  - Free plan quotas hard-stop with errors and never bill (verified
    2026-10-07: 100k requests/day, 10 ms CPU per invocation; D1 100k rows
    written and 5M read per day, 500 MB per database, 7-day Time Travel).
    That makes the plan itself the hard $0 spend cap.
  - No egress charges.
  - D1 has no public endpoint, only the Worker binding and the maintainers'
    account API.
  - SQL gives first-write-wins (`INSERT OR IGNORE`), scoped deletes and
    retention sweeps for free.
  - Maintainers can query by hand with `wrangler d1 execute`.
- **B: Worker + R2 objects.** Also no egress fees, and conditional puts give
  first-write-wins. But scoped deletion becomes prefix listing, and querying
  by hand (the brief's interim value before 03 ships) becomes
  download-and-grep. It is the wrong shape for 2 KB rows that get joined on
  `decision_id`.
- **C: GitHub-backed store (issues, a data repo).** The write credential would
  ship in the plugin, so it would be public. Anyone could write or delete.
  Rejected on the threat model alone.
- **D: AWS (API Gateway + Lambda + S3/DynamoDB).** Has no hard spend cap (only
  budget alerts), egress is metered, and it has more moving parts. Rejected.

### Where the code lives
- **A: `ingest/` at this repo's root, outside `plugins/`.** The validator
  imports the same schema and vocabulary modules the client uses, so one PR
  changes both. A deploy on merge to `main` puts the validator live before
  release-please cuts the client release, which is ADR-0001's lockstep
  requirement satisfied by ordering.
- **B: a sibling repo.** It would need a vendored or synced copy of the
  vocabulary, which is exactly the drift this plugin exists to prevent.

### Identity (ARCH-2)
- **A: per-clone registration token.**
  - Opaque random token, issued by a strictly rate-limited `/register`.
  - Bound server-side to the repo ID sent at registration.
  - Stored only on the clone.
  - Enables per-token caps, revocation, token age, and a deletion request
    scoped to the right repo ID without trusting a client-asserted ID on
    every call.
- **B: anonymous with rate limits only.** No revocation, no contribution caps,
  no token age, so nothing for 03 to weight against poisoning. It is also no
  cheaper to build.
- **C: GitHub-backed identity.** Out of scope per the brief (a later
  higher-trust tier).

### Repo ID scope (constrains STORY-4-2)
- **A: salt checked into the repo, so the ID is stable across clones.**
  Deletion from one clone would cover all clones. But for a public repo,
  anyone, including the maintainers holding the data, could find the salt by
  code search and link an ID to a repo name. That breaks the brief's
  "cannot be reversed" constraint.
- **B: random salt per clone, stored in the git common dir.** The ID is
  stable across all worktrees of one clone and unlinkable to anything public.
  Repo counts overstate by clones, and deletion covers the clone that issues
  it. The retention period bounds everything else.

### Retention and deletion (ARCH-4)
- **A: 90 days** from receipt, enforced by a daily Cron Trigger. Opt-out:
  an explicit delete request from each clone that held a token, with
  retention as the backstop.
- **B: 180 days or more.** Longer history for 03, but opted-out data
  lingers twice as long on clones that never run again.
- **C: retention only, no delete call.** Simpler, but "my old data goes
  away" would mean "eventually".

## Decision

Platform **A** (Cloudflare Worker + D1, Workers Free plan), code **A**
(`ingest/`), identity **A** (per-clone token), repo ID **B** (per-clone
salt), retention **A** (90 days plus an explicit delete).

The two-way-door questions (ARCH-3 lifecycle, ARCH-5 re-consent) are resolved
inline in `backlog/EPIC-4.md`.

### Deployment

- **Layout.**
  - `ingest/` holds `wrangler.toml`, `package.json` (wrangler as its only
    devDependency, with the lockfile committed), `migrations/` (D1 SQL),
    `src/worker.mjs` (the fetch and scheduled entry points) and
    `src/handler.mjs` (pure logic that takes injected `db` and `now`).
  - The no-dependency rule governs shipped `plugins/` scripts. `ingest/` is
    maintainer infrastructure and is never installed by a consuming project.
- **Shared validation.**
  - The validator is the client's own. `REPORT_SCHEMA` and its validation
    walk move out of `run-report.mjs` into a pure module that
    `run-report.mjs` and `ingest/` both import:
    `plugins/agentic-sdlc/scripts/run-report-schema.mjs`. It must import
    nothing from `node:`.
  - `run-report-categories.mjs`'s CLI main-guard must stop pulling
    `node:fs`/`node:url` at top level (lazy import inside the guard, or move
    the guard), so the Worker bundle reaches no `node:` module.
- **Tests.** `scripts/ingest.test.sh` runs the handler under plain Node
  against an in-memory fake `db`. Preflight and CI need neither wrangler nor
  the network.
- **Deploy.**
  - `.github/workflows/ingest-deploy.yml` runs on push to `main` when
    `ingest/**`, `run-report-schema.mjs` or `run-report-categories.mjs`
    change.
  - It runs the ingest tests, `wrangler d1 migrations apply --remote` and
    `wrangler deploy`, using the `CLOUDFLARE_API_TOKEN` repo secret.
  - Merges precede the release-please release that ships the client, so the
    edge always accepts at least what released clients send.
- **Account and domain.**
  - The Cloudflare account stays on the Workers **Free** plan. Upgrading
    to Paid removes the hard cap; see "Revisit if".
  - The Worker is routed **only** on a custom hostname in a
    Cloudflare-proxied zone the maintainers own. The `workers.dev` route is
    disabled, because WAF rules do not apply there and the per-IP layer
    could be bypassed.
  - **Human input needed before the first client release:** the hostname.
    The client carries it as a constant, overridable by
    `AGENTIC_SDLC_EXPORT_URL` for tests.

### Edge limits, in the order they apply

1. **Cloudflare DDoS mitigation.** Always on.
2. **WAF rate-limiting rule (Free plan: one rule, keyed by IP, 10 s
   window).** 20 requests per 10 s per IP on `/v1/*`, blocking for 10 s.
   It runs before the Worker, so a flood does not spend the daily request
   quota.
3. **Worker checks before any D1 write.**
   - The kill switch.
   - `Content-Length` and the actual bytes read, both at most 16384 (413).
   - Token lookup.
   - Per-token daily cap: 100 accepted reports per UTC day, then 429 with
     `Retry-After` until midnight UTC. These counters live in D1 because
     they are exact. The Workers Rate Limiting binding is documented as
     permissive and eventually consistent, so it is not relied on.
   - `/register` caps: 1 per IP per 60 s plus a **global** 500 per UTC day,
     then 429. The global cap bounds mass token-minting.
   - The register per-IP counter keys on a daily-salted IP hash that is
     purged with the counters. No IP is stored.
4. **Free-plan quotas.** Over quota the platform returns errors. The client
   treats those like 5xx, so the system fails closed at $0.

### Wire contract (v1)

**`POST /v1/register`**
- Body: `{"repo_id": "<64 hex>"}`.
- Returns `201 {"token": "<base64url, 32 random bytes>"}`.
- The server stores `sha256(token)`, `repo_id` and `created_at`, never the
  token itself.

**`POST /v1/reports`**
- Headers: `Authorization: Bearer <token>` and `Content-Type:
  application/json`.
- Body: `{"reports": [<schema-1 report>, ...]}`, with 1 to 8 reports and at
  most 16384 bytes, minified. The repo ID is **not** sent. The server takes
  it from the token's record, so a client cannot write under another repo's
  ID.
- Each report is validated in full against `run-report-schema.mjs`: known
  `schema` only, unknown fields or values rejected.
- Responses:
  - `200 {"results": [{"run_id", "sessions", "status":
    "stored|duplicate|rejected"}]}`. A malformed item does not void the
    batch.
  - `400`: malformed envelope.
  - `401`: unknown or revoked token.
  - `413`: body too large.
  - `429` + `Retry-After`: over a limit.
  - `503` + `Retry-After` + `{"stop": true}`: the kill switch.
- **Idempotency key `(run.run_id, run.sessions)`, first write wins.** A
  resumed run's later session is a newer, more complete report, not a
  replay. Consumers take the highest `sessions` per `run_id`. Replays of the
  same pair are deduped.

**`DELETE /v1/repo`**
- Header: `Authorization: Bearer <token>`.
- Deletes every report row and every token whose `repo_id` matches the
  calling token's record. Rows for other repo IDs are untouched.
- Returns `204`. Repeating it returns `401`, which the client treats as
  already done.

**Kill switch.**
- Worker variable `KILL_SWITCH=on`, flipped in the dashboard with no code
  change.
- It answers `503 {"stop": true}` with `Retry-After` on `/v1/register` and
  `/v1/reports`.
- It does **not** block `DELETE /v1/repo`. An opt-out is always honoured
  when the platform is up.

### D1 tables

- **`reports`**: `run_id`, `sessions`, `repo_id`, `token_hash`,
  `received_at`, `schema` and `body` (the validated report, re-serialized),
  with `PRIMARY KEY (run_id, sessions)`.
- **`tokens`**: `token_hash` PK, `repo_id`, `created_at`, `accepted_total`
  and `last_seen_at`. This table records token age and contribution count.
- **`counters`**: `(key, day)` → `n`.

### Retention and deletion

- A daily Cron Trigger deletes:
  - reports with `received_at` older than **90 days**;
  - tokens unseen for 90 days;
  - counters older than 2 days.
- D1 Time Travel keeps point-in-time history for 7 days on the Free plan. So
  `docs/setup.md` must say: deleted data leaves the live store at once and
  is unrecoverable within 7 days.
- On opt-out, every clone that holds a token issues `DELETE /v1/repo` at its
  next lifecycle point. It deletes its local token and queue only after a
  `204` or `401`. Clones that never run again age out within 90 days, so the
  documented guarantee is "immediately from each clone that runs again,
  and within 90 days for all data regardless".
- A delete request is not an upload. A clone with **no** token (never opted
  in, or already revoked) sends zero bytes. That is the state the zero-bytes
  test proves.

### Delivery-latency target

**p95 ≤ 5 minutes** from `run.ended_at` to `received_at`, for an online
client against a healthy endpoint, measurable from the store alone. When the
endpoint is down, the target is the first SessionStart drain after it
recovers.

## Consequences

- Becomes easy:
  - $0 hard-capped infrastructure.
  - One PR changes the vocabulary and the validator together, and deploy
    ordering makes the lockstep automatic.
  - Scoped deletion and retention are single SQL statements.
  - Maintainers can query by hand before 03 exists.
  - ADR-0002's "move the join authority behind the endpoint" has a home.
- Becomes hard:
  - Moving off Cloudflare means a new URL in a client release, plus a period
    where old clients post to a dead endpoint (they back off harmlessly).
  - Cross-clone deduplication of one repo is impossible by design.
  - Free-plan quotas cap throughput at about 30k accepted reports per day
    (three row writes per report).
  - A public repo's clones are unlinkable even for legitimate analysis.

## Revisit if

- Daily accepted reports approach 25k, or the database exceeds 400 MB.
  Either move to Workers Paid with a usage-alert budget (accepting the loss
  of the hard cap), or shorten retention.
- Any day sees Free-plan quota exhaustion, or 429s from the global register
  cap. Either is abuse or real growth, and needs a person to tell which.
- 03 needs cross-clone identity of one repo, which would mean a GitHub-backed
  higher-trust tier (the brief's later tier). It would be a new ADR, not an
  edit to this one.
- A report legitimately exceeds 16 KB (large epics). Cap `build.stories` and
  `review.findings` per ADR-0001's "Revisit if" before raising the body cap.
