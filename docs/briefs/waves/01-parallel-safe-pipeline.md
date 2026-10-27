# Feature: plan, build and review that are safe to run in parallel and in fresh sessions

## Problem

`/plan`, `/build` and `/review` assume one human, one checkout and one brief at
a time. Run them in parallel, or as fresh cloud sessions with no memory, and
they break in five places. The proven wave skill had to override every one of them
to run waves (see `README.md`):

1. **Plan ids collide.** `/plan` takes the next free number, so two parallel
   planners pick the same `FAST-5` and one overwrites the other.
2. **Build can't resume.** `/build` always creates `feat/EPIC-<n>` with
   `git worktree add ../wt-EPIC-<n> -b feat/EPIC-<n> origin/<base>`
   (`commands/build.md` around line 82). A plan committed to that branch by an
   earlier session makes the command fail. The other option is building from an
   untracked plan that never reached the worktree.
3. **The reviewer model drifts.** `reference/models.md` and `review.md`'s
   `--fable` note steer the reviewer toward Fable unless a model is forced.
4. **Review doesn't converge.** The reviewer will review a red-CI head. A later
   round re-reviews the whole PR and raises new minor findings. There's no
   round cap. The verdict is read from GitHub's review state, but GitHub stores
   a PR author's own review as COMMENTED (approving your own PR returns 422).
   So every PR the same account wrote reads as "not approved".
5. **GraphQL is blocked in cloud sessions.** Any `gh` call that uses GraphQL
   fails there.

Anyone running briefs in parallel by hand hits 1 and 2 today. Waves hit all
five on every brief.

## Users

- Maintainers who run several epics in parallel by hand.
- The wave phase workers in 02, which run each phase in a fresh, memoryless
  session.

## Outcome

- Two `/plan` runs in parallel never pick the same id.
- `/build` picks up a plan an earlier session committed to `feat/<id>`.
- Review uses the configured model and reads only green heads.
- Review finishes in one round when round 1 is clean, and never runs past the
  round cap.
- Everything works with GraphQL blocked.

## Success metric

Review rounds per PR on the next three epics here: the median goes to **1**,
with **none past 3**. The baseline is the round count on EPIC-1 to EPIC-3,
taken from their PR comments.

## Scope — in

- **`plan --id <id>`.** Use the given id instead of the next free number. Fail
  if `backlog/<id>.md` already exists on the base or on `feat/<id>`. With no
  flag, behaviour is unchanged.
- **`build` resumes an existing `feat/<id>`.** If the branch exists on the
  remote, check it out, bring it up to date with the base, and carry on. If it
  doesn't, create it as today.
- **An explicit reviewer model.** The code-reviewer's model comes from config,
  with `--model` overriding it, and is always passed when the agent is spawned.
  No prose default steers it.
- **Review convergence defaults:**
  - **Green CI first.** Review only a head whose checks all completed, none
    failed. Otherwise report "waiting on CI" or "CI red" and post no round.
  - **Round 1 is complete.** Tag every finding BLOCKING or NON-BLOCKING, with a
    severity. Only an open BLOCKING finding produces REQUEST_CHANGES.
  - **Rounds 2 and up only re-check.** They verify earlier findings against the
    `## Response — round k`. They look only at the diff since the last
    `reviewed sha:`. A new finding is allowed only if it is BLOCKING and covers
    security, data loss or a broken contract.
  - **A round cap,** 3 by default and set in config. Past the cap, report
    "needs a human" instead of posting another round.
  - **The verdict lives in the round comment's body.** Every round comment
    carries `verdict:` and `reviewed sha:` lines, and consumers read those, not
    the GitHub review state.
- **REST only.** Every `gh` call in shipped commands, agents and scripts uses
  REST `gh api` paths.
- **Tests:** `.test.sh` for every script these changes touch or add.

## Scope — out

- Anything specific to waves: labels, locks, the brief-Issue schema,
  orchestration. That's 02.
- Changing what a review checks. The bar in `code-reviewer.md` stays as it is,
  and only the round mechanics change.
- Auto-merge, or the reviewer approving through the GitHub review API.
- Where config lives, beyond reading the reviewer model and round cap from it.
  If no ADR has settled that yet, raise it as an ARCH handoff (see `README.md`,
  "Shared with the GitHub backlog adapter").

## Value dependency

Each fix has value on its own:

- `--id` and branch resume help anyone who runs epics in parallel.
- The review defaults cut rounds on every PR.

Build `--id` and branch resume first, because 02 can't be planned without them.

## Technical context

- **Existing systems:**
  - `commands/plan.md`, `commands/build.md`, `commands/review.md`
  - `agents/code-reviewer.md` and `agents/planner.md`
  - `reference/models.md`
  - `reference/coder-revise-mode.md`, which uses the Response format
  - `scripts/plan-artifacts.mjs`: `claim` is where `--id` lands
- **House stack:** plain Node 22 with no dependencies, and Bash tests run by
  preflight and CI.
- **Hard constraints:**
  - **The boot-path budget is at its cap with zero headroom.** agents+commands
    are 62,231 of 62,231 bytes, and caps only go down. Review protocol moves to
    `reference/`, and every added byte in `agents/` or `commands/` is paid for
    by a cut in the same PR.
  - Behaviour outside these flags and defaults is unchanged.
- **Deployment:** `feat:`. If REVISE or any consumer of the round comment has
  to change, it's `feat!:`, and the PR body says what consuming projects must
  do.

## Constraints

- **Data / compliance:** none new.
- **Deadline:** none.

## Open questions

- **Is changing the review contract a breaking change?** That covers the
  BLOCKING tags, the verdict in the body and the "needs a human" outcome past
  the cap. Check `coder-revise-mode.md` and the routine template
  `templates/routines/review-prompt.md` before deciding between `feat:` and
  `feat!:`.
- **How does `--id` interact with `plan-artifacts.mjs claim`?** Does it skip
  `claim`, or claim the given id? Decide so that repo-mode ids stay unique.
- **Branch resume:** merge the base or rebase onto it? The wave workers merge,
  so that history is never rewritten under an open PR.
