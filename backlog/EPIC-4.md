# EPIC-4: Telemetry export — consented, hardened upload of run reports

- Outcome: an opted-in project's finished-run reports (schema 1, ADR-0001/0002)
  land in maintainer-owned storage within minutes of session end; a declined
  or silent project sends zero bytes, provably; a down or hostile endpoint
  never changes a session's own exit status or duration.
- Success metric: 0 bytes from a non-opted-in repo (CI test, network call
  fails the build if attempted); opted-in delivery latency p95 ≤ 5 minutes
  from `run.ended_at` to the store's `received_at` (ARCH-1, ADR-0003);
  black-hole-endpoint test shows unchanged
  session exit/duration.
- Status: TODO
- Artifacts: docs/adr/0003-telemetry-ingest-backend-identity-and-retention.md, docs/briefs/self-improvement/02-telemetry-export.md, docs/briefs/self-improvement/README.md

## Architect handoffs

| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Storage and ingest backend meeting the threat model below; where its code lives (this repo outside `plugins/`, or a sibling repo) and how it deploys; the delivery-latency target | STORY-4-3, STORY-4-5, STORY-4-8, STORY-4-9 | RESOLVED |
| ARCH-2 | Client identity tier: brief's suggested default is a `/register`-issued token tied to repo ID, kept out of checked-in config (local settings or keychain), vs. fully anonymous + rate limits only, vs. GitHub-backed identity | STORY-4-3, STORY-4-5, STORY-4-8 | RESOLVED |
| ARCH-3 | Upload lifecycle point: `SessionEnd`, the next `SessionStart` draining a queue, or both | STORY-4-4 | RESOLVED |
| ARCH-4 | Retention period in storage, and the deletion-on-opt-out mechanism (how a project that flips to declined gets its prior uploads removed) | STORY-4-9 | RESOLVED |
| ARCH-5 | Does opt-in consent need to be asked again when the report schema version bumps, and if so how is "already consented to an older schema" tracked in checked-in config | STORY-4-7 | RESOLVED |

Context for ARCH-1/ARCH-2 (brief's "Technical context" and "Threat model"
sections): edge DDoS protection with per-IP/per-token rate limits, the store
never directly reachable; hard spend caps, no egress fees preferred, 429 +
drop over quota, ~16 KB body cap; strict schema check at the edge against
`run-report-categories.mjs`'s vocabulary, unknown fields/values rejected;
`run_id` as idempotency key, first write wins; per-token contribution caps and
token age recorded for later weighting; a server-side kill switch the client
obeys. Why these are handoffs, not local calls: each picks a vendor/datastore
or a trust boundary nothing in the codebase has an example of, and the choice
is a one-way door once repos are sending real data to it.

### ARCH-1: Storage and ingest backend, code location, deployment, latency target
- status: RESOLVED
- reversibility: ONE-WAY → `docs/adr/0003-telemetry-ingest-backend-identity-and-retention.md`
- category: dependency (run-report-categories.mjs)

**Decision:**
- **Platform.** A Cloudflare Worker with D1 (SQLite), on the Workers
  **Free** plan.
- **Code.** The code lives in `ingest/` at this repo's root, outside
  `plugins/`. The edge validator imports a new pure module,
  `plugins/agentic-sdlc/scripts/run-report-schema.mjs`. That module holds
  `REPORT_SCHEMA` and its validation walk, extracted from `run-report.mjs`,
  and `run-report.mjs` imports it too.
- **Deploy.** `.github/workflows/ingest-deploy.yml` deploys on push to
  `main` when `ingest/**`, the schema module or the vocabulary module
  changes.
- **Routing.** The Worker is reachable only on a custom hostname in a
  Cloudflare-proxied zone. `workers.dev` is disabled.
- **Latency target.** p95 ≤ 5 minutes from `run.ended_at` to the store's
  `received_at`, for an online client against a healthy endpoint. During an
  outage, the target is the first SessionStart drain after recovery.

**Why:**
- **Spend.** The Free plan hard-stops on quota instead of billing, so it is
  the hard $0 cap the threat model wants. It has no egress fees, and DDoS
  mitigation is always in front.
- **Fit.** D1 gives first-write-wins, scoped delete and retention as single
  statements, and maintainers can query it by hand.
- **Lockstep.** In-repo code means one PR changes the vocabulary and the
  validator together. Deploying on merge means the validator is live before
  release-please ships the client, which is ADR-0001's lockstep requirement
  met by ordering.

