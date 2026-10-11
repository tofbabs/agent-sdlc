# 0004. Signal routine: store envelope 1, signal key, and issue fingerprint

- Status: ACCEPTED
- Date: 2026-10-09
- Reversibility: ONE-WAY. Once `02-telemetry-export.md` writes envelopes, a
  reshaped envelope strands stored history. Once fingerprints are stamped into
  public issues, a changed key or hash files a duplicate for every known signal,
  and the shrink check loses its join.
- Resolves: the contract parts of ARCH-1, ARCH-2 and ARCH-4 of `backlog/EPIC-5.md`.
  Thresholds, baselines and the discard-log home stay two-way and live in the epic.
- Works within: ADR-0001 (schema 1, closed vocabulary), ADR-0002 (`decisions`,
  `settlements`). Neither is amended.

## Context

ADR-0001 deliberately gives a report no repo identity. The signal routine,
though, must count distinct repos and weight them by age. A report cannot carry
either fact without breaking ADR-0001, and a client cannot be trusted to state
them truthfully. 02 has no brief yet, so this ADR defines what the routine
needs from any store. It has to work on local fixtures today and not rule out
export later.

The repo is **public**, so everything an issue carries is published. The
fingerprint that makes re-runs idempotent lives in those issues. So does the
tie the shrink check uses.

## Options

### Attribution
- **A: wrap each report in a store-stamped envelope.** Source token, first-seen
  time and receipt time are written by the store, never by the client. ADR-0001
  is untouched, and spoofing a source's age requires compromising the store.
- **B: add a repo/token field to schema 1.** This breaks ADR-0001's privacy
  stance, and the client asserts its own age, which is the attack.

### Signal identity
- **A: positional 6-tuple `(command, lane, mode, event, category, severity)`.**
  It matches the brief's wording. Verdict and outlier signals have no natural
  slot in it, so `*` padding would carry the meaning.
- **B: per-kind canonical key.** A closed `kind` token plus a fixed, ordered
  field list for each kind, with every value a vocabulary token, a small
  integer or `*`.

### Fingerprint carrier
- **A: GitHub search on a body string.** The search index lags, so a quick
  re-run can miss the issue it just filed and create a duplicate.
- **B: a body marker, matched locally.** List every `signal`-labelled issue in
  any state and parse the markers in the script.

## Decision

Attribution **A**, identity **B**, carrier **B**.

### Envelope 1 (the contract with 02)

One JSON object per stored report:

```jsonc
{
  "envelope": 1,
  "source": "<32 lowercase hex>",           // opaque per-install token, hashed by the store; never a repo name
  "source_first_seen": "<iso_utc_seconds>", // stamped by the store on first acceptance of this source
  "received_at": "<iso_utc_seconds>",       // stamped by the store
  "report": { /* ADR-0001 schema 1, re-validated by the routine */ }
}
```

- Unknown fields are rejected. A file over 20 KiB is rejected unread. That is
  ADR-0001's 16 KB body plus headroom for the envelope.
- The routine re-validates `report` by importing the plugin's `validate()`, and
  never copies it.
- `run_id` is the dedupe key. If several envelopes share a `run_id` and a
  `source`, the latest `received_at` wins and the rest are rejected as
  `superseded`. If one `run_id` arrives under two sources, every copy is
  rejected as `run_id_conflict`. This makes replaying another repo's run
  useless, and the result does not depend on input order.
- Rejection reasons are a closed set: `unreadable`, `oversize`, `not_json`,
  `envelope_invalid`, `report_invalid`, `superseded`, `run_id_conflict`.
- **Local mode.** Bare reports from `.agentic-sdlc/runs/` are wrapped with
  `source = sha256("local")[:32]` and `source_first_seen = received_at = file
  mtime`. Local mode gets no threshold exemption. A single source can never
  meet the minimum-repos rule, so on its own its output is the discard log.
- The store is behind a reader adapter (`dir:<path>` today). 02 adds its own
  adapter and must produce envelope 1. It may change how it stores envelopes,
  but not their shape.

### Signal key

`kind` is closed: `finding | arch_handoff | arch_block | debt | outcome |
degraded | outlier | verdict | verdict_drift`. Each kind has a fixed, ordered
field list:

