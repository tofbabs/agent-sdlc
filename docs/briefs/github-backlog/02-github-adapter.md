# Feature: a GitHub store where the brief and its plan live in one Issue, and `/write-brief`

Depends on `01-store-interface.md` being merged. This brief adds one adapter
behind that interface and the `/write-brief` command that is the interface's
first `write brief` caller. It does not touch the other commands or agents
beyond whatever 01 left as the extension point.

## Problem

Briefs and plans live in `docs/briefs/` and `backlog/` files, so:

- Nobody outside the checkout sees a brief or a plan until its PR merges. PMs,
  reviewers and stakeholders live in GitHub Issues.
- Briefs and plans have to be ferried between checkouts. `plan-artifacts.mjs`
  exists only because untracked plan files raced on IDs, failed to ship and
  went stale (`reference/plan-artifacts.md`). A shared store that assigns IDs
  removes the problem instead of managing it.
- Teams that already track work in Issues keep two backlogs, and one of them
  drifts. The wave already makes every brief an Issue, but only as a four-line
  pointer to a file, so a brief is still two objects that must agree.
- Nothing helps write a brief. It is copied from `templates/brief.md` by hand.

## Users

- **The person writing a brief.** They want to draft it once, in one place,
  and not open a PR just to propose work.
- **The engineer running `/plan`, `/build`, `/review`.** Same commands, same
  output. Only where the brief and plan live changes.
- **Teammates and stakeholders.** They want to read, comment on and track a
  brief and its plan in GitHub without cloning anything.
- **The agents.** They need exactly the text they get today.

## Outcome

The store resolves as **`--store` flag > `backlog.store` in
`.claude/agentic-sdlc.json` > `repo`**. `repo` stays the default, and repo mode
is byte-for-byte unchanged: same files, same paths, same commits.

**`/agentic-sdlc:write-brief <slug> [--store repo|github] [--lane fast|standard]`**
drafts a brief from `templates/brief.md` with the user, section by section, then
hands it to the store's `write brief` op:

- **repo:** writes `docs/briefs/<slug>.md`, refusing if it exists, and prints
  `/agentic-sdlc:plan docs/briefs/<slug>.md`. It opens no Issue.
- **github:** creates one Issue, labelled `brief`. Its title is the brief's
  `# Feature:` line, and its body is the wave's four-line header followed by the
  brief. It writes no file to the repo, and it prints
  `/agentic-sdlc:plan <issue#>`.

  ```
  Brief: inline
  Lane: standard
  Depends on: —
  Conflicts with: —

  # Feature: …
  ```

  `Brief: inline` says the brief is this body. It replaces the file path the
  wave's header carries in repo mode. `brief-issue.mjs` learns the value, so the
  wave selects, plans and builds these Issues like any other brief Issue.

**Under the github store, the brief Issue is also the plan Issue.**

- `/plan <issue#>` reads the brief from the Issue body (below the header) and
  claims `EPIC-<issue#>` or `FAST-<issue#>`: the plan id is the Issue number,
  the rule the wave already uses, so there is no second counter. It writes the
  plan into that same Issue. It creates no epic Issue and no story Issues.
- **The plan is one comment on the brief Issue**, whose first line is the
  marker `<!-- agentic-sdlc:plan EPIC-<n> -->` (or `FAST-<n>`). Below the
  marker is the same markdown as `backlog/EPIC-<n>.md`: header block, ARCH
  table, stories, `## Debt`. Every later write finds the comment by its marker
  and edits it in place. A second plan comment is never posted. This is the
  convention the wave board already uses (`<!-- wave-board:<n> -->`).
- `/build EPIC-<n>` reads the plan from that comment and writes story status,
  ARCH resolutions and each story's landing commit and PR back into it, at
  story boundaries only. It opens one PR per epic, as today, with
  `Closes #<n>`.
- `/review <PR>` maps the PR's branch (`feat/EPIC-<n>`) to Issue `#<n>` and
  reads the stories from the plan comment.
- ADRs and `## Debt` rows still go to the repo through `carry`, unchanged. The
  plan itself is not committed to the branch.

**Why a comment and not a section of the body.** GitHub has no
compare-and-swap on an Issue body: an edit replaces the whole body. A plan in
the body would race every human edit of the brief, and whoever wrote last would
silently drop the other's change. With the plan in its own comment, the body
stays human-owned after `/write-brief` creates it, and the plan has exactly one
writer at a time (the `/plan` or `/build` run, serialised by the wave's phase
lock when a wave drives it). It also gives the brief and the plan a 65,536-char
limit each instead of sharing one, and keeps each one's edit history separate.
The cost is that the plan sits below the body instead of inside it. The adapter
adds no link to the body, because writing the body is what this design avoids.

**Size limits.** A body or comment is capped at 65,536 characters. The epic
budget (`plan.epic.max_lines`, 150 lines) keeps a plan far below that, so an
over-size plan means the budget check already failed. Every write measures
first. Over the cap, it refuses, prints the size and the limit, and writes
nothing. It never truncates and never splits across comments. The same rule
applies to a brief in `/write-brief`.

