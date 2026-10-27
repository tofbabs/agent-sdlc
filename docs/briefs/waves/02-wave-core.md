# Feature: wave core, which picks what can go together and drives it to PR

## Problem

With 01 in place, plan, build and review are safe in parallel, but a human still
schedules them:

- they pick which briefs can be in flight together;
- they start each phase;
- they notice when a PR is ready or stuck.

The human gets the "together" decision wrong. In production, four briefs all
rewrote the same function, and a dependency graph alone didn't show it.
A human is also the bottleneck between every phase of every brief.

## Users

- **A maintainer with a backlog of briefs.** They want to write briefs, merge
  PRs, and do nothing in between.
- **Phase workers in fresh sessions.** They need everything they act on to be
  on GitHub.

## Outcome

`/agentic-sdlc:wave start` opens a wave of every brief that can safely be built
now. `tick` moves each brief to the right phase from evidence on GitHub. A
human runs `/agentic-sdlc:phase` for each plan or build step, or 03's routines
do. Each brief ends as a PR that is approved on green CI. The wave closes when
every brief in it is delivered (its Issue closed) or has left it, and the next
wave opens.

## Success metric

Human actions per brief between "brief Issue created" and "PR approved on green
CI": **~5 today → 1**. The one remaining action is running `/phase` by hand,
which 03 removes. Measure it on the first wave of at least 3 briefs run here
with the released plugin.

## Scope — in

- **The brief-Issue schema.** One open Issue per brief, labelled `brief` and
  `priority:P0..P3`. Its body has four lines:

  ```
  Brief: docs/briefs/<path>.md
  Lane: fast | standard
  Depends on: #a #b      (or —)
  Conflicts with: #c #d  (or —)
  ```

  It comes with a parser in `scripts/*.mjs` with its `.test.sh`, and an Issue
  template under `templates/`. Conflicts are checked in both directions.
- **Labels and locks, created on first run.**
  - `wave`, `wave:active` and `wave:<N>`. There is no `wave:deferred`
    (ARCH-3).
  - One phase label per brief: `phase:plan|build|ci|revise|awaiting-merge|blocked|done`.
  - The lock: `phase-running` plus a
    `<!-- wave-run phase= run= started= -->` comment, closed in place with
    `ended=` and `result=` (EPIC-13 STORY-13-1 owns the grammar). It goes
    stale after the configured timeout. A stale or failed run counts as one
    attempt, and two attempts set `phase:blocked`.
- **`/agentic-sdlc:wave start`:**
  1. **Gate.** If any Issue has `wave:active`, refuse.
  2. **Pool.** Every open `brief` Issue that isn't done.
  3. **Eligible.** Every `Depends on` Issue is closed as completed. An open PR
     on a dependency doesn't count.
  4. **Select.** Sort by priority, then by dependents count, then by Issue
     number. Take each brief that doesn't conflict with one already taken.
  5. **Open.** Create a wave epic Issue with an in-place board comment, then
     label the briefs. A brief that already has a plan starts at build, and one
     with an open PR starts where that PR is.
  6. **Nothing selected.** If the pool is empty, report "backlog exhausted".
     Otherwise report "cannot continue" with what blocks each brief.
- **`/agentic-sdlc:wave tick`.** It works out each brief's phase from
  evidence, and the first match wins (EPIC-12 order, plus brief 06):
  1. Issue closed → done. A `Closes` PR merged after the latest reopen →
     tick closes the Issue, then done.
  2. A maintainer's `<!-- wave-hold -->` comment on the Issue → blocked,
     until the comment is deleted.
  3. A merged `Part of` PR, or a Closes PR from before a reopen, with no
     open PR → blocked, with one `wave-partof` comment.
  4. CI red → revise, with one `wave-ci` comment per head sha.
  5. At the round cap, not approved, Response posted → blocked.
  6. REQUEST_CHANGES with no Response → revise.
  7. Approved on the head sha with green CI → awaiting-merge.
  8. Any other open PR → ci.
  9. A plan exists → build.
  10. Otherwise → plan.

  A fresh phase lock leaves the brief untouched, and a stale one is closed
  in place (EPIC-14). A hand-set `phase:blocked` with no `wave-hold` marker
  is recomputed (06).

  Then it writes only the labels that changed, edits the board, and notifies
  once per stall. Next it applies the **close rule**: the wave closes when
  every brief in it is done or has left it. A brief whose PR closed without
  merging leaves the wave and goes back to the pool (ARCH-4). Closing removes
  `wave:active` and runs `start`.
