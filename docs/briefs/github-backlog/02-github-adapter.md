# Feature: a GitHub Issues backlog store

Depends on `01-store-interface.md` being merged. This brief adds one adapter
behind that interface. It does not touch the commands or agents beyond
whatever 01 left as the extension point.

## Problem

Plans live in `backlog/` files, so:

- Nobody outside the checkout sees a plan until its PR merges. PMs, reviewers
  and stakeholders live in GitHub Issues.
- Plans have to be ferried between checkouts. `plan-artifacts.mjs` exists only
  because untracked plan files raced on IDs, failed to ship and went stale
  (`reference/plan-artifacts.md`). A shared store that assigns IDs removes the
  problem instead of managing it.
- Teams that already track work in Issues keep two backlogs, and one of them
  drifts.

## Users

- **The engineer running `/plan`, `/build`, `/review`.** Same commands, same
  output. Only where the plan lives changes.
- **Teammates and stakeholders.** They want to read, comment on and track a
  brief, its epic and its stories in GitHub without cloning anything.
- **The agents.** They need exactly the text they get today.

## Outcome

With the store set to `github`, in project config or with `--store github`:

- **a brief is the umbrella**, an issue a human writes. Each epic `/plan` makes
  from it is a sub-issue of the brief. A brief can have several epics.
- **each story is a sub-issue of its epic** and of no other epic. A FAST plan
  is a sub-issue of its brief, and its tasks stay a task list in its body.
- `/plan` creates this tree and records ARCH handoffs on the epic.
- `/build` reads the plan from those issues and updates story status at story
  boundaries. It opens one PR per epic, as today. That PR links to the
  **story** issues it implements, which it closes when it merges. It does not
  link to the epic. A PR never carries stories from more than one epic.
- `/review` reads the stories from the issues the PR links to.
- **Closing rolls up.** An epic closes when all its stories are closed, and a
  brief closes when all its epics and FAST plans are closed.

**Traceability runs both ways.** From any story issue you can reach its epic,
its brief, its PR and the squash commit that landed it. From any PR or commit
you can reach its stories, their epic and the brief. The adapter writes these
links. They are never left to a human to add.

`repo` stays the default, and repo mode does not change.

## Success metric

Epics planned, built and reviewed end to end with `store=github`, with no plan
file written to `backlog/`: **0 → 1**, on the next real epic in this repo.
Repo-mode epics in the same window show no regression in tests or meter cost.
This repo's open briefs and plans migrate with `migrate --apply`, and a second
run creates **0** new issues. On that epic, the trace is complete: **100%** of
its story issues link to the epic, the brief, the PR and a commit SHA. Its PR
closes every one of its stories and nothing outside its epic.

## Scope — in

- **The `github` adapter** behind 01's interface, shelling out to `gh` /
  `gh api`. Everything is in one PR: reading the brief, writing the plan,
  status, ARCH resolutions and the PR link. Splitting reads from writes would
  ship a half-state nobody can use.
- **Mapping:**
  - labels for brief, epic, FAST and story;
  - the tree brief → epic → story as sub-issues, with FAST as a direct child of
    its brief;
  - status as open/closed plus a status label;
  - the PR body has a closing keyword for each story issue (`Closes #<story>`),
    one per story, and the story issues are all in one epic. The adapter
    refuses to write a PR link that crosses epics;
  - each story's squash commit keeps its `[STORY-<id>]` tag and also references
    the story issue. After the commit lands, the adapter records its SHA and
    the PR on the story issue;
  - closing an epic once its last story closes, and a brief once its last
    child closes, is done by the adapter, not by a GitHub Action, so it costs
    no Actions minutes.
- **Fidelity:** the adapter returns the same markdown shape as
  `backlog/<ID>.md`, so agent prompts don't fork by store.
- **A one-time setup subcommand:** create the labels, and check that `gh` is
  authenticated with issue write scope. Fail early, with the fix, if not.
