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

### Run-report cost covers only the current session's meter record
- Raised: 2026-10-06 by coder (STORY-1-2)
- Current: `run-report.mjs` embeds the newest meter record modified at or
  after the marker's `started_at` (this session's command start), so a run
  resumed across sessions reports only the last session's cost; earlier
  sessions' records are not summed, because summing would re-derive totals
  the ADR says to embed verbatim
- Risk: LOW
- Category: observability
- Address when: a multi-session run's `cost` is used in a 03 signal, or the
  meter gains a per-run aggregate record to embed instead

### Build and review run outcomes are provisional
- Raised: 2026-10-06 by coder (STORY-1-2)
- Current: `run.outcome` for a build is `completed` only when every story
  (or the file's own `Status:`) reads DONE — the epic PR is not consulted;
  for a review it is `null` with `pr_comments` degraded, since only the
  review section reads PR comments
- Risk: LOW
- Category: stubbed_integration
- Address when: the build and review sections land — each refines its own
  entry in `COMPLETION` in `run-report.mjs`

### Run-report's gh timeout path is untested
- Raised: 2026-10-06 by coder (STORY-1-4)
- Current: `run-report.mjs` reads PR comments with one `gh pr view` capped at
  5 s (`spawnSync` timeout → `pr_comments` degraded). The test suite covers gh
  missing and gh failing, but not a hung gh, because the cap is a constant and
  a test would add 5 s to every preflight; the run-section review case also
  still reaches the real `gh` (it fails fast outside a git repo)
- Risk: LOW
- Category: missing_test
- Address when: the timeout becomes configurable, or a hook run is seen
  hanging on gh

### build.stories "touched" is inferred from three indirect signals
- Raised: 2026-10-06 by coder (STORY-1-3)
- Current: a story counts as touched by the build when it has a pair
  session.json, a `- status:` other than TODO, or a `[<ID>]` commit tag in
  `git log` on the current branch. A SOLO story mid-flight in its own worktree
  (status not yet moved, nothing landed) is missed; `git log` reads the whole
  history unbounded; and the build `outcome` still ignores whether the epic PR
  is open, since no local artifact records it
- Risk: LOW
- Category: robustness
- Address when: the orchestrator writes a per-story "started" marker (or the
  run marker records the epic PR number), or a report under-counts stories
  against a build's own summary table

### Supersession in `mark` can block UserPromptSubmit on a slow `gh`
- Raised: 2026-10-06 by coder (STORY-1-6)
- Current: a different command/target while a marker exists makes `mark`
  finalize the superseded run inline — same path `report` uses — before
  writing the new marker. For a superseded build/review run that still needs
  `gh pr view` for its review section, that is a synchronous `gh` call (capped
  at 5s, see the existing "gh timeout path is untested" entry above) inside the
  UserPromptSubmit hook, which otherwise does none. In practice this only
  fires at a command boundary (plan→build, build→review, …), not on every
  prompt, and `gh` failing or timing out still degrades to exit 0 — but the
  user-visible latency on that one prompt is new
- Risk: LOW
- Category: robustness
- Address when: a user reports a slow prompt at a pipeline command boundary,
  or `gh pr view`'s 5s cap is made configurable (ties to the entry above)

### Rubric v1 weights are transliterated prose, not fitted
- Raised: 2026-10-06 by architect (ARCH-2)
- Current: weights/band encode build.md's existing rule; evidence base is one
  pair log and 35 PRs
- Risk: LOW
- Address when: 03's routine has ≥20 closed decisions to fit against

### Unnamed post-merge fixes escape attribution
- Raised: 2026-10-06 by architect (ARCH-2)
- Current: fix/revert attribution is by story/epic ID in the commit subject or
  PR body only; a fix that names nothing counts against no decision
- Risk: LOW
- Address when: >20% of swept fix commits carry no ID

### No counterfactual measurement in v1
- Raised: 2026-10-06 by architect (ARCH-2)
- Current: no forced-exploration rate; SOLO review findings by risk class are
  the only counterfactual signal
- Risk: LOW
- Address when: 02's cross-repo export is live and decision volume supports a
  sample

### `/build`'s MODE SELECTION still reads the prose `risk:` line
- Raised: 2026-10-06 by coder (STORY-2-2)
- Current: the planner now emits `- select: ...` instead of `risk:`, and
  `backlog/EPIC-2.md` scopes reading/scoring that line (`mode-select.mjs`) and
  wiring it into `/build`'s MODE SELECTION to STORY-2-3/2-5, which this story
  must not touch. Until those land, every newly planned story/task also
  carries no `risk:` line for `/build` to fall back to, so `/build`'s existing
  "no `risk:` line → infer from ACs" path is doing double duty
- Risk: LOW
- Category: stubbed_integration
- Address when: STORY-2-3 (`mode-select.mjs`) and STORY-2-5 (`/build` wiring)
  land — both already scoped in `backlog/EPIC-2.md`

### Decision store is machine-local
- Raised: 2026-10-06 by architect (ARCH-1 / ADR-0002)
- Current: cross-machine decision→outcome joins close as orphaned
  (`machine_local`); the gh sweep narrows but does not remove the gap
- Risk: MEDIUM
- Address when: 02's central storage is live (ADR-0002 "Revisit if")

### Pair-session mirror is never pruned, and is machine-local
- Raised: 2026-10-06 by coder (STORY-2-10)
- Current: `pair-log.mjs` writes `<git common dir>/agentic-sdlc/pair/<STORY-ID>/session.json`
  and nothing deletes it (a few hundred bytes per paired story); a run report
  built on another machine or a fresh clone, with no in-tree log, reports a
  paired story as SOLO. STORY-1-6's committed pair log stays tracked as the
  in-tree fallback for EPIC-1 history
- Risk: LOW
- Category: robustness
- Address when: the store holds more than ~500 story directories, or run
  reports start being built somewhere other than the machine that ran the
  build (02's central storage — same trigger as "Decision store is machine-local")