**Note:**
- **Contract.** The full wire contract, limits and table shapes are in
  ADR-0003. Build against it, not against this summary.
- **Hostname (human input).** The maintainers must pick the hostname before
  the first client release that enables export. The client carries it as a
  constant with an `AGENTIC_SDLC_EXPORT_URL` override.

### ARCH-2: Client identity tier
- status: RESOLVED
- reversibility: ONE-WAY (part of the wire contract) → ADR-0003
- category: security (run-report-categories.mjs)

**Decision:**
- **Scheme.** The brief's default: a per-clone opaque token (32 random bytes,
  base64url), issued by `POST /v1/register {"repo_id"}`.
- **Server side.** The server stores only `sha256(token)`, the repo ID and
  `created_at`. It derives the repo ID from the token on every later call;
  the client never re-asserts it.
- **Client side.** The token is stored at
  `<git common dir>/agentic-sdlc/export/token.json`, mode 0600, never
  checked in and never in `settings.local.json`.

**Why:**
- **What it buys.** Revocation, per-token contribution caps, token age for
  03's weighting, and a deletion request the server can scope without
  trusting a client-asserted repo ID.
- **Against anonymous.** Anonymous gives none of that at no lower cost.
- **Against GitHub identity.** It is out of scope per the brief.
- **Storage location.** The git common dir follows ADR-0002's store pattern:
  one token per clone, shared by every worktree, so `/build`'s worktrees do
  not each register.

**Note:**
- **Not the keychain.** The token can only write telemetry for, and delete,
  its own repo ID, so a keychain integration is not worth the cost. See
  Debt.
- **On 401.** A 401 on upload means delete the token and re-register once
  on the next send.

### ARCH-3: Upload lifecycle point
- status: RESOLVED
- reversibility: TWO-WAY
- category: lifecycle (run-report-categories.mjs)

**Decision:** Both SessionEnd and SessionStart.

- **SessionEnd** is the primary send. `run-report.sh`'s existing detached
  spawn becomes a sequential chain:
  1. `run-report.mjs report` runs.
  2. Only then, and only if consent reads `true` at current terms (ARCH-5),
     the export script enqueues that report and flushes, with 0 to 10 s of
     jitter.
- **SessionStart** drains whatever SessionEnd could not send, after 0 to
  60 s of jitter. A new `SessionStart` entry for `run-report.sh` goes in
  `templates/hooks/settings.hooks.json`. Its bash check is "queue dir
  non-empty, or revoke pending", run before node is started. Otherwise it
  exits at once.

**Why:**
- **SessionEnd alone** loses anything sent while the endpoint is down, or
  when the machine sleeps mid-send.
- **SessionStart alone** pushes delivery to the next session, which can be
  days away. That misses the 5-minute target.

**Note:**
- **Revoke dispatch.** Both points also dispatch the revoke path (ARCH-4)
  when the stored answer is `false` and a token exists on this clone.
- **Queue location.** The queue lives at
  `<git common dir>/agentic-sdlc/export/queue/`. A drain from any worktree
  then sends any worktree's reports.
- **Upgrade path.** A project that has not re-merged the hook template keeps
  SessionEnd delivery and loses only the drain, so this is a `feat:`, not a
  `feat!:`.

### ARCH-4: Retention and deletion-on-opt-out
- status: RESOLVED
- reversibility: ONE-WAY (a promise made in `docs/setup.md`) → ADR-0003
- category: data (run-report-categories.mjs)

**Decision:**
- **Retention.** 90 days from `received_at`, enforced by a daily Cron
  Trigger that also drops tokens unseen for 90 days and counters older than
  2 days.
- **Opt-out.** When the checked-in answer flips to `false` on a clone that
  holds a token, that clone's next SessionEnd or SessionStart issues
  `DELETE /v1/repo` (bearer token). This deletes every report and token for
  the token's repo ID and nothing else.
- **Local cleanup.** The clone deletes its local token and queue only after
  a `204` or `401`.
- **Kill switch.** It never blocks the delete.

