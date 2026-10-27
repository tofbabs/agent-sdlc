# Waves: take a set of briefs from brief to PR, with only the merge left to a human

A **wave** is a set of briefs that are safe to build at the same time. Every
dependency has merged, and no two of them change the same function or contract.
The wave takes each brief through plan, build, review and revise to a PR. A
human merges. When every brief in the wave is delivered, the next wave opens on
its own.

This ports a wave skill already proven in production on another project,
where it runs as repo-local skills and routines. Port the mechanism, not that
project's repo facts. Its protocol isn't in this repo: each brief states the
rules it needs. The routine prompts (03) and the `pr-ready` protocol (05) name
that project's repo, ids, gate and paths throughout, so a repo-neutral copy
lands in this folder before 03 or 05 is planned.

```
01 parallel-safe ──► 02 wave core ──────────────────────────────► 03 autopilot ──► 05 merge train
   (shipped)          EPIC-11, 12 merged                           (routines)        (optional)
                         │
                         ├─► 06 tick delivery fixes (fix:)
                         │      │
                         │      ├─► EPIC-13 phase worker ──► EPIC-14 sweep + lock hand-off
                         │      │        (same release)          │
                         │      └─► 04 custom waves ──► 07 planned waves ──► 08 roadmap (parked)
                         │                                │
                         └────────────────────────────────┴──► 03 (needs EPIC-14's --next;
                                                                    better after 04's idle start)
```

## Implementation order

