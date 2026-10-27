# EPIC-13: Wave core, part 3 of 4: `phase` worker (lock, plan, build)

- Brief: docs/briefs/waves/02-wave-core.md
- Part: 3 of 4
- Depends on: EPIC-12
- Parts: EPIC-14 (sweep, migration check, parity config), stub
- Outcome: `/agentic-sdlc:phase <plan|build> <issue>` runs one locked phase in a fresh session and behaves as the proven `wave-phase` skill does in production. Plan commits the plan to `feat/<id>`; build ends in a PR with `Closes #<issue>`; every exit closes its marker with `ended=`/`result=`.
- Covers: the lock grammar, reader and writer (`run=`/`ended=`/`result=`, failed runs counted, lowest-id arbitration), `wave-depskip`, the repo from `origin`, the architect resolving handoffs inside the worker
- Status: STUB

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-2 | Round comment contract. RESOLVED by ADR-0005 | none | RESOLVED |
| ARCH-6 | Who closes a stale lock still under the attempt limit? **Decision:** tick, as the proven skill does: it edits the marker in place to `ended=<t> result=stale` and removes `phase-running`, so each stale lock counts once. Built in EPIC-14 STORY-14-4. The worker never takes over a `cleared` lock. | none | RESOLVED |
| ARCH-7 | One lock shape for phase, review, revise and pr-ready? **Decision:** yes. Production moved review, revise and pr-ready to the phase lock's shape after label-only locks let three revise runs hit one PR. `wave-lock.mjs` takes a `kind` (`wave-run` on an Issue; `review-lock`, `revise-lock`, `pr-ready` on a PR) and a timeout per kind. This epic ships kind `wave-run`. 03 and 05 add their kinds as data, not code. | none | RESOLVED |

Fill-in needs no precondition on the lock reader: STORY-13-1 owns the
whole lock grammar, reader and writer, in `wave-lock.mjs`. Brief 06
(tick delivery fixes) should merge first, because STORY-13-3's PR relies
on tick closing the Issue (06) on a staging-style base. Release EPIC-13 and
EPIC-14 together: don't cut a release between them.

## Stories

### STORY-13-1
- estimate: M
- depends_on: []
(the lock module, reader and writer, in `scripts/wave-lock.mjs` + its existing
`.test.sh`; no second script.
Grammar: `<!-- <kind> [phase=<p>|pr=<n> sha=<s>] run=<id> started=<t>
[ended=<t> result=ok|failed|skipped|stale] -->`.
Reader: a marker with `ended=` is never the held lock; the held lock is the
lowest comment id among unfinished markers younger than the kind's timeout,
then earliest `created_at`; attempts since `wave_labeled_at` = `failed` +
`stale`; `skipped` never counts. Writer: render a marker with `run=`; given the
re-read comments and own run id, decide won / lost / skipped; render the
in-place end edit. One wait for every kind, ~20s. `reference/wave.md` lock
section: post, wait, paginated re-read, the loser deletes only its own marker
and touches no label, the winner adds the marker label, release before the
phase label moves. A test per race: two markers in each order, one with
`ended=`, one stale, one `failed` then a clean run, and the old last-marker
case now reading lowest-id.)

### STORY-13-2
- estimate: M
- depends_on: [STORY-13-1]
(`commands/phase.md` as a thin dispatcher (bytes cut elsewhere in the same PR) plus
`phase plan <issue>`. Skip-and-stop checks, in order: no `wave:<N>` whose epic is
`wave:active`; a fresh lock for this phase; `phase:plan` gone; a real `Depends on`
not CLOSED as completed, which posts one `<!-- wave-depskip dep=#d -->` unless that
marker exists. Then `plan --id EPIC-<n>|FAST-<n>` from the `Lane:` line,
commit only `backlog/<id>.md` to `feat/<id>` from `origin/<base>` and push, with no PR.
Release the lock, then `phase:plan` → `phase:build`, then one comment line: path and story
count. Repo comes from `origin`; the MCP fallback reads `git remote get-url origin`.
Plan runs `/plan`'s STEP 2 resolve before committing: the architect resolves
every OPEN handoff it can own. Commit `backlog/<id>.md` plus any ADR or
`docs/TOOLING-DEBT.md` row the architect wrote (one `docs:` commit). A handoff
stays OPEN only for what the architect can't own (a production step, a
Proposed ADR to accept, a scope split). Name each one, with the reason, in the
exit comment.)

### STORY-13-3
- estimate: M
- depends_on: [STORY-13-2]
(`phase build <issue>`: read the plan on `origin/feat/<id>` (else `origin/<base>`), resume
the branch (01) and `git merge origin/<base>`, run the gate (`wave.gate`, else build's own,
never `--no-verify`), and run the `wave.pre_pr` check for a brief carrying a listed label.
The PR to `wave.base` carries `Closes #<n>`, `Mode: FAST` for FAST plans, and the plan path.
Release, then `phase:build` → `phase:ci`. Failure path: push, open no PR, comment the
failing command and its last 30 lines, keep the label, `result=failed`. Adds `wave.base`,
`wave.gate`, `wave.pre_pr` to `config.mjs` (DEFAULTS, `validateWave`, known keys) with
`config.test.sh` cases.
An OPEN handoff in the plan, or a coder or navigator BLOCKED on one, is not a
reason to stop: build's existing architect unblock (`commands/build.md` step
3) resolves it and the build carries on. For a handoff the architect can't
own, build every story that doesn't depend on it, push, open no PR, and exit
`result=failed` with a comment naming what a human must do. That counts as an
attempt, so a second identical exit blocks the brief.)