**Why:**
- **Per-clone IDs.** The repo-ID salt is per clone (see ADR-0003, "Repo ID
  scope"). A checked-in salt would let anyone, including the maintainers,
  link a public repo's ID to its name by code search.
- **Two-part guarantee.** Because IDs are per clone, the delete covers the
  clones that run again, and the 90-day retention backstops the rest. That
  is why retention is 90 days and not longer.

**Note:**
- **`docs/setup.md` wording.** It must say three things:
  - deleted immediately from each clone that runs again;
  - all data gone within 90 days regardless;
  - D1 Time Travel keeps point-in-time history for 7 days (Free plan), so
    deleted data is unrecoverable within 7 days of deletion.
- **Zero bytes means no token.** A clone with no token (never opted in, or
  already revoked) sends zero bytes. That is the state the zero-bytes tests
  prove. Revocation is one user-requested call, not an upload.

### ARCH-5: Re-consent on schema version bump
- status: RESOLVED
- reversibility: TWO-WAY
- category: contract (run-report-categories.mjs)

**Decision:**
- **Not tied to the schema.** Consent ignores the `schema` integer and is
  tied to a **terms** integer instead. Terms 1 covers only enum tokens,
  numbers, booleans, and the pattern-bounded strings in `PATTERNS` today
  (`uuid_v4`, `semver`, `iso_utc_seconds`, `decision_id`), plus the hashed
  repo ID sent at `/register`.
- **Where terms live.** `run-report-categories.mjs` gains `TERMS = 1` and the
  pattern list terms 1 covers. A test fails when any key is added to
  `PATTERNS` without bumping `TERMS` and the list together.
- **Checked-in config.** It records `terms: <n>` beside every `true` answer.
- **Stale terms.** A stored `true` with `terms` below current is treated as
  unanswered. No upload happens, STORY-4-1's existing prompt re-asks, and
  nothing is deleted, because data sent under the old terms was consented.
- **Declines stay declined.** A `false` answer is never re-asked.

**Why:**
- **Schema bumps can only narrow.** Under ADR-0001 a bump means a removal,
  a rename or a changed meaning, and that cannot widen what leaves the repo.
- **Additive changes can widen, but none is a bump.** Adding a field is
  additive. So tying consent to `schema` would re-ask when nothing widened
  and stay silent when something did.
- **What actually widens.** The only thing that widens what a consenter
  agreed to is a new kind of string crossing the wire. That is mechanically
  detectable at the vocabulary module.

**Note:**
- **No new prompt code.** The comparison makes stale consent look
  unanswered, and STORY-4-1's prompt does the rest.

## Stories

### STORY-4-1: First-run consent prompt, checked-in config, and documented payload

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): score 4 at or above 4 is PAIR
- estimate: M
- select: risk_class=none@brief:L21-L25 one_way_doors=0@brief:L21-L25 existing_pattern=no@brief:L38-L40 modules_crossed=2@brief:L38-L40 review_bounced=no@brief:L38-L40 risk_kind=code@brief:L38-L40
- depends_on: []
- blocked_by_arch: []

**As a** consuming-project owner
**I want** to be asked once, at first `/plan` or `/build`, whether my project
shares run reports
**So that** the decision is my team's, made once, and visible in version
control

**Acceptance criteria**
1. Given a project with no prior answer recorded, when `/agentic-sdlc:plan` or
   `/agentic-sdlc:build` first runs, then the command asks the consent
   question and writes the answer to checked-in project config (not
   `settings.local.json`).
2. Given a project that already has an answer recorded, when either command
   runs again, then no prompt appears and the stored answer is read as-is.
3. Given a decline or no answer, when any run finishes, then no network call
   to the export endpoint is attempted (proven by a test that fails the build
   if one is).
4. `docs/setup.md` states, next to the consent prompt's description, exactly
   what fields are sent (the schema-1 report, code-free by construction) and
   that the local report is always kept regardless of the answer.

**Technical notes**
- Hooks cannot ask interactive questions (`CLAUDE.md`, `templates/hooks/`) —
  the prompt belongs in the `/plan`/`/build` command, not a hook.
- Config file is a new checked-in key, sibling to existing `.claude/settings.json`
  conventions; do not reuse `settings.local.json` (that is per-developer scope,
  explicitly out of scope per the brief).
- Changing your mind is a one-line config edit — document that in the same
  `docs/setup.md` section.

