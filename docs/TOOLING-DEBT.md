# Tooling Debt

**Current stage:** 2 Real users — pinned and consumed by other repos; releases gated by release-please and a human merge.
**Last scanned:** never — ledger created 2026-10-06 when the repo started building itself.

> A ledger, not a backlog of failures. Missing tooling is correct at an early
> stage. What matters is that each gap has a **concrete, observable trigger**.
>
> Maintained by the weekly gap-scan routine. Appended to by `architect` and
> `coder` during builds.

## Now — blocking real risk

| Gap | Risk | Why now | Effort |
|-----|------|---------|--------|
| | | | |

> If this table exceeds 5 entries, the gap scan says so at the top of the file:
> **recommend pausing feature work.**

## Next — at the coming milestone

| Gap | Trigger | Effort |
|-----|---------|--------|
| | | |

## Later — acknowledged, not yet worth it

| Gap | Trigger | Effort |
|-----|---------|--------|
| | | |

## Accepted — deliberately not doing this

| Gap | Why it is fine | Revisit if |
|-----|----------------|------------|
| | | |

## Fast-mode shortcuts

Written by `--fast` runs. One row per shortcut — if logging one costs more than
taking it, nobody logs anything. Triaged by the gap scan like any other entry.

| Shortcut | Instead of | Trigger to fix | From |
|----------|------------|----------------|------|
| | | | |

> A `--fast` run adds one line naming itself, so a reader knows why the rows are
> here: `_Run: FAST-3, 2026-08-23, tasks T3-1..T3-6 — built in fast mode._`
>
> What belongs here: a missing test on a risk surface (auth, money, destructive
> data paths, external contracts) — including one covered by a happy-path test with
> no negative case, which is the same gap — a hardcoded value, a stubbed
> integration, a deferred migration. What does **not**: "skipped TDD", "did not pair", "wrote
> fewer tests". Fast mode's whole shape is those things; rows restating it are how
> a ledger stops being read.

## Logged by agents

Raw entries appended during `/plan` and `/build`. The gap scan triages these into
the tables above; do not leave them loose.

```markdown
### <thing>
- Raised: <date> by <architect | coder> (<ARCH-n | STORY-id>)
- Current: <what we did instead>
- Risk: LOW | MEDIUM | HIGH
- Category: <debt_category> (run-report-categories.mjs)
- Address when: <concrete, observable trigger>
```

<!--
Triggers are observable or they are not triggers. "Before the first external
user", "when a second engineer appears in git shortlog -sn", "above 100 req/s".
Never "soon", "when mature", or a calendar quarter.

Do not inflate risk. Crying HIGH on everything is how a ledger gets ignored, and
an ignored ledger is worse than none.
-->

### Gate runs and failures have no recorder
- Raised: 2026-10-06 by architect (ARCH-1)
- Current: schema 1 carries `build.gate_runs`/`build.gate_failures` as `null`
  with `gate_history` in `degraded`; nothing records gate executions, and
  wrapping the gate just for counting was judged not worth the build-path
  change now
- Risk: LOW
- Category: observability
- Address when: 03-signal-routine defines a signal that needs gate data

### Per-story architect-block attribution is lost on unblock
- Raised: 2026-10-06 by architect (ARCH-3)
- Current: `pair-log.mjs` clears `session.json`'s `arch` field on resume, so
  mid-build blocks are counted at build level from the run marker's
  start-of-run handoff snapshot, not per story
- Risk: LOW
- Category: observability
- Address when: an optimisation question actually needs to know WHICH story
  a resolved block belonged to, not just how many blocks of which category

### Wall clock across sessions is approximate
- Raised: 2026-10-06 by architect (ARCH-4)
- Current: `run.wall_clock_s` sums (session end − command start) per session
  from the run marker, so idle time between the command finishing and the
  session closing counts in
- Risk: LOW
- Category: robustness
- Address when: a duration-based signal in 03 misleads because of idle tails

### meter.sh aborts on macOS bash 3.2 when no subagents dir exists
- Raised: 2026-10-06 by coder (STORY-1-1)
- Current: pre-existing — reproduces identically on `main` before this story's
  changes, so it is not this story's regression. `templates/hooks/meter.sh`
  (~line 80) expands `"${sub_arg[@]}"` under `set -u`; macOS ships bash 3.2,
  where an empty array under `set -u` is an unbound-variable error, so the
  hook dies before running `meter.mjs` — the three `scripts/meter.test.sh`
  hook-resolution cases (marketplace fallback, cache-version ordering,
  `METER_MJS` override) fail here but pass in CI's Linux bash 5. On a real
  macOS machine this means the production meter hook silently records
  nothing (it is advisory/best-effort and exits 0 either way)
- Risk: MEDIUM
- Category: robustness
- Address when: the next change that touches `meter.sh` — fix is
  `${sub_arg[@]+"${sub_arg[@]}"}` in place of `"${sub_arg[@]}"`
