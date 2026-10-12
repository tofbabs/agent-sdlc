# EPIC-7: Parallel-safe plan, build and review

- Outcome: parallel `/plan` runs never share an id, `/build` resumes `feat/<id>`, review uses a configured model, reads only green heads, converges and caps, and no shipped `gh` call uses GraphQL.
- Success metric: review rounds per PR on the next three epics: median 1, none past 3 (baseline: EPIC-1..3 PR comments).
- Status: TODO
- Source: `docs/briefs/waves/01-parallel-safe-pipeline.md`. Build 7-1 and 7-2 first (brief 02 needs them).
- Artifacts: docs/adr/0006-per-repo-pipeline-config.md, docs/adr/0005-review-round-comment-contract.md, docs/briefs/waves/01-parallel-safe-pipeline.md, docs/briefs/waves/README.md
- Lane: deliberate — recommended deliberate (rubric 1): floor one_way_door fired, lane is deliberate
- Release: `feat:` (ARCH-4 / ADR-0005). The PR body lists behaviour changes; consumers have no required action.
- **Every story:** boot path (agents+commands) is at cap, 62,231 B, caps only shrink (`scripts/size-budget.json`). New protocol goes in `reference/`; pay for any added boot byte with a cut in the same PR; preflight size check must pass. Every touched or new `scripts/*.mjs` needs its `scripts/<name>.test.sh`.

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | `plan --id` vs `claim`: skip claim, or claim the given id? | STORY-7-1 | RESOLVED |
| ARCH-2 | Branch resume: merge base into `feat/<id>`, or rebase? | STORY-7-2 | RESOLVED |
| ARCH-3 | Where per-repo config (reviewer model, round cap) lives | STORY-7-4, 7-8 | RESOLVED |
| ARCH-4 | Review round-comment contract (BLOCKING tags, body verdict, "needs a human"): `feat:` or `feat!:`? | STORY-7-6, 7-7, 7-8, 7-9 | RESOLVED |

### ARCH-1: `--id` and `claim`
- status: RESOLVED
- reversibility: TWO-WAY
- blocks: [STORY-7-1]
- category: contract (run-report-categories.mjs)

**Decision:** `--id` **claims the given id**. It does not skip `claim`. Add
`plan-artifacts.mjs claim <EPIC|FAST> --id <KIND-n>`. The kind must match the
id's prefix, and the id must match `^(EPIC|FAST)-\d+$`. Run the same scan as
`highestTaken`: every worktree's `backlog/` and every local and remote ref's
`backlog/` tree, after `fetch origin`. If `backlog/<id>.md` turns up anywhere,
exit non-zero and name the first worktree or ref where it was found (AC2 asks
for one location). Otherwise create it with the same `openSync(…, 'wx')` and the
same stub line, and print the same `backlog/<id>.md` line. That `wx` is what
lets only one of two concurrent same-id runs succeed (AC4). It must not retry
with `n+1`. A taken id is an error, never a reason to pick another number.
With no `--id`, the code path stays exactly as it is today (AC3).
**Why:** Skipping `claim` would drop the exclusive create and the cross-branch
scan. Those two are the whole uniqueness guarantee, and the given-id path needs
them more than auto-numbering does. Claiming keeps one code path, one stub
format and one output contract for `/plan` and the github adapter.
**Note:**
- Id rule for both briefs: in github mode the id is the Issue number,
  passed as `--id`, and the adapter never uses the counter. Auto-numbering
  already skips past any id it finds on a branch, so mixing the two in one repo
  gives gaps, never collisions. The reverse case is an Issue number that
  equals an auto-claimed id. That fails loudly under AC2, which is correct.
- Uniqueness across machines (two cloud sessions, same `--id`) is not
  something `wx` can give. It is the caller's job. Waves get it from Issue
  numbers being unique.
- `commands/plan.md` passes `--id` through, and `reference/fast-mode.md`
  L39-44 does the same for FAST. Keep the boot-byte delta at zero or below.

### ARCH-2: merge or rebase on resume
- status: RESOLVED
- reversibility: TWO-WAY
- blocks: [STORY-7-2]
- category: lifecycle (run-report-categories.mjs)

