# Feature: Telemetry export — consented, hardened upload of run reports

## Problem

Run reports (`01-run-report.md`) stay in the project that produced them. The
plugin is used across many repos, but its maintainers only see this repo's own
runs, so every optimisation is tuned against a sample of one. There is no way
for a consuming project to share how the pipeline behaved for it, and no way
for it to say no.

## Users

- **Consuming-project owners**, who decide whether their repo shares run
  metadata, and must be able to decline once and trust that nothing leaves.
- **Plugin maintainers**, who need reports from many repos to find real
  patterns.

## Outcome

The first time a consuming project runs `/agentic-sdlc:plan` or
`/agentic-sdlc:build`, it is asked once whether to share run reports. The answer
is written to the project's **checked-in** config, so it is a team decision made
once. If the project opts in, each finished run's report is uploaded to a
maintainer-owned endpoint after the session. If it declines or never answers,
nothing is ever sent. In every case the local report is kept.

## Success metric

- Consent holds: a declined or unanswered project sends 0 bytes, proven by a
  test that fails if any network call is attempted. Must pass in CI.
- Delivery: an opted-in run's report is in storage within a target set by the
  architect (say minutes, not days) after the session ends.
- No harm to sessions: endpoint down, slow or rate-limiting → session exit
  status and duration are unchanged (test with a black-hole endpoint).

## Scope — in

- The consent prompt, asked by the command at first run (hooks cannot ask
  questions interactively), with the answer stored in checked-in project config.
  Declining is remembered. Changing your mind is one config edit.
- An anonymous repo ID made from a salted hash. The repo name, remote URL, user
  and machine are never sent.
- Client upload with zero dependencies: one HTTPS POST of the run report, which
  is already code-free by schema.
- A client-generated run ID on every report, used as the idempotency key.
- Outcome events (`04-mode-selection.md`) that a later run appends to an
  earlier run's decision. They are exported as they arrive, under the same
  consent, and keyed by decision ID, so storage can join them to the original
  decision.
- Client behaviour that does not hurt sessions or overload the endpoint: short
  timeout, never blocking, always exiting 0, jittered send, backoff on 429 and
  5xx, a capped local queue, batching, and a server-side kill switch the client
  obeys.
- The v1 ingest endpoint and storage, hardened per the threat model below.
- An identity tier for clients (see Open questions).

## Scope — out

- Per-developer consent (`settings.local.json`-only opt-in).
- Opt-out or on-by-default sharing.
- Uploading raw transcripts, meter internals beyond the report, or any free
  text.
- Reading, aggregating or acting on the data (that is `03-signal-routine.md`).
- Dashboards, or any read API for consuming projects.
- GitHub-verified identity (OIDC / GitHub App). It may come later as a
  higher-trust tier.

## Value dependency

It depends on `01-run-report.md` (the schema is what gets sent). On its own it
delivers a consented, hardened pipe with data landing in storage. That is
useful even before `03-signal-routine.md` ships, because maintainers can query the
store by hand. The consent flow and the endpoint can be built in parallel
against the report schema.

## Technical context

- Existing systems this must integrate with: the `01-run-report.md` output in
  `.agentic-sdlc/runs/`; the hook templates in `templates/hooks/`; the
  consuming-project setup in `docs/setup.md`.
- Hard constraints:
  - Client: plain Node 22, no dependencies, tested by a `scripts/<name>.test.sh`.
  - Storage: minimal footprint and easy to integrate. Clients only write; no
    client SDK; no credential setup per repo beyond what opt-in issues
    automatically.
  - The ingest service is maintainer infrastructure, not plugin content. It does
    not live under `plugins/`.
- Threat model (hard requirements on whatever backend is chosen). Any secret
  shipped in the plugin is public, so the design limits damage rather than
  assuming it can keep attackers out:
  - **Volumetric DDoS:** the endpoint sits behind an edge network with DDoS
    protection; rate limits per IP and per client token at the edge; the store
    is never directly reachable.
  - **Cost exhaustion:** hard spend caps with alerts; prefer no egress fees;
    over quota → 429 and drop (fail closed); request body capped at around
    16 KB.
  - **Hostile payloads:** strict schema check at the edge. Known schema
    versions only, enum fields only, numbers within limits, unknown fields
    rejected.
  - **Replay or duplicates:** the run ID is an idempotency key; first write
    wins.
  - **Fake repos (poisoning):** per-token contribution caps and token age are
    recorded, so `03-signal-routine.md` can weight by them.
  - **Our own clients overloading us:** jitter, backoff, batching, kill switch
    (see Scope — in).
- Deployment target: decided by the architect (see Open questions).

## Constraints

- Data / compliance: consent is opt-in only and recorded in the repo. The
  payload is code-free by construction (`01-run-report.md`). The repo ID cannot be
  reversed to the repo name. Document exactly what is sent in `docs/setup.md`,
  next to the consent prompt.

## Open questions

- **ARCH — storage and ingest backend.** For example: a small edge function
  writing to an object store, a GitHub-backed store, or something else that
  meets the constraints and threat model above. Where does its code live (a
  directory in this repo outside `plugins/`, or a sibling repo), and how is it
  deployed?
- **ARCH — client identity tier.** Suggested default: a registration token
  issued at opt-in by a strictly rate-limited `/register` call, tied to the
  repo ID, and kept out of checked-in config (for example in local settings or
  the keychain). It enables per-token quotas, revocation and token age. The
  alternatives are fully anonymous with rate limits only, or GitHub-backed
  identity.
- Which lifecycle point sends the upload: `SessionEnd`, the next
  `SessionStart` (to drain a queue), or both?
- How long is data kept in storage, and how does a project that later opts out
  get its data deleted?
- Does consent need to be asked again when the schema version changes?