**Out of scope**
- Re-asking on schema version change (ARCH-5, STORY-4-7).
- Anything about what happens after opt-in reaches true (that's STORY-4-3+).

---

### STORY-4-2: Anonymous repo ID from a salted hash

- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 0 at or below 2 is SOLO
- estimate: S
- select: risk_class=none@brief:L41-L42 one_way_doors=0@brief:L41-L42 existing_pattern=yes@brief:L41-L42 modules_crossed=1@brief:L41-L42 review_bounced=no@brief:L41-L42 risk_kind=code@brief:L41-L42
- depends_on: []
- blocked_by_arch: []

**As a** plugin maintainer
**I want** every uploaded report tagged with a repo ID that cannot be reversed
to the repo's name, remote, user or machine
**So that** cross-repo signal is possible without identifying any one project

**Acceptance criteria**
1. Given a repo with no prior ID, when the ID is first derived, then it is a
   salted hash with no reversible path back to repo name, remote URL, OS user,
   or machine identity.
2. Given the same repo on a later run, when the ID is derived again, then it
   is byte-identical (deterministic, cached — not re-salted per run).
3. A leak-proof test asserts none of repo name, remote URL, user, or hostname
   appear anywhere in the derived ID or its inputs' plaintext form once
   hashed.

**Technical notes**
- Plain Node 22, zero dependencies, its own `scripts/<name>.test.sh`
  (`CLAUDE.md` shipped-script convention).
- Salt storage/rotation is a local implementation detail, not an ARCH
  question — follow `run-report.mjs`'s existing pattern for where
  machine/project-local artifacts live.

**Out of scope**
- The identity *token* used against the ingest endpoint (ARCH-2, STORY-4-5) —
  this is the repo ID carried inside the payload, a different thing.

---

### STORY-4-3: Client upload module — zero-dependency, non-blocking, hardened

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): score 4 at or above 4 is PAIR
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: L
- select: risk_class=none@brief:L50-L53 one_way_doors=0@brief:L50-L53 existing_pattern=no@brief:L50-L53 modules_crossed=2@brief:L50-L53 review_bounced=no@brief:L50-L53 risk_kind=code@brief:L50-L53
- depends_on: [STORY-4-2]
- blocked_by_arch: [ARCH-1, ARCH-2]

**As a** plugin maintainer
**I want** a client that posts one report (or a batch), never slows or fails a
session, and backs off under load
**So that** opted-in uploads are safe for every consuming project and for the
endpoint itself

**Acceptance criteria**
1. Given the endpoint is slow, down, or black-holed, when an upload is
   attempted, then the call always returns within a short, fixed timeout and
   the caller's exit path is unaffected (test with a black-hole endpoint).
2. Given a 429 or 5xx response, when the client retries, then it backs off
   (not immediate retry) and respects a capped local queue rather than
   growing unbounded.
3. Given the server signals its kill switch, when the client next runs, then
   it stops sending until the signal clears.
4. Given the same run ID is sent twice, when both reach the endpoint, then the
   client marks it as the same idempotent unit (server dedupes on first
   write — this story proves the client always includes the run ID).
5. Sends are jittered and may batch; the module has zero dependencies and its
   own `scripts/<name>.test.sh`.

**Technical notes**
- Depends on ARCH-1 (endpoint URL/contract, request shape) and ARCH-2
  (how identity is attached to a request) — do not start the request-shaping
  parts until both resolve; the queue/backoff/timeout machinery can be built
  and tested against a local stub endpoint first.
- Report body is already code-free by schema (ADR-0001) — this module adds no
  new free-text fields.

**Out of scope**
- Deciding *when* in the session lifecycle this runs (ARCH-3, STORY-4-4).
- The `/register` call itself (STORY-4-5).

---

### STORY-4-4: Wire upload into the session lifecycle

- status: TODO
- estimate: M
- select: risk_class=none@brief:L128-L129 one_way_doors=1@brief:L128-L129 existing_pattern=yes@brief:L128-L129 modules_crossed=2@brief:L128-L129 review_bounced=no@brief:L128-L129 risk_kind=code@brief:L128-L129
- depends_on: [STORY-4-3]
- blocked_by_arch: [ARCH-3]

**As a** consuming-project owner
**I want** my opted-in run's report uploaded automatically, at the point the
architect chose
**So that** nothing has to be run by hand and the session is never held up by
it

**Acceptance criteria**
1. Given opt-in is true and a finished run's report exists, when the chosen
   lifecycle point (ARCH-3) fires, then the upload is attempted detached,
   following `run-report.sh`'s existing detached/budget-shared pattern for
   that hook event.
2. Given opt-in is false or unanswered, when any lifecycle hook fires, then
   the upload path is never entered (not attempted-and-skipped — entirely
   unreached, provable by the same zero-bytes test as STORY-4-1 AC3).
