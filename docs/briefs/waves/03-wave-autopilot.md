# Feature: wave autopilot, with routines that run waves and a mapper that proposes conflicts

## Problem

After 02, a wave still needs a human in two places:

- **At the keyboard,** running `tick` and `phase` for each step.
- **Before the wave starts,** writing every `Depends on` and `Conflicts with`
  line by hand.

The second is where QuestionMe found its worst collisions. A dependency graph
didn't show that four briefs all rewrote `generateStandardAnswer`. It took an
agent mapping the files and functions each brief touches.

The cloud also has friction that QuestionMe worked around by hand:

- **Plugins.** Routines don't install plugins, so each one cloned a pinned tag.
- **Label filters.** The event trigger's label filter wasn't applied, so the
  worker fired on every label.
- **Version drift.** v0.2.2, v0.2.5 and v0.2.8 were all in use at once.

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

## Scope — out

- **Creating routines through the API** (a bootstrap command that calls
  `RemoteTrigger`). Prompts and documentation only. It can be a follow-up
  brief.
- **Changes to how waves behave.** Selection, phases, locks and the close rule
  belong to 02.
- **Writing relation lines** to Issues without a human accepting them.
- **QuestionMe's environment and trigger ids.** They're examples in the
  documentation, never defaults.

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
- **Reference:** QuestionMe's five routines:
  - start runs daily and is also called by tick;
  - tick runs hourly and on `pull_request.closed`;
  - plan/build runs on `issues.labeled` plus an hourly sweep;
  - review runs on PR opened or synchronize, plus an hourly sweep;
  - revise runs hourly.

  Their setup is tracked in `tofbabs/question-me` Issue #748.
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

- **Is `enabled_plugins` on routines reliable now?** Verify it before choosing
  between it and a bootstrap clone.
- **Is the event label filter applied now?** If not, keep the early exit, or
  dispatch on a narrower event.
- **Can revise run on new review comments instead of hourly?** That would
  remove up to an hour of latency per round.
- **How does `/conflicts` map what a brief touches before the brief has a
  plan?** Should it run after planning, against the plans' files? That's more
  accurate, but it needs a plan phase first.