**Decision:** **Merge.** On resume, run `git merge --no-edit origin/<base>` in
the epic worktree. Never rebase. On a conflict, run `git merge --abort`. Then
stop and report the conflicting paths and the two shas. The branch stays exactly
as it was pushed, and nothing is resolved automatically. Put the logic in a
`plan-artifacts.mjs resume <ID> --base <base>` subcommand, tested against a
bare-repo fixture. If `origin/feat/<id>` exists, it runs `worktree add
../wt-<id> feat/<id>` (tracking it, no `-b`) and then the merge. If the branch
doesn't exist, it does what `build.md` L82 does today. `build.md` calls the
subcommand in place of the literal `worktree add -b` line.
**Why:** This is the house pattern. `build.md`'s REVISE LAND already runs
`git merge origin/<base>` on the epic branch. A rebase would need a force push,
and `.claude/settings.json` denies `git push --force*` / `-f*`. It would also
rewrite history under an open PR, which AC4 forbids.
**Note:**
- The plan already committed on `feat/<id>` is the plan that gets built.
- If `carry` is called on a resumed branch, it must not die just because the
  plan file is missing from the planning checkout. Skip `carry` when
  `backlog/<id>.md` is already tracked on the branch and no untracked copy
  exists. If an untracked copy exists and differs, `carry`'s existing refusal
  stands, and the human decides.
- A local `feat/<id>` with no remote is an edge case. Use the local branch,
  and don't create a second one.

### ARCH-3: config location
- status: RESOLVED
- reversibility: ONE-WAY → `docs/adr/0006-per-repo-pipeline-config.md`
- blocks: [STORY-7-4, STORY-7-8]
- category: contract (run-report-categories.mjs)

**Decision:** Per-repo settings go in a committed `.claude/agentic-sdlc.json`
(`{"schema":1,"review":{"round_cap":3},…}`). Only the new
`scripts/config.mjs` reads it. Commands run `config.mjs get <dotted.key>`, which
prints the effective value with the default applied. A missing file means every
default applies. A bad value or bad JSON exits non-zero, and the command stops.
An unknown key gets a warning and is ignored. EPIC-7 adds only
`review.round_cap` (integer ≥ 1, default 3). The **reviewer model stays on the
existing `**Agent models:**` line** in `CLAUDE.md` (`code-reviewer=<m>`).
Precedence is `--model`/`--fable` > that line > the documented fallback,
**`opus`**, which `reference/models.md` states by name. `/review` always passes
`model:`.
**Why:** It has to be committed (for cloud sessions) and script-readable (for
the store adapter and waves). Plugin `userConfig` is per user and invisible to
Bash scripts, as verified in the docs. More `CLAUDE.md` lines would force
scripts to parse prose. The models line already exists, and moving it would be
a breaking change.
**Note:** STORY-7-8 creates `config.mjs` with `config.test.sh`: missing file,
valid, bad JSON, wrong type, unknown key, schema≠1. STORY-7-4 needs no new
script, because the model is resolved from `CLAUDE.md` as today. It only edits
`models.md`, `review.md` and `code-reviewer.md` L14-17. github-backlog and
waves 02 add their own keys under this ADR.

### ARCH-4: review round-comment contract
- status: RESOLVED
- reversibility: ONE-WAY → `docs/adr/0005-review-round-comment-contract.md`
- blocks: [STORY-7-6, 7-7, 7-8, 7-9]
- category: contract (run-report-categories.mjs)