3. Given the hook's shared time budget, when the upload is invoked, then it
   never blocks the hook past that budget (detached spawn, same as
   `run-report.sh`'s `report` call).

**Technical notes**
- `templates/hooks/run-report.sh` and `templates/hooks/settings.hooks.json`
  are the pattern to extend, not replace.
- If ARCH-3 picks "both", this story covers wiring both trigger points; if it
  picks one, only that one.

**Out of scope**
- The upload module's internals (STORY-4-3).

---

### STORY-4-5: Client identity — registration and token storage

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: M
- select: risk_class=none@brief:L122-L127 one_way_doors=1@brief:L122-L127 existing_pattern=no@brief:L122-L127 modules_crossed=2@brief:L122-L127 review_bounced=no@brief:L122-L127 risk_kind=code@brief:L122-L127
- depends_on: [STORY-4-2]
- blocked_by_arch: [ARCH-1, ARCH-2]

**As a** plugin maintainer
**I want** each client to carry whatever identity ARCH-2 picked, issued and
stored the way ARCH-2 specifies
**So that** per-client quotas, revocation and token age are possible without
widening what a consuming project must set up

**Acceptance criteria**
1. Given ARCH-2 picks the token default, when a project opts in for the first
   time, then a `/register` call (rate-limited at the edge per ARCH-1) issues
   a token tied to the repo ID, stored outside checked-in config (local
   settings or keychain per ARCH-2).
2. Given a token already exists, when a later run uploads, then it reuses the
   stored token rather than re-registering.
3. Given ARCH-2 instead picks anonymous-only or GitHub-backed identity, then
   this story's acceptance criteria are rewritten to that scheme before build
   (the AC above assumes the suggested default; the architect's actual
   answer governs).

**Technical notes**
- "No credential setup per repo beyond what opt-in issues automatically" is a
  hard constraint from the brief — do not add a manual step for the project
  owner.

**Out of scope**
- Server-side `/register` implementation and its rate limit (STORY-4-8).

---

### STORY-4-6: Outcome events export

- status: TODO
- estimate: M
- select: risk_class=none@brief:L46-L49 one_way_doors=0@brief:L46-L49 existing_pattern=yes@brief:L46-L49 modules_crossed=1@brief:L46-L49 review_bounced=no@brief:L46-L49 risk_kind=code@brief:L46-L49
- depends_on: [STORY-4-3]
- blocked_by_arch: []

**As a** plugin maintainer
**I want** `outcome_events` a later run appends to an earlier run's decision
(ADR-0002) exported under the same consent, keyed by `decision_id`
**So that** storage can join an outcome to the decision it closes without any
extra client logic

**Acceptance criteria**
1. Given a run's report carries an `outcome_events` section (ADR-0002
   amendment to schema 1), when the project is opted in, then those events
   upload through the same client path as the rest of the report — no second
   consent check, no second endpoint.
2. Given opt-in is false, when outcome events exist locally, then none are
   exported (same zero-bytes guarantee as the rest of the report).
3. Events are keyed by `decision_id` only — no story ID, run ID of the
   origin run, or other identity-tuple field crosses the wire (ADR-0002: the
   tuple stays local, the hash is the exportable face).

**Technical notes**
- This rides inside the same report payload STORY-4-3 already sends; it is
  not a separate upload call. Confirm the report builder (`run-report.mjs`,
  already shipping `outcome_events` per ADR-0002) needs no change here before
  writing code — if the field is already populated, this story is wiring-only.

**Out of scope**
- Changing the local decision store (`<git common dir>/agentic-sdlc/decisions/`)
  — that is ADR-0002's local record, untouched by export.

---

### STORY-4-7: Re-consent on schema version change

- status: TODO
- estimate: S
- select: risk_class=none@brief:L132 one_way_doors=0@brief:L132 existing_pattern=no@brief:L132 modules_crossed=1@brief:L132 review_bounced=no@brief:L132 risk_kind=code@brief:L132
- depends_on: [STORY-4-1]
- blocked_by_arch: [ARCH-5]

**As a** consuming-project owner
**I want** the consent I gave to a particular report schema to stop silently
covering a later, different schema if the architect decides it should
**So that** my team's opt-in never quietly widens to data it never agreed to

**Acceptance criteria**
1. Given ARCH-5 decides re-consent is required, when the report schema bumps
   (ADR-0001 versioning policy), then the next run re-prompts and records
   which schema version the stored consent covers.