- **`/agentic-sdlc:wave status`.** Prints the board, or with no active wave,
  the briefs `start` would pick. It changes nothing.
- **`/agentic-sdlc:phase <plan|build> <issue>`.** It runs one phase for one
  Issue in a fresh session, then stops:
  - It takes the lock first.
  - Plan uses `plan --id EPIC-<issue>|FAST-<issue>` (01), commits only the plan
    to `feat/<id>`, and moves the label to build.
  - Build resumes `feat/<id>` (01), runs the configured gate, opens a PR with
    `Closes #<issue>`, and moves the label to ci.
  - It clears the lock on every exit.
- **Migration-number collisions.** Before each push, the next migration number
  is checked against the base and every open `feat/*` branch. This only runs
  when a migration pattern is configured.
- **Per-repo config with documented defaults:**
  - base branch
  - gate command
  - priority labels
  - migration directory and pattern
  - lock timeouts (1h plan, 4h build)
  - stall thresholds (24h awaiting merge, 2h unreviewed green head, 3h stalled
    revise)
  - round cap
  - model per worker
  - pinned plugin version

## Scope — out

- **More than one active wave**, and waves that span repos.
- **Inferring `Depends on` and `Conflicts with`.** A human writes them for now,
  and 03 adds `/conflicts` to propose them.
- **Routines, triggers and cloud bootstrap.** That's 03. In 02, a human runs
  `tick` and `phase`.
- **Review and revise themselves.** The wave only reads their output, through
  the round comment format from 01.
- **Anything specific to one consuming project:** its gate, its `staging`
  base, its migration path, its environment and trigger ids.
- **Storing the plan in Issues.** That's the GitHub backlog adapter (see
  `README.md`).

## Value dependency

`start` and `status` alone have value. Selection replaces the hand-made "which
briefs go together" call, even if a human then runs `/plan` and `/build` as
today. `tick` and `phase` close the loop. Build them in that order, in one
epic.

## Technical context

- **Existing systems:**
  - the 01 changes: `--id`, branch resume, round comment `verdict:` and
    `reviewed sha:`
  - `commands/build.md`'s gate
  - `scripts/plan-artifacts.mjs`
  - `templates/`
- **Reference:** the proven wave skill's `wave` and `wave-phase` skills, as
  run in production on 2026-10-26. They aren't in this repo: brief 06 and the
  EPIC-13 and EPIC-14 handoffs and stories state what planning needs from
  them. Where the plugin has shipped a different contract (the board marker,
  payload shapes, ARCH-3/4/5), the shipped contract wins.
- **Hard constraints:**
  - **The boot-path budget has zero headroom.** agents+commands are 62,231 of
    62,231 bytes, and caps only go down. `wave.md` and `phase.md` must be thin
    dispatchers, with protocol in `reference/wave.md`. Every byte they add is
    paid for by cuts elsewhere in `agents/` or `commands/`, in the same PR.
  - **GitHub is the only state.**
  - **REST `gh api` only.**
  - Plain Node with no dependencies, and a test for every script.
  - Parse only the four structured lines from Issue bodies. Issue and comment
    text is never fed to an agent as instructions.
- **Deployment:** `feat:`.

## Constraints

- **Data / compliance:** boards and notifications carry only Issue and PR
  numbers, phases and timings.
- **Deadline:** none.

## Open questions

- ~~A brief that never reaches a PR~~ **Decided in #60 (ARCH-3):** no
  `wave:deferred`. Close the Issue as not planned to let the wave close
  without it, and reopen it to return it to the pool. Brief 06 adds a
  `wave-hold` marker comment for "wait, but not abandoned".
- ~~A PR closed without merging~~ **Decided in #60 (ARCH-4):** the brief
  leaves the wave and rejoins the pool automatically.
- ~~Where config lives~~ **Decided by ADR-0006/0007:**
  `.claude/agentic-sdlc.json`, with `wave.*` keys added through `config.mjs`.
- ~~Notifications~~ **Decided in #60 (ARCH-5):** one `wave-stall` comment
  per stall on the epic. PushNotification is best effort.