**Decision:** The finding line is
`- F<n>: <SEVERITY> [<finding_category>] <BLOCKING|NON-BLOCKING>[ RESOLVED] — …`.
The tag goes **after** the category, so ADR-0001's prefix and `FINDING_LINE`
still parse. An untagged (legacy) line reads as BLOCKING. Rounds 2 and up
re-list earlier ids with `RESOLVED` or leave them open. `run-report.mjs` skips
`RESOLVED` lines. `verdict: REQUEST_CHANGES` is used if and only if an open
BLOCKING finding exists. Otherwise the verdict is `APPROVE`, and NON-BLOCKING
findings are advisory and never revised. The body's `verdict:` and
`reviewed sha:` are authoritative for every reader. `roundVerdict` reads the
body first and falls back to GitHub state only when the body has no verdict
line. "needs a human" posts nothing. The cap is `review.round_cap`, and REVISE
uses the same cap. **Release: `feat:`, not `feat!:`.**
**Why:** Nothing a consuming project owns has to change. The verdict and sha
lines already exist, and the tag is additive in a slot old parsers ignore. The
verdict vocabulary and the run-report schema are unchanged. The cap posts no
token. Every parser ships in the same plugin release. The routine template
only delegates to `/review`.
**Note:**
- The PR body gets a "Behaviour changes" section, not a list of consumer
  actions: the default cap drops from 4 rounds to 3, APPROVE may carry
  advisory findings, `/review` skips red or pending CI, and the reviewer model
  is always passed.
- `outcomes.mjs` doesn't parse round comments, because it gets
  `--findings N`. STORY-7-9 AC1 is satisfied by `run-report.mjs` plus
  `/review` passing only *open* findings as N.
- In `code-reviewer.md`, remove the "Round 4 or later" line. `/review` refuses
  before the reviewer is spawned.

## Stories

### STORY-7-1: `plan --id <id>`

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): score 3 in the gap resolves to PAIR, flagged borderline
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: M
- select: risk_class=none@brief:L53 one_way_doors=0@brief:L53 existing_pattern=yes@brief:L107 modules_crossed=3@brief:L53 review_bounced=no@brief:L53 risk_kind=code@brief:L53
- depends_on: []
- blocked_by_arch: []

**As a** maintainer running epics in parallel **I want** to name the plan id **So that** two planners never collide.

**Acceptance criteria**
1. Given `--id EPIC-9`, when `/plan` runs, then it writes `backlog/EPIC-9.md` per ARCH-1 and does not take the next free number.
2. Given `backlog/<id>.md` exists on the base or on `feat/<id>` (local or remote), then it exits non-zero naming where it was found and writes nothing.
3. Given no `--id`, then `claim` behaviour and output are unchanged (existing tests pass).
4. Given two concurrent runs with the same `--id`, then exactly one succeeds.

**Technical notes**
- `scripts/plan-artifacts.mjs` (`claim`), `commands/plan.md`, `reference/plan-artifacts.md`, `reference/fast-mode.md` L39-44; extend `plan-artifacts.test.sh`. Id matches `^(EPIC|FAST)-\d+$`.

**Out of scope**
- Issue-number derivation (github adapter), locks, labels.

### STORY-7-2: `/build` resumes an existing `feat/<id>`

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): score 4 at or above 4 is PAIR
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: M
- select: risk_class=none@brief:L56 one_way_doors=0@brief:L56 existing_pattern=no@brief:L56 modules_crossed=2@brief:L56 review_bounced=no@brief:L56 risk_kind=code@brief:L56
- depends_on: []
- blocked_by_arch: []

**As a** memoryless session **I want** build to pick up a plan an earlier session committed **So that** build does not fail on `worktree add -b`.

**Acceptance criteria**
1. Given `origin/feat/<id>` exists, when `/build <id>` runs, then the worktree checks out that branch (no `-b`) and the committed plan is the one built.
2. Given the branch exists, then it is brought up to date with `origin/<base>` per ARCH-2; a conflict stops the run with a report, never a silent overwrite.
3. Given no remote branch, then behaviour is today's `worktree add -b`.
4. Given a resumed branch, then no pushed history is rewritten (unless ARCH-2 says otherwise).

**Technical notes**
- `commands/build.md` ~L82 and L258. Prefer a `plan-artifacts.mjs` subcommand (testable, saves `build.md` bytes); `.test.sh` with a bare-repo fixture.

**Out of scope**
- REVISE worktrees, resuming mid-epic story progress.