2. Given ARCH-5 decides re-consent is not required, when the schema bumps,
   then this story instead adds a test proving consent is schema-version
   agnostic by design, and no prompt code is added.
3. Whichever way ARCH-5 resolves, the stored config makes the covered schema
   version (or its absence) legible to a human reading the file, not only to
   code.

**Technical notes**
- A purely additive schema change (new optional fields/enum values) is
  explicitly *not* a bump under ADR-0001 — this story only fires on an actual
  bump, not every report.

**Out of scope**
- The schema-bump mechanics themselves (ADR-0001/ADR-0002 territory).

---

### STORY-4-8: v1 ingest endpoint — hardened edge validation

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: L
- select: risk_class=none@brief:L88-L105 one_way_doors=1@brief:L88-L105 existing_pattern=no@brief:L88-L105 modules_crossed=3@brief:L88-L105 review_bounced=no@brief:L88-L105 risk_kind=code@brief:L88-L105
- depends_on: []
- blocked_by_arch: [ARCH-1, ARCH-2]

**As a** plugin maintainer
**I want** the ingest endpoint to reject anything outside the known schema and
enforce the threat-model limits before a byte is stored
**So that** a hostile or malformed client cannot cost money, corrupt storage,
or leak more than the schema allows

**Acceptance criteria**
1. Given a request with an unknown schema version, an unknown enum value, an
   unbounded/oversized string field, a body over ~16 KB, or an extra unknown
   field, when it reaches the edge, then it is rejected before storage is
   touched, validated against the same `run-report-categories.mjs` vocabulary
   the client/report builder uses.
2. Given a request over the per-IP or per-token rate limit, when it arrives,
   then the edge returns 429 and drops it (fail closed), without reaching the
   store.
3. Given two requests with the same `run_id`, when both are accepted by rate
   limiting, then storage keeps only the first write (idempotent on `run_id`).
4. Given the registration/token flow ARCH-2 picked, when `/register` is
   called beyond its own strict rate limit, then it also 429s.
5. The service's code lives per ARCH-1's answer, outside `plugins/`
   (`CLAUDE.md`: "the ingest service is maintainer infrastructure... does not
   live under `plugins/`").

**Technical notes**
- This is the server half of STORY-4-3/4-5's client contract — build against
  the same `run-report-categories.mjs` vocabulary so edge and client never
  diverge on what's valid.
- Spend caps/alerts and DDoS-network placement are ARCH-1's architecture;
  this story implements within whatever platform ARCH-1 names.

**Out of scope**
- Retention and deletion (STORY-4-9).
- Any read/query API (explicitly out of scope in the brief; that's
  `03-signal-routine.md`'s problem).

---

### STORY-4-9: Storage retention and deletion-on-opt-out

- status: TODO
- estimate: M
- select: risk_class=destructive_data@brief:L130-L131 one_way_doors=1@brief:L130-L131 existing_pattern=no@brief:L130-L131 modules_crossed=2@brief:L130-L131 review_bounced=no@brief:L130-L131 risk_kind=data@brief:L130-L131
- depends_on: [STORY-4-8]
- blocked_by_arch: [ARCH-1, ARCH-4]

**As a** consuming-project owner who later opts out
**I want** my project's prior uploads actually removed from storage, within
the retention policy the architect set
**So that** declining is not just "no new data" but "my old data goes away
too"

**Acceptance criteria**
1. Given ARCH-4's retention period, when data in storage exceeds it, then it
   is deleted (automatically, per the architect's mechanism) without a
   manual step.
2. Given a project flips its checked-in config from opted-in to declined,
   when the next run observes the flip, then a deletion request for that
   project's prior uploads (keyed by repo ID) is issued per ARCH-4's
   mechanism, and this is documented in `docs/setup.md` next to the consent
   section.
3. A test proves a deletion request actually removes the targeted repo ID's
   records and no others (scoped, not a wholesale wipe).

**Technical notes**
- This is destructive by nature (risk_class=destructive_data) — pair review
  on the deletion path is expected regardless of what the mode-selector
  scores, per existing floor conventions.
- Depends on STORY-4-8's storage existing first.

**Out of scope**
- Any self-serve deletion UI for the project owner — the mechanism per ARCH-4
  may be as simple as a flag flip triggering a server-side sweep; no new
  surface is implied beyond what ARCH-4 specifies.