**Parts.** A brief that SPLITs (`reference/epic-budget.md`) keeps Part 1 in its
own Issue as `EPIC-<n>`. `/plan` creates one Issue per later part, labelled
`brief`, with the header `Brief: #<n>`, `Depends on:` the previous part's Issue,
and the part's STUB as its plan comment. Each part's id is its own Issue number,
so the wave orders parts through `Depends on` with no new mechanism. This is
the only case where the github store makes more than one Issue for one brief.

**Traceability** stays what it is in repo mode, read from GitHub instead of a
file: the brief Issue holds the brief and the plan; the plan holds each story's
landing commit SHA and PR; each squash commit keeps its `[STORY-<id>]` tag; the
PR closes the brief Issue. The adapter writes these. They are never left to a
human to add.

## Success metric

Briefs taken from `/write-brief --store github` through `/plan`, `/build` and
`/review` to a merged PR, with **no** file added under `docs/briefs/` or
`backlog/` and **exactly one** Issue for the brief: **0 → 1**, on the next real
brief in this repo. Repo-mode epics in the same window show no regression in
tests or meter cost, and every existing repo-mode script test passes unchanged.
On that brief the trace is complete: **100%** of its stories record a commit
SHA and the PR in the plan comment, and the PR closes the brief Issue and
nothing else. `migrate --apply` run twice on this repo's open briefs creates or
rewrites **0** Issues the second time.

## Scope — in

- **The `github` adapter** behind 01's interface, shelling out to `gh api`
  (REST), as the wave does. Everything is in one PR: writing and reading the
  brief, claiming the id, writing and reading the plan, status, ARCH
  resolutions, the PR link and the landing commit. Splitting reads from writes
  would ship a half-state nobody can use.
- **`/agentic-sdlc:write-brief`.** A command, because the plugin ships commands
  and no skills, with its protocol in `reference/write-brief.md`. The command
  file is a short stub like `commands/wave.md`, because it sits in the boot
  path's `agents+commands` byte cap, which has about 2 KB of headroom. It works
  under both stores.
