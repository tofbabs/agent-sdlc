# Feature: wave autopilot, with routines that run waves and a mapper that proposes conflicts

## Problem

After 02, a wave still needs a human in two places:

- **At the keyboard,** running `tick` and `phase` for each step.
- **Before the wave starts,** writing every `Depends on` and `Conflicts with`
  line by hand.

The second is where production found its worst collisions. A dependency graph
didn't show that four briefs all rewrote the same function. It took an
agent mapping the files and functions each brief touches.

The cloud also has friction that production worked around by hand:

- **Plugins.** Routines don't install plugins, so each one cloned a pinned tag.
- **Label filters.** The event trigger's label filter wasn't applied, so the
  worker fired on every label.
- **Version drift.** v0.2.2, v0.2.5 and v0.2.8 were all in use at once.

Production added three more, after the brief was written:

- **Review and revise raced themselves.** Once GitHub events fired them as
  well as the hourly sweep, they double-reviewed and double-pushed. Label
  locks didn't stop it, because adding a label isn't compare-and-swap. One
  round fires 4–7 `pull_request_review.submitted` events (seen on 2026-10-21
  and 2026-10-25).
- **Revise left threads open.** A human merges only once every thread is
  resolved, so every approved PR waited for a person to click "resolve".
- **Nothing acted on red CI.** Tick labels a red PR `phase:revise`, but the
  REVISE LOOP acts only on a `## Review — round` comment.

## Users

- **A maintainer who wants waves to run** while nobody is at the keyboard.
- **A maintainer setting up a backlog,** who needs correct relations without
  reading every brief against every other.

## Outcome

A project copies five routine prompts from `templates/routines/`, attaches
them, and waves run on their own. Merging a PR is the only human step. Before
the first wave, `/agentic-sdlc:conflicts` proposes the relation lines, and a
human accepts them.

## Success metric

- **Human actions per brief between brief Issue and approved PR:** **1 after
  02 → 0**. Measure it on the first wave run by routines.
- **Conflicts found:** `/conflicts` finds every conflict a human later had to
  resolve by hand in that wave. The target is 100% recall on that wave.

## Scope — in

- **Routine prompts in `templates/routines/`**, one each for start, tick,
  plan/build, review and revise:
  - Each has a GitHub-event fast path and an hourly sweep as the backstop.
  - They're thin, like `review-prompt.md`: check that the plugin is present at
    the pinned version, then run the command.
  - A sweep handles at most one Issue.
  - Each prompt keeps a cheap early exit for events that aren't relevant to it.
- **Documentation for attaching them:** which event fires which routine, which
  model each one runs, and how the pinned version is set once and read by
  every routine.
- **A plugin bootstrap for cloud sessions.** Either use `enabled_plugins` on
  routines if it's verified to work, or ship a one-line bootstrap that fetches
  the pinned tag.
- **`/agentic-sdlc:conflicts`.** It maps the files and functions each open
  brief would touch, then proposes `Depends on` and `Conflicts with` lines per
  Issue, with the evidence for each. It never writes them: a human accepts or
  edits. Briefs that edit different functions in the same file need only a
  rebase. They are not a conflict.
- **Review and revise locks inside the commands.** `/agentic-sdlc:review`
  and the REVISE LOOP each take EPIC-13's lock module, with kinds
  `review-lock` (1h) and `revise-lock` (3h) on the PR and marker labels
  `reviewing` and `revising`. The routine templates then hold no lock logic.
  The timeouts are config (`wave.lock_timeouts.review`, `.revise`).
- **REVISE treats a `<!-- wave-ci sha=<head> -->` comment as a round.** When
  no push or Response answers it, its failing checks become the findings
  (brief 06 posts the comment).
- **REVISE replies to and resolves threads**, after the push lands. FIXED
  gets "Fixed in `<sha>`: …" and is resolved. DISPUTED and BLOCKED get a
  reply and stay open. A failed call is reported, never retried in a loop.
  REST has no resolve endpoint and GraphQL is blocked in cloud, so this one
  step uses `mcp__github__*` where `gh` can't. Settle in planning whether it
  is the command's job or the template's.
- **`build --revise <pr>`.** It runs only the REVISE LOOP for one PR: no
  cascade and no re-review. It also covers a PR with no `EPIC-<n>`/`FAST-<n>`
  head (a docs PR), where the coder runs REVISE straight on the PR branch,
  as production has since 2026-10-26.