| # | Brief | Depends on | Lane | Ships as |
|---|-------|-----------|------|----------|
| 1 | [Parallel-safe plan, build and review](01-parallel-safe-pipeline.md) | — | deliberate | shipped (EPIC-7, #57) |
| 2 | [Wave core](02-wave-core.md) | 1 released | deliberate | EPIC-11 (#58) and EPIC-12 (#60) merged, EPIC-13, EPIC-14 |
| 6 | [Tick delivery fixes](06-tick-delivery-fixes.md) | EPIC-12 merged | deliberate | `fix:` |
| — | EPIC-13 phase worker | 6 merged | deliberate | `feat:` |
| — | EPIC-14 sweep, migrations, lock hand-off | EPIC-13 merged, **same release** | deliberate | `feat:` |
| 4 | [Custom waves](04-custom-waves.md) | 6 merged | deliberate | `feat:` |
| 7 | [Planned waves](07-planned-waves.md) | 4 merged | deliberate | `feat:` |
| 3 | [Wave autopilot](03-wave-autopilot.md) | EPIC-14 merged; 4 merged preferred | deliberate | `feat:` |
| 5 | [Merge train](05-merge-train.md) | EPIC-13 merged (lock module) | deliberate | `feat:` |
| 8 | [Wave roadmap](08-wave-roadmap.md) | 7 merged, **and the trigger below** | fast | `feat:`, parked |

1. **06 first.** It fixes what the merged tick gets wrong without any worker:
   delivery on a closed Issue, the CI-failed comment, the reachable round
   cap, the `wave-hold` marker, and start's label hygiene. **Release PR #59
   is held until 06 merges,** so `wave tick` never ships with "any merged PR
   = delivered".
2. **EPIC-13, then EPIC-14, in one release.** EPIC-13's lock module now owns
   the whole grammar, reader and writer, so it needs no separate fix PR.
   EPIC-14 STORY-14-4 is what clears stale locks and keeps tick off a held
   brief. Without it, EPIC-13's worker can strand a brief.
3. **04 can run in parallel with EPIC-13/14.** It touches select, classify,
   tick and board, not the worker. Run it after 06, because both edit the
   label strip.
4. **07 after 04.** It reuses 04's custom-wave open path.
5. **03 needs `phase --next` (EPIC-14).** With 04 merged, it ships the start
   routine disabled, because tick opens idle waves. Without 04, the start
   routine has to stay on.
6. **05 is optional and late.** It reuses the lock module.
7. **08 is parked.** Plan it only once a second consuming project runs waves
   on a backlog of 20 or more open briefs. Until then its brief Issue stays
   out of the wave pool.
8. **Dogfood after 06, EPIC-13 and EPIC-14 ship in a release.** This repo
   runs the last released plugin.

Brief numbers aren't the order. 04 and 05 keep the numbers they were drafted
under. 06–08 are new.

The split is deliberately coarse. Each brief is one PR, and each PR adds CI and
review rounds, so the briefs are cut only where one of these holds:

- the release signal changes (06 is `fix:`, the rest `feat:`);
- a one-way-door decision would otherwise hold up unrelated work;
- a piece is worth merging before the rest exists (07 after 04; 08 after 07).

Each brief states its expected shape and stays within one 15-point epic.
03 is the exception: with the production answers added it runs past 15, and
it proposes cutting `/conflicts` into its own brief.

## Decisions already made

These were settled while scoping or in review. Don't reopen them during
planning.

- **Only one wave is active at a time.** `start` refuses while any wave is
  open.
- **A brief is delivered when its Issue is closed** *(revised from
  production evidence)*.
  - A merged Closes PR that postdates the latest reopen closes the Issue, and
    tick closes it when GitHub doesn't.
  - A merged partial PR blocks the brief, and is never counted as delivered.
  - A PR closed unmerged returns the brief to the pool (ARCH-4, #60).
  - Closing a wave runs `start` again in the same session.
- **The round cap blocks once the at-cap round's Response is posted.** The
  round at the cap still gets its revise, then the brief stops at `blocked`
  (06).
- **A human hold is an explicit `<!-- wave-hold -->` marker comment** on the
  brief Issue, from someone with write access. Tick keeps a held brief
  `blocked` until the comment is deleted, and `start` doesn't select it. A
  hand-set `phase:blocked` label without the marker is recomputed (06).
- **No `wave:deferred`** (ARCH-3). Close as not planned to abandon, hold to
  wait.
- **`phase --next` picks by priority, then build before plan, then Issue
  number** (EPIC-14 ARCH-8).
- **The human merge is the only human step in the loop.** No agent approves or
  merges.
- **GitHub is the only state.** That means labels, Issue bodies and PR
  comments. No session remembers anything between runs. Every run works out
  each brief's phase again from evidence and never trusts a plan's `Status:`
  line.
- **One lock shape for every acting command:** a comment marker, a ~20s
  wait, lowest comment id wins, closed in place with `ended=`/`result=`, and
  a label that only marks it (EPIC-13 ARCH-7).
- **The test bar lives in the reviewer's verdict,** not in a separate gate
  line in the round comment.
- **Briefs still start as hand-written files** in `docs/briefs/` under the
  repo store. A brief Issue is a tracking record that points at one, and is
  eligible only once that file is on the base (06).

## Shared with the GitHub backlog adapter

[`../github-backlog/`](../github-backlog/README.md) overlaps with waves.
Settled so far:

- **Config** lives in `.claude/agentic-sdlc.json` (ADR-0006/0007), for both.
- **The plan id is the Issue number** (`EPIC-<issue>`, `FAST-<issue>`) in
  both stores.
- **Label namespaces.** The wave owns `wave:*`, `wave:planned:*`,
  `wave:queued`, `phase:*`, `phase-running`, `reviewing` and `revising`. The
  adapter owns `brief` (shared) and adds no status labels.
- **Untrusted Issue text.** Only structured lines from Issue bodies are
  parsed, and comment text is never fed to an agent as instructions. The one
  comment the wave reads from a human is the `wave-hold` marker, and only its
  presence counts.
- **`Brief: inline` and `Brief: #<n>`** (github store) are exempt from 06's
  "brief file on the base" check. The wave's payload sets `plan: true` from
  the plan comment as well as from a `backlog/` file.

Waves don't depend on the adapter. They work with `store=repo`.

## Status

| # | Planned | Built | Merged |
|---|---------|-------|--------|
| 1 | EPIC-7 | yes | #57 |
| 2 | EPIC-11, 12, 13, 14 | 11, 12 | #58, #60 |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
| 8 | parked | | |