### STORY-7-3: REST-only `gh`

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): score 3 in the gap resolves to PAIR, flagged borderline
- estimate: M
- select: risk_class=none@brief:L76 one_way_doors=0@brief:L76 existing_pattern=yes@AC2 modules_crossed=6@brief:L76 review_bounced=no@brief:L76 risk_kind=code@brief:L76
- depends_on: []
- blocked_by_arch: []

**As a** cloud-session worker **I want** no GraphQL **So that** `gh` works where GraphQL is blocked.

**Acceptance criteria**
1. Given shipped `commands/`, `agents/`, `reference/`, `scripts/`, then no `gh pr view|list|checks|review|comment|create` or `gh issue` remains; each is a `gh api repos/{owner}/{repo}/...` REST call.
2. Given a stub `gh` that fails on any `graphql` request, when `outcomes.mjs` and `run-report.mjs` run their fixtures, then both pass.
3. A check in preflight or an existing test fails if a banned `gh` subcommand is reintroduced.

**Technical notes**
- Sites: `review.md` L17-18, `build.md` L255/276, `pair-loop.md`, `coder.md` L67, `code-reviewer.md` L130-145, `coder-revise-mode.md` L22, `outcomes.md` L40, `outcomes.mjs`, `run-report.mjs` ~L798. Tests: `outcomes.test.sh`, `run-report.test.sh`. `outcomes.md` already allows overriding the gh binary.
- REST: `pulls/<n>`, `pulls/<n>/reviews`, `issues/<n>/comments`, `commits/<sha>/check-runs`.

**Out of scope**
- Changing what any call reads or posts.

### STORY-7-4: Explicit reviewer model

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): score 3 in the gap resolves to PAIR, flagged borderline
- estimate: S
- select: risk_class=none@brief:L59 one_way_doors=0@brief:L59 existing_pattern=yes@AC2 modules_crossed=4@brief:L59 review_bounced=no@brief:L59 risk_kind=code@brief:L59
- depends_on: []
- blocked_by_arch: []

**As a** maintainer **I want** the reviewer model from config **So that** no prose default steers it to Fable.

**Acceptance criteria**
1. Given a configured reviewer model, when `/review` spawns, then `Agent()` receives `model:` set to it.
2. Given `--model code-reviewer=<m>` or `--fable`, then it overrides config.
3. Given neither, then spawn fails loudly or uses the ARCH-3 documented fallback, never an unstated default.
4. `reference/models.md`, `review.md` and `code-reviewer.md` L16 carry no text steering toward Fable by default.

**Technical notes**
- A read path may need a small script (`.test.sh` required). Net boot bytes must fall.

**Out of scope**
- Other agents' models; where config lives (ARCH-3).

### STORY-7-5: Review only green heads

- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 2 at or below 2 is SOLO
- estimate: S
- select: risk_class=none@brief:L64 one_way_doors=0@brief:L64 existing_pattern=yes@AC2 modules_crossed=2@brief:L64 review_bounced=no@brief:L64 risk_kind=code@brief:L64
- depends_on: [STORY-7-3]
- blocked_by_arch: []

**As a** reviewer routine **I want** to skip unfinished or red heads **So that** rounds are not wasted.

**Acceptance criteria**
1. Given any check on the head pending, then `/review` reports "waiting on CI", posts no round, spawns nothing.
2. Given any check failed, then it reports "CI red" naming the job, posts nothing.
3. Given all checks completed and none failed, then review proceeds as today.
4. Given zero checks reported, then the reference states the behaviour (assume green, note it).

**Technical notes**
- Classify REST check-runs JSON in a script with `.test.sh` fixtures; `review.md` calls it in GATHER. Move CI wording to new `reference/review-rounds.md`.

**Out of scope**
- Polling or retrying CI.

### STORY-7-6: Round 1 is complete: BLOCKING tags and body verdict

- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- estimate: L
- select: risk_class=none@brief:L66 one_way_doors=1@brief:L74 existing_pattern=no@brief:L66 modules_crossed=5@brief:L66 review_bounced=no@brief:L66 risk_kind=code@brief:L66
- depends_on: [STORY-7-3]
- blocked_by_arch: []

**As a** coder **I want** every finding tagged and the verdict in the comment **So that** only real blockers trigger REVISE.