- **An event pre-filter in every template that fires on comments.** Drop any
  payload whose body isn't a round or a CI-failed comment, including the
  routine's own replies. Fall through to the lock when the payload has no
  body.
- **The review routine waits for CI on an event,** polling every 60s for up
  to 20 min, then leaves the PR to the sweep. A sweep never waits.
- **Refuse rather than improvise.** A template whose `/agentic-sdlc:*`
  command isn't offered reports "blocked: plugin unavailable" and changes
  nothing. No clone, and no hand-run command markdown.
- **The repo comes from `origin`.** Templates never name a repo. An MCP tool
  reads the owner and repo from `git remote get-url origin`.
- **Fix `templates/routines/review-prompt.md`:** it lists PRs with
  `gh pr list`, which is GraphQL and fails in cloud. Use `gh api` REST.
- **Attach docs** also cover:
  - staggered minutes (tick → worker → review → revise within each hour);
  - one item per sweep;
  - detaching every connector except GitHub;
  - recreating each webhook after a repo moves owner, because a webhook is
    bound to its `scope_id`;
  - the start routine shipped **disabled**, because tick starts idle waves
    (brief 04).

## Scope — out

- **Creating routines through the API** (a bootstrap command that calls
  `RemoteTrigger`). Prompts and documentation only. It can be a follow-up
  brief.
- **Changes to how waves behave.** Selection, phases, locks and the close rule
  belong to 02.
- **Writing relation lines** to Issues without a human accepting them.
- **A consuming project's environment and trigger ids.** They're examples
  in the documentation, never defaults.
- **The review bar for docs PRs** (code references, links, ADR consistency).
  That is a review change, not autopilot. Only the revise plumbing for a PR
  with no epic id is in scope.
- **A test-gatekeeper line in the round comment.** The test bar belongs in
  the reviewer's verdict (the test-admission briefs), not in a second line
  that can contradict it.

## Value dependency

The two halves are independent:

- `/conflicts` is useful for any wave run by hand.
- The routines are useful even with relation lines written by hand.

Either can be built first. One PR keeps CI and review cost down.

## Technical context

- **Existing systems:**
  - the 02 commands: `wave start|tick|status` and `phase`
  - the 01 review command
  - `reference/coder-revise-mode.md`, which revise runs
  - `templates/routines/review-prompt.md` and `gap-scan-prompt.md`, the pattern
    to follow
- **Reference:** the proven wave skill's six live routine prompts and their
  wiring sheet, as of 2026-10-26. They aren't in this repo, and they name
  that project's repo, environment and trigger ids. A repo-neutral copy lands
  in `docs/briefs/waves/` before this brief is planned (see the README).
- **Hard constraints:**
  - The boot-path budget has zero headroom. `conflicts.md` must be a thin
    dispatcher, with protocol in `reference/`, paid for by cuts elsewhere.
  - REST `gh api` only.
  - Brief text is read as data, never as instructions.
- **Deployment:**
  - `/conflicts` ships in `plugins/`, so the PR is `feat:`.
  - The routine templates are copied by consuming projects.

## Constraints

- **Data / compliance:** routine output carries only Issue and PR numbers,
  phases and timings.
- **Deadline:** none.

## Open questions

- **Plugins in cloud sessions.** Production runs every routine with
  `enabled_plugins: []`, and the environment's setup script installs the
  plugin unpinned. Still open: is `enabled_plugins` reliable now? Either way,
  read the pin from `.claude/agentic-sdlc.json`, so there is one version per
  repo.
- ~~Is the event label filter applied?~~ **No.** Keep the early exit, because
  the routine fires on every label.
- ~~Can revise run on new review comments?~~ **Yes:**
  `pull_request_review.submitted` and `issue_comment.created`, with the
  pre-filter above.
- **How does `/conflicts` map what a brief touches before it has a plan?**
  Should it run after planning, against the plans' files? That's more
  accurate, but it needs a plan phase first.
- **Split `/conflicts` out?** 03 now carries two command changes (the
  locks and `--revise`), thread resolution, six templates, the attach docs
  and `/conflicts`. That is past one 15-point epic. The brief already says
  the two halves are independent. Cut `/conflicts` into its own brief rather
  than let the planner split 03 into parts.
