# Feature: merge train, so approved wave PRs stay mergeable until a human merges them

## Problem

A wave produces several PRs at once against the same base. Each time one
merges, the others fall behind. Some conflict. Some go red because of the
merge, not their own diff. Sometimes the base itself is red, and then every
PR is red. The reviewer won't review red CI, so the wave stalls in `ci` or
`revise` with nothing to fix inside its own scope. The human who merges
also works out the merge order by hand.

The proven wave skill added a `pr-ready` sweep for this. It made the human's
only step "merge in the order the board says".

## Users

- **The maintainer at merge time.** They want a list: merge these, in this
  order, and they'll all go green.

## Outcome

`/agentic-sdlc:pr-ready sweep` makes at most one fix per run:

- merge the base into a PR that is behind, and resolve its conflicts;
- fix a check that went red because of the merge;
- fix red on the base itself, which outranks every PR;
- fix a hygiene blocker: the title, a missing `Closes`, a stale base.

`/agentic-sdlc:pr-ready plan` trial-merges every ready PR together and keeps
one merge-order board, edited in place. Neither ever merges.

## Success metric

Wave PRs at `phase:awaiting-merge` that were unmergeable (conflicted or red)
when the human came to merge them: **most of a wave in production before the
sweep → 0**.

## Scope — in

- **`sweep`.** One fix per run, from the list above, with the base-red case
  outranking every PR.
  - The run lock is EPIC-13's lock module with kind `pr-ready`, 2h timeout,
    lowest live comment id wins, and at most 2 attempts per head sha before
    `needs-human`.
  - It never compares `started=` timestamps.
- **The wave-PR guard:** skip a PR whose brief Issue carries a fresh
  `phase-running` lock (a worker is on that branch). `phase:revise` alone is
  not a lock.
- **One owner per red-CI class:**
  - a failure inside the PR's own diff is revise's (the tick's `wave-ci`
    comment, 06);
  - a failure caused by the merge with the base, or a red base, is
    pr-ready's.
  - Review findings and threads are never pr-ready's.
- **`plan`:** trial-merge in a scratch worktree, then write the order to one
  board Issue edited in place.
- **The event rule:** a `synchronize` caused by a routine's own push only
  refreshes the board, so it never loops.
- **The routine template** `wave-pr-ready-prompt.md`, shipped with 03's
  templates.

## Scope — out

- Merging, approving, or resolving threads.
- Rewriting history or force-pushing.
- Deleting or skipping tests, or adding secret-scanner allowlist entries.
- Fixing review findings. That is revise's job.

## Value dependency

It is useful without waves: any repo with several open PRs gets it. With
waves, it removes the "stalled at ci" class. It doesn't depend on 04 or 07.

## Technical context

- **Existing systems:** `ci-state.mjs`, build's gate for fixes, EPIC-13's lock
  module, and 06's `wave-ci` comment.
- **Reference:** the proven wave skill's `pr-ready` protocol. It isn't in
  this repo, and its copy names that project's gate, migration paths and base
  branch throughout. A repo-neutral copy lands before this brief is planned
  (see the README).
- **Hard constraints:**
  - a thin `commands/pr-ready.md`, with the protocol in `reference/`;
  - REST only;
  - the board carries only PR numbers, states and the order.
- **Deployment:** `feat:`.

## Constraints

- **Data / compliance:** the board carries only PR numbers, states and the
  order.

## Open questions

- **Telling "own diff" from "merge-caused".** Re-running the failing check on
  the PR's head without the base merged is the obvious test, but it costs a
  CI run. Is a trial-merge diff against the failing files enough?
