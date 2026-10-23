# EPIC-13: Wave core, part 3 of 4: `phase` worker (lock, plan, build)

- Brief: docs/briefs/waves/02-wave-core.md
- Part: 3 of 4
- Depends on: EPIC-12
- Parts: EPIC-14 (sweep, migration check, parity config), stub
- Outcome: `/agentic-sdlc:phase <plan|build> <issue>` runs one locked phase in a fresh session and behaves as QuestionMe's production worker does (port-source `phase.md`, `Sanimara/question-me@28938c7b`). Plan commits the plan to `feat/<id>`; build ends in a PR with `Closes #<issue>`; every exit closes its marker with `ended=`/`result=`.
- Covers: PARITY P3 (marker writes), P4 (arbitration), C8 (`wave-depskip`), C18 (repo from `origin`)
- Status: STUB

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-2 | Round comment contract. RESOLVED by ADR-0005 | none | RESOLVED |
| ARCH-6 | Who closes a stale lock still under the attempt limit (PARITY P5)? QuestionMe's tick edits the marker in place to `ended=<t> result=stale` and removes `phase-running`, so each stale lock counts once. If #60 round 2 settles it in tick, close this row; otherwise the worker takes over a `cleared` lock. | STORY-13-1 | OPEN |
| ARCH-7 | One lock shape for phase, review and revise (PARITY C16)? If 03 reuses the comment marker plus a label for `reviewing`/`revising`, `wave-run.mjs` is keyed by lock kind rather than phase, and 03 adds no second design. | STORY-13-1 | OPEN |

Fill-in reads the merged #60 first: `wave-lock.mjs`'s reader must already
take `run=`, `ended=`, `result=` and pick the lowest-id unfinished marker
(PARITY P3/P4 reader half). If it doesn't, stop and report: this part writes
the grammar that the reader defines, and it never redefines it.

## Stories

### STORY-13-1
- estimate: M
- depends_on: []
(worker side of the lock, pure `scripts/wave-run.mjs` + `.test.sh`: render a marker
with `run=<id>`; given the re-read comments and own run id, decide won / lost /
skipped (lowest comment id among fresh, unfinished markers of the same phase wins,
then earliest `created_at`; skipped when `phase:<p>` is gone); render the in-place
end edit `ended=<t> result=ok|failed|skipped`. `reference/wave.md` lock section:
post, wait ~5s, paginated re-read, loser deletes only its own marker and touches no
label, winner adds `phase-running`, and the lock is released *before* the phase label
moves. A test per P4 race: two markers in each order, one with `ended=`, and one stale.)

### STORY-13-2
- estimate: M
- depends_on: [STORY-13-1]
(`commands/phase.md` as a thin dispatcher (bytes cut elsewhere in the same PR) plus
`phase plan <issue>`. Skip-and-stop checks, in order: no `wave:<N>` whose epic is
`wave:active`; a fresh lock for this phase; `phase:plan` gone; a real `Depends on`
not CLOSED as completed, which posts one `<!-- wave-depskip dep=#d -->` unless that
marker exists (C8). Then `plan --id EPIC-<n>|FAST-<n>` from the `Lane:` line,
commit only `backlog/<id>.md` to `feat/<id>` from `origin/<base>` and push, with no PR.
Release the lock, then `phase:plan` → `phase:build`, then one comment line: path and story
count. Repo comes from `origin`; the MCP fallback reads `git remote get-url origin` (C18).)

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
`config.test.sh` cases.)