| kind | key fields (in order) | source in the report |
|------|-----------------------|----------------------|
| finding | command, lane, mode, category, severity | `review.findings[]` (finding_category, severity) |
| arch_handoff / arch_block | command, lane, mode, category | `plan.arch_handoffs` / `build.arch_blocks` keys |
| debt | command, lane, mode, category, severity | one key per `debt.by_category` entry with a count > 0; `severity` is always `*` (see below) |
| outcome | command, lane, mode, category | `run.outcome` in {blocked, aborted} |
| degraded | command, lane, category | `degraded[]` token |
| outlier | command, lane, mode, metric | see the metric list below |
| verdict | layer, choice, rubric | `decisions[]` / `settlements[]` |
| verdict_drift | layer, choice, rubric | right-rate at `rubric` vs `rubric − 1` |

- A run's `mode` is the single mode shared by all of its `build.stories`. With
  zero stories or more than one mode, it is `*`. `*` is the only non-vocabulary
  value allowed, and it is a structural wildcard, never text.
- `metric` is closed: `boot_tokens_mean` (cost.derived),
  `billed_input_per_story` (cost.totals.billed_input_equivalent ÷ stories),
  `alternations_per_story` (PAIR stories only), `revise_rounds`,
  `review_rounds`. These are token-space measures, never USD, because the
  meter says dollars drift.
- `debt.by_risk` and `debt.by_category` are independent tallies with no joint
  category × risk cell, so pairing them would invent data and a cross product
  would inflate counts. A debt key therefore carries `severity = *` and
  `by_risk` feeds no key (amended by EPIC-5 ARCH-7 before any fingerprint was
  published). The slot stays in the key so that a future additive report field
  with joint cells can emit `(category, <risk>)` keys alongside the existing
  `*` keys, without changing any existing fingerprint.
- The counting unit is **one report per group**. Five identical findings in one
  run count 1, and the finding total is kept as a secondary figure.
- Adding a `kind`, a metric or a vocabulary token is additive and creates new
  keys. Existing keys never change.

### Fingerprint

`fingerprint = "sig-" + first 12 hex of sha256(canonical key)`. The canonical
key is `JSON.stringify([kind, ...values in the table's order])`. The key holds
only tokens and integers, so publishing the hash leaks nothing the key itself
would not.

Every signal issue carries the label `signal` and a body marker on its own
line:

```
<!-- signal: sig-xxxxxxxxxxxx[ sig-yyyyyyyyyyyy ...] -->
```

The first fingerprint is the issue's primary. Any further ones are groups
merged into it (EPIC-5 ARCH-3), so a merge sticks across runs. Matching works
like this: `gh issue list --label signal --state all --json
number,state,stateReason,closedAt,body` is parsed locally. A group matches the
issue whose marker contains its fingerprint. Two issues that claim the same
fingerprint fail the run with an error and nothing is written, because guessing
between them would be silent corruption.

## Consequences

- Becomes easy: re-runs are idempotent with no state file. The issues are the
  state, and a re-run rewrites a body only when the rendered bytes differ. 02
  has a small contract to meet. Fixtures and the real store go through the same
  validator.
- Becomes easy: leak-proofing issue bodies is mechanical, because every key
  value comes from a closed set.
- Becomes hard: renaming a vocabulary token or a key field orphans the issues
  filed under the old fingerprint. That is the same cost ADR-0001 already
  places on vocabulary renames. Per-repo slicing is impossible by design.
- Becomes hard: a store that cannot stamp `source_first_seen` server-side
  cannot feed this routine. That is intended.

## Revisit if

- 02's design cannot stamp first-seen server-side. Then the age defence needs
  a different anchor, such as a first-seen time derived from the store's
  earliest object, and this ADR is superseded instead of being worked around.
- A signal that maintainers consider one problem keeps splitting across
  different `mode` values (`*` vs a token), seen as repeated merges of the
  same pair. Drop `mode` from that kind's key with a migration that rewrites
  the markers.
- Signal issues exceed about 1000. Paging `gh issue list` at that size is the
  point to move fingerprint matching into the store.