- **Optional migration when switching** (a `migrate` subcommand, opt-in). It
  moves existing `docs/briefs/*.md` and `backlog/EPIC-*.md` / `FAST-*.md` into
  Issues by passing each `.md` file as the issue body (`--body-file` or
  `gh api -F body=@<file>`). It never retypes or summarises the content, so the
  issue is the file. Rules:
  - **Dry run by default.** It prints what it would create, and `--apply` does
    it.
  - **Idempotent.** Each issue carries a hidden marker naming its source path,
    so a re-run updates the issue instead of duplicating it, and an interrupted
    run resumes.
  - **Open work only by default.** `Status: DONE` plans are skipped unless
    `--all` is passed. When they are migrated, they are created closed.
  - **Relationships survive.** Stories become sub-issues of their epic, and the
    epic links to its brief.
  - **Relative links still resolve.** Links to repo files (ADRs, other briefs)
    are rewritten to blob URLs on the default branch.
  - **The repo files are left alone.** Deleting them is the user's own PR,
    after checking the migration. The script prints the paths to remove.
  - Skipping migration is a supported path. Old plans stay readable as files,
    and new plans go to Issues.
- **Tests** run against a faked `gh`, with no network, so CI stays fast and
  offline. Migration has its own cases: dry run, re-run, interrupted run, and
  an over-size body.

## Scope — out

- ADRs, `docs/TOOLING-DEBT.md` and the pair log stay in the repo.
- GitHub Projects (v2): boards, custom fields, iterations.
- Other trackers. The interface already allows them, but none are built.
- Two-way sync or ongoing mirroring. Migration is one-way and run once. Moving
  from Issues back to the repo is not built.
- Migrating ADRs, `TOOLING-DEBT.md` or `backlog/pair/`.
- Turning the self-improvement routine's proposed-brief issues into briefs
  automatically.
- Any change to plan content, lanes, modes or the review protocol.

## Value dependency

Nothing ships partially. Read without write is not usable, which is why this is
one brief. 01 already carries the part that has value on its own.

## Technical context

- Builds on 01's `backlog-store.mjs` and its selector.
- `gh` is already a hard dependency. Don't add Octokit or any other runtime
  dependency.
- Headless: every `gh` call the adapter makes needs a scoped allow rule that
  holds under `claude -p` (EPIC-3, ARCH-1).
- Issue and label writes trigger none of this repo's workflows. They are on
  `pull_request`, `push` and `merge_group` only, so github mode costs no
  Actions minutes beyond today's.
- Ships in the plugin: `feat:`.

## Constraints

- **Security:** anyone with write access can edit issue bodies, and on a public
  repo anyone can comment. Bodies count only when written by the author or a
  collaborator. Comments are excluded, or filtered by author association.
  Untrusted text never reaches an agent as instructions. This is the same
  concern as the self-improvement decision to keep attacker-written text away
  from the model (`self-improvement/README.md`).
- **Rate limits:** write at story boundaries, never per pair turn.
- Deadline: none.

## Open questions

- **Sub-issue support.** The brief → epic → story tree depends on sub-issues
  (GraphQL). Check that `gh` and the GitHub plans consuming projects use support
  two levels of nesting. If they don't, decide the fallback (a parent link in
  the body, plus a task list on the parent) rather than dropping the hierarchy.
- **Squash-merge and closing keywords.** Check that `Closes #n` in the PR body
  still closes every story on a squash-merge into a non-default base, and decide
  what the adapter does when it doesn't.
- **Where do ARCH handoffs live?** In the epic body or in comments or issues of
  their own. If two architects resolve in parallel, a single writer or locking
  has to stop one overwriting the other.
- **Is the plan snapshotted?** Should `/build` commit a frozen `backlog/<ID>.md`
  so the PR shows what it was built against? It becomes a one-way door once
  reviewers rely on it.
- **Over-size files.** Issue bodies are capped at 65,536 characters. Should a
  plan that exceeds it be refused, split across comments, or have its story
  sections moved into the sub-issues? Refusing with a clear message is the
  floor.
- **IDs after migration.** Does `EPIC-3` keep its name in the issue title
  (`EPIC-3: …`) so old branch names, commit tags and decision records still
  join? Whatever the IDs decision below lands on, migrated items must follow it.
- **IDs:** a separate `EPIC-<n>` counter with the issue number alongside, or the
  issue number as the ID. This affects branch names, commit tags and ADR-0002's
  decision-record join.