**Acceptance criteria**
1. Given round 1, then each finding carries BLOCKING or NON-BLOCKING plus a severity.
2. Given only NON-BLOCKING findings, then `verdict:` is not REQUEST_CHANGES; given any open BLOCKING finding, then `verdict: REQUEST_CHANGES`.
3. Every round comment has `verdict:` and `reviewed sha:` lines, and `/review` reads these, not GitHub review state, for the previous round and the guard.
4. Given a PR authored by the reviewing account (review stored as COMMENTED), then the verdict still reads correctly.

**Technical notes**
- Contract text in `reference/review-rounds.md`; `code-reviewer.md` OUTPUT shrinks to a pointer. Reconcile tags with `severity` vocabulary per ARCH-4.

**Out of scope**
- Changing the bar in `code-reviewer.md`.

### STORY-7-7: Rounds 2+ only re-check

- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): score 5 at or above 4 is PAIR
- estimate: M
- select: risk_class=none@brief:L69 one_way_doors=0@brief:L69 existing_pattern=no@brief:L69 modules_crossed=3@brief:L69 review_bounced=no@brief:L69 risk_kind=code@brief:L69
- depends_on: [STORY-7-6]
- blocked_by_arch: []

**As a** coder **I want** later rounds limited to my fixes **So that** review converges.

**Acceptance criteria**
1. Given round k+1, then the spawn prompt carries the range `<last reviewed sha>..<head>`, the earlier findings and `## Response — round k`.
2. Given a finding the response resolved, then the round marks it resolved; otherwise it stays open.
3. Given a new finding outside the earlier set, then it is kept only if BLOCKING and about security, data loss or a broken contract.

**Technical notes**
- Range comes from the body `reviewed sha:` (7-6); wording in `reference/review-rounds.md`.

**Out of scope**
- Whole-PR re-review.

### STORY-7-8: Round cap from config, "needs a human"

- status: TODO
- mode: SOLO — recommended SOLO (rubric 1): score 2 at or below 2 is SOLO
- estimate: S
- select: risk_class=none@brief:L71 one_way_doors=0@brief:L71 existing_pattern=yes@AC2 modules_crossed=2@brief:L71 review_bounced=no@brief:L71 risk_kind=code@brief:L71
- depends_on: [STORY-7-6]
- blocked_by_arch: []

**As a** maintainer **I want** a configurable cap **So that** review never loops.

**Acceptance criteria**
1. Given no configured cap, then the cap is 3.
2. Given rounds posted equal the cap and the last verdict is REQUEST_CHANGES, then `/review` reports "needs a human" and posts nothing.
3. Given a configured cap of 2, then a third round is refused.

**Technical notes**
- Replaces the hardcoded `k ≥ 4` in `review.md` step 2. Counting stays "highest heading across all bodies".

**Out of scope**
- Auto-escalation.

### STORY-7-9: Consumers read the body verdict

- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): score 3 in the gap resolves to PAIR, flagged borderline
- estimate: M
- select: risk_class=none@brief:L74 one_way_doors=0@brief:L74 existing_pattern=yes@AC1 modules_crossed=4@brief:L74 review_bounced=no@brief:L74 risk_kind=code@brief:L74
- depends_on: [STORY-7-6]
- blocked_by_arch: []

**As a** consuming project **I want** every reader of review state to use the body **So that** self-authored PRs read as approved.

**Acceptance criteria**
1. Given a COMMENTED GitHub review whose body says `verdict: APPROVE`, then `run-report.mjs` and `outcomes.mjs` record APPROVE.
2. `templates/routines/review-prompt.md` and `reference/coder-revise-mode.md` match the new contract and cap wording.
3. If ARCH-4 says breaking, the PR title is `feat!:` and its body lists what consumers must do.

**Technical notes**
- `run-report.mjs` ~L798-874 counts rounds by body; update `run-report.test.sh`, `outcomes.test.sh`.

**Out of scope**
- Wave-specific consumers (brief 02).

## Debt

Ledgered in docs/TOOLING-DEBT.md by the plan commit.