- **Mapping:**
  - the brief is the Issue body under the four-line header (`Brief: inline`);
  - the plan is the marker comment, in the same shape as `backlog/<ID>.md`;
  - the plan id is the Issue number, claimed with 01's `claim --id`;
  - the only label the adapter owns is `brief`, shared with the wave. The wave
    keeps `wave:*` and `phase:*`, and the adapter adds no status labels:
    status lives in the plan, and phase is the wave's;
  - the PR body says `Closes #<n>` for the brief Issue (or the part's Issue);
  - each story's squash commit keeps its `[STORY-<id>]` tag. After it lands,
    the adapter records its SHA and the PR in the story's section of the plan
    comment, the same place the repo adapter writes them in the file.
- **`brief-issue.mjs`** accepts `Brief: inline` and `Brief: #<n>` as well as a
  path. The wave's payload sets `plan: true` when the Issue has a plan comment,
  as well as when a `backlog/` file exists.
- **Fidelity:** `read plan` returns the comment minus its marker line, the same
  markdown shape as `backlog/<ID>.md`. Where a script needs a file
  (`mode-select.mjs --file`), the adapter materialises one under
  `.agentic-sdlc/` (gitignored run state), never under `backlog/`.
- **Store mismatch fails loudly.** `/build EPIC-<n>` under the github store,
  with no plan comment on `#<n>` but a `backlog/EPIC-<n>.md` on disk, refuses
  and says to pass `--store repo`. It never falls back silently. The reverse
  case refuses the same way.
- **A one-time setup subcommand:** create the `brief` label, and check that
  `gh` is authenticated with issue write scope. Fail early, with the fix, if
  not.
- **Optional migration of briefs only** (a `migrate` subcommand, opt-in). It
  moves open `docs/briefs/**/*.md` into brief Issues, passing the file as the
  body below the header (`gh api -F body=@<file>`). It never retypes or
  summarises the content. Rules:
  - **Dry run by default.** It prints what it would do, and `--apply` does it.
  - **Reuse before create.** An open `brief` Issue whose header already says
    `Brief: <that path>` is rewritten in place to `Brief: inline` plus the
    content. Its number, and with it the plan id, is kept. Otherwise it creates
    a new Issue.
  - **Idempotent.** Each body carries a hidden `<!-- agentic-sdlc:source <path> -->`
    marker, so a re-run updates instead of duplicating, and an interrupted run
    resumes.
  - **Relative links still resolve.** Links to repo files (ADRs, other briefs)
    are rewritten to blob URLs on the default branch.
  - **The repo files are left alone.** Deleting them is the user's own PR,
    after checking the migration. The script prints the paths to remove.
  - **Plans are not migrated.** A plan already in `backlog/` keeps its id,
    branch and commit tags, and finishes under `--store repo`. Moving it would
    renumber it to an Issue number and break all three.
  - Skipping migration is a supported path. Old briefs and plans stay readable
    as files, and new briefs go to Issues.
- **Tests** run against a faked `gh`, with no network, so CI stays fast and
  offline. They cover: write-brief under both stores, plan comment create then
  edit-in-place (never a second comment), the over-size refusal, the
  untrusted-author refusal, the store-mismatch refusal, the part Issues, and
  migration's dry run, re-run, interrupted run and in-place rewrite.

## Scope — out

- **Epic and story Issues, and the sub-issue tree.** The earlier draft made
  every epic a sub-issue of the brief and every story a sub-issue of its epic,
  with roll-up closing. The brief Issue holding the plan replaces that. Story
  Issues would cost one Issue and several writes per story and need GraphQL
  sub-issues, and they would split the plan across many bodies an agent has to
  reassemble. They would buy per-story assignment and closing, which nothing in
  the pipeline uses: a PR implements a whole epic. Revisit if teams need to
  assign or discuss single stories in GitHub.
- **Roll-up closing.** With one Issue per brief there is nothing to roll up:
  the PR closes it.
- **A frozen plan file on the branch.** The PR links the plan comment, and its
  edit history is the record. If reviewers come to need a snapshot, that is a
  one-way door for a later ADR.
- ADRs, `docs/TOOLING-DEBT.md` and the pair log stay in the repo.
- GitHub Projects (v2): boards, custom fields, iterations.
- Other trackers. The interface already allows them, but none are built.
- Two-way sync or ongoing mirroring. Migration is one-way and run once. Moving
  from Issues back to the repo is not built.
- Migrating plans, ADRs, `TOOLING-DEBT.md` or `backlog/pair/`.
- `/write-brief` opening a wave tracking Issue under the repo store. Repo mode
  stays as it is today: a human opens the four-line Issue if a wave should
  pick the brief up.
- Turning the self-improvement routine's proposed-brief issues into briefs
  automatically.
- Any change to plan content, lanes, modes or the review protocol.

## Value dependency

Nothing ships partially. Read without write is not usable, which is why this is
one brief. `/write-brief` has some value under the repo store alone, but its
only repo-mode job is copying a template, so it is not worth its own PR. 01
already carries the part that has value on its own.

## Technical context

- Builds on 01's `backlog-store.mjs`, its `write brief` op and its selector.
  The setting is `backlog.store` in `.claude/agentic-sdlc.json`, read only
  through `config.mjs` (ADR-0006, ADR-0007). Valid values become `repo` and
  `github`.
- The brief-Issue header and its parser: `scripts/brief-issue.mjs`,
  `reference/wave.md`, `docs/briefs/waves/02-wave-core.md`. The marker-comment
  edit-in-place precedent is the wave board in `reference/wave.md`.
- `gh` is already a hard dependency. Don't add Octokit or any other runtime
  dependency. Use `gh api` (REST) as the wave does.
- Headless: every `gh` call the adapter and `/write-brief` make needs a scoped
  allow rule that holds under `claude -p` (EPIC-3, ARCH-1).
- Issue, comment and label writes trigger none of this repo's workflows. They
  are on `pull_request`, `push` and `merge_group` only, so github mode costs no
  Actions minutes beyond today's.
- Boot path: `commands/write-brief.md` counts toward the `agents+commands` cap
  in `scripts/size-budget.json`. Everything beyond a stub goes in `reference/`.
- Ships in the plugin: `feat:`.

## Constraints

- **Security:** anyone with write access can edit Issue bodies, and on a public
  repo anyone can open an Issue or comment. The adapter reads a brief only from
  an Issue whose author is `OWNER`, `MEMBER` or `COLLABORATOR`, and a plan only
  from a marker comment by such an author. A marker comment by anyone else is
  ignored, and two trusted marker comments for one id is a refusal, not a
  guess. Other comments never reach an agent. Untrusted text never reaches an
  agent as instructions. This is the same rule as the wave's and the
  self-improvement decision (`self-improvement/README.md`).
- **One writer per plan.** Only the orchestrating command writes the plan
  comment, never a subagent: architects return resolutions and the
  orchestrator applies them. A write re-reads the comment first and replaces it
  whole.
- **Rate limits:** write at story boundaries, never per pair turn.
- Deadline: none.

## Open questions

- **Squash-merge and closing keywords.** Check that `Closes #n` in the PR body
  still closes the Issue on a squash-merge into a non-default base, and decide
  what the adapter does when it doesn't.
- **Parts and closing.** Part 1's PR closes the brief Issue while later parts
  are still open in their own Issues. Is that acceptable, or should Part 1's PR
  say `Refs #n` and the last part close the brief?
- **IDs across stores.** Repo-mode `claim` counts `backlog/` files and
  branches. In a project that switches stores, it must not hand out a number
  that is already a github-store plan's Issue number. Does `claim` also check
  `feat/EPIC-<n>` branches (it does) and is that enough?
- **Comment author under automation.** A cloud routine writes as whatever
  identity its token has. Check that this identity's `author_association` is
  trusted on the repos that run waves, or the plan it writes will be ignored on
  the next read.
