# Waves: take a set of briefs from brief to PR, with only the merge left to a human

A **wave** is a set of briefs that are safe to build at the same time. Every
dependency has merged, and no two of them change the same function or contract.
The wave takes each brief through plan, build, review and revise to a PR. A
human merges. When every PR in the wave is closed, the next wave opens on its
own.

This ports what QuestionMe (`tofbabs/question-me`) built as repo-local skills
and ran end to end on 2026-10-08. See `.claude/skills/wave/SKILL.md` and
`.claude/skills/wave-phase/SKILL.md` at commit `e0fde3f0`, set up in PR #749
and tracked in Issue #748. Port the mechanism, not the repo facts.

```
01 parallel-safe plan/build/review  ──►  02 wave core  ──►  03 wave autopilot
   (useful without waves)                (run by hand)       (routines, /conflicts)
```

## Implementation order

| # | Brief | Depends on | Lane | Ships as |
|---|-------|-----------|------|----------|
| 1 | [Parallel-safe plan, build and review](01-parallel-safe-pipeline.md) | — | deliberate | `feat:`, or `feat!:` if the review contract breaks |
| 2 | [Wave core](02-wave-core.md) | 1 **released** | deliberate (config ADR) | `feat:` |
| 3 | [Wave autopilot](03-wave-autopilot.md) | 2 **merged** | deliberate | `feat:` |

1. **Build 01 first.** Wave workers call plan, build and review in parallel,
   and today those collide on ids and branches.
2. **Plan 02 once 01 is merged.** Its phase worker relies on `--id` and branch
   resume.
3. **03 can be planned while 02 is being built.** Build it after 02 merges,
   because its routines only call the wave commands.
4. **Dogfood after 01 and 02 ship in a release.** This repo runs the last
   released plugin. Once they ship, 03 can be the first brief that a wave runs
   here.

The split is deliberately coarse. Each brief is one PR, and each PR adds CI and
review rounds, so the briefs are cut only where one of these holds:

- the release signal changes;
- a one-way-door decision would otherwise hold up unrelated work;
- a piece is worth merging before the rest exists.

## Decisions already made

These were settled while scoping. Don't reopen them during planning.

- **Only one wave is active at a time.** `start` refuses while any wave is
  open.
- **PRs close a wave.** A wave closes when every brief in it has a PR and every
  one of those PRs is closed. Merged means the brief is done. Closed without
  merging returns the brief to the pool for a later wave. Closing a wave runs
  `start` again in the same session.
- **The human merge is the only human step in the loop.** No agent approves or
  merges.
- **GitHub is the only state.** That means labels, Issue bodies and PR
  comments. No session remembers anything between runs. Every run works out
  each brief's phase again from evidence and never trusts a plan's `Status:`
  line.
- **Briefs still start as hand-written files** in `docs/briefs/`. A brief
  Issue is a tracking record that points at one, and it doesn't replace it.

## Shared with the GitHub backlog adapter

[`../github-backlog/`](../github-backlog/README.md) overlaps with
waves. Whichever is planned first settles these decisions, and the other
follows:

- **Where per-repo config lives.** Both briefs have the same open question.
  One ADR answers it for both: the backlog store, the wave settings and the
  reviewer model.
- **The plan id is the Issue number** when an Issue exists (`EPIC-<issue>`,
  `FAST-<issue>`). 01's `plan --id` is how that's expressed in repo mode. The
  adapter should adopt the same rule, not invent a second counter.
- **Label namespaces.** The adapter's `brief`/`epic`/`story` labels and the
  wave's `brief`/`wave:*`/`phase:*` labels must not collide. 02 owns
  `wave:*`/`phase:*`, and the adapter owns the rest.
- **Untrusted Issue text.** The adapter's rule holds for waves as well. Only
  structured lines from Issue bodies are parsed, and comment text is never fed
  to an agent as instructions.

Waves don't depend on the adapter. They work with `store=repo`. If the adapter
ships, a brief Issue in github mode is the brief itself, and its `Brief:` line
becomes optional.

## Status

| # | Planned | Built | Merged |
|---|---------|-------|--------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
