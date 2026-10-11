# EPIC-6: Backlog store interface, repo as the only adapter

- Outcome: all plan reads and writes go through `scripts/backlog-store.mjs`; `repo` is the only adapter and behaves as today; a store setting is read in one place and any non-`repo` value fails clearly. Brief: `docs/briefs/github-backlog/01-store-interface.md`.
- Success metric: path-naming sites outside the store and `reference/`: **10 -> 0** (baseline below). All existing script tests pass unchanged; the `agents/*.md` + `commands/*.md` size budget does not grow.
- Status: TODO
- PR title: `feat:` (touches `plugins/`).
- Artifacts: docs/adr/0006-per-repo-pipeline-config.md, docs/briefs/github-backlog/01-store-interface.md, docs/briefs/github-backlog/README.md
- Lane: deliberate — recommended deliberate (rubric 1): floor one_way_door, one_way_door, one_way_door, one_way_door, one_way_door fired, lane is deliberate
- Binding: ADR-0006 (`.claude/agentic-sdlc.json`, read only through `config.mjs`; this epic adds `backlog.store`). ADR-0001 is untouched (see ARCH-4).
- Baseline (counted 2026-10-09; a "site" = a literal `backlog/<ID>.md` path used for plan content in prompt text or code; pair log `backlog/pair/` excluded as out of scope):
  - commands: `build.md:30`, `build.md:62` (mode-select `--file`), `build.md:109` (negative example)
  - agents: `coder.md:23`, `planner.md:53` (FAST output), `planner.md:63` (EPIC output)
  - scripts: `plan-artifacts.mjs:88`, `plan-artifacts.mjs:117` (these move into the store), `run-report.mjs:453`, `run-report.mjs:456`
  - Not counted but must also switch (indirect, no literal path): `review.md:26,74` and `code-reviewer.md:28,36` ("the backlog file"); `mode-select.mjs` takes `--file <path>` (`readSelectLines`, `readStoryBlock`, `recordStory`); comment-only mentions `plan-artifacts.mjs:7,12`, `run-report.mjs:41,56`. `reference/` mentions are excluded by the metric.

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Where the store setting lives (CLAUDE.md line, `.claude/settings.json`, plugin config); scripts must read it. One-way door, needs an ADR | STORY-6-3, 6-8 | RESOLVED |
| ARCH-2 | Does `mode-select.mjs` take a story ID and ask the store, or keep `--file` on a store-materialised file? | STORY-6-4 | RESOLVED |
| ARCH-3 | Validate the op list, arg/return shapes, opaque IDs and store-assigned `claim` against brief 02's needs | STORY-6-1, 6-2 | RESOLVED |
| ARCH-4 | `run-report.mjs` resolves the backlog by path and ADR-0001 records `backlog` as a path in the marker: store read, or stay path-based? | STORY-6-7 | RESOLVED |

## Stories

### STORY-6-1: Store script with read ops and claim

- status: TODO
- estimate: M
- select: risk_class=none@brief:L35 one_way_doors=1@brief:L79 existing_pattern=yes@brief:L42 modules_crossed=2@brief:L42 review_bounced=no@brief:L35 risk_kind=code@brief:L35
- depends_on: []
- blocked_by_arch: []

**As a** maintainer **I want** one script exposing read-brief, read-plan, read-story, list-plans and claim as subcommands **So that** reading the plan needs no path knowledge.

**Acceptance criteria**
1. Given a repo with `backlog/EPIC-1.md`, when `read-plan EPIC-1` runs, then stdout is byte-identical to the file.
2. Given a story or task ID that heads exactly one `### <ID>:` section across the repo's plans, when `read-story <ID>` runs, then stdout is exactly that section (heading to the next `###`/`##`, the bounds `mode-select.mjs` uses today). An unknown ID exits 2 naming the ID; an ID heading sections in two plans exits 2 naming both plan IDs.
3. Given the brief ref `/plan` was given (a project-relative path such as `docs/briefs/github-backlog/01-store-interface.md`), when `read-brief <ref>` runs, then stdout is that file's content; a missing brief exits 2 naming the ref.
4. Given plans whose `- Artifacts:` line names a brief, when `list-plans --brief <ref>` runs, then it prints their plan IDs one per line, most recently modified last (the order `run-report.mjs` picks from today); none prints nothing and exits 0.
5. Given the existing claim tests, when `claim EPIC|FAST [--brief <ref>]` runs through the store, then the same numbers and exclusive-create behaviour result, stdout is the bare plan ID (`EPIC-8`), and `plan-artifacts.test.sh` passes unchanged (`plan-artifacts.mjs claim` still prints `backlog/<ID>.md`).
6. Given a plan ID not matching `^(EPIC|FAST)-\d+$`, or a story ID not matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, then every op exits 2 before touching anything.

**Technical notes**
- New `scripts/backlog-store.mjs` + `scripts/backlog-store.test.sh`; plain Node 22. Shape per ARCH-3: a CLI dispatch behind the `realpathSync`/`pathToFileURL` main guard (as `mode-select.mjs`), plus exported library functions (`readPlan`, `updatePlan`, `readStory`, `listPlans`, `locate`, `sectionBounds`, `claim`) that other scripts import in-process.
- Claim logic (`numbersIn`, `highestTaken`, the `wx` create) **moves** into the store's repo adapter. `plan-artifacts.mjs claim` becomes a thin delegate that imports it and prints the returned repo-relative ref; `carry` is untouched apart from getting the plan's file from the store's exported `locate(id)` (that removes the `plan-artifacts.mjs:88,117` sites). `plan-artifacts.mjs` has no main guard today: move its dispatch behind one so it stays importable.
- Coordinate with EPIC-7 ARCH-1: it adds `claim --id <KIND-n>`. Whichever epic lands second ports that flag across, so the store's `claim` accepts `--id` with EPIC-7's semantics.
- `--brief` is accepted and ignored by `repo` (the plan's own `- Artifacts:` line records it); a remote store needs it to parent the plan.
- Section bounds: move `storyBounds` out of `mode-select.mjs` into the store as `sectionBounds` and import it back, so there is one implementation.
- Store root: `--project <dir>` if given, else `git rev-parse --show-toplevel` of cwd, else cwd. Only `claim` requires git.
- Errors: `backlog-store: <msg>` on stderr, exit 2 (the `plan-artifacts.mjs` convention).

**Out of scope**
- Write ops, selector, any command/agent edit.

### STORY-6-2: Write ops: write-plan, set-status, resolve-arch, write-story, append-debt, link-pr, record-commit

- status: TODO
- estimate: L
- select: risk_class=none@brief:L35 one_way_doors=1@brief:L79 existing_pattern=yes@brief:L35 modules_crossed=2@brief:L42 review_bounced=no@brief:L35 risk_kind=code@brief:L35
- depends_on: [STORY-6-1]
- blocked_by_arch: []

**As a** maintainer **I want** the write ops behind the script **So that** status, ARCH resolutions, story edits, debt and traceability are written by one adapter.

**Acceptance criteria**
1. Given a plan, when `set-status <ID> <TODO|IN_PROGRESS|BLOCKED|DONE>` runs with a story/task ID, then only that section's `- status:` line changes; with a plan ID, only the header `- Status:` line. Any other status exits 2.
2. Given `resolve-arch <PLAN-ID> <ARCH-ID> --from <draft>`, then the `### <ARCH-ID>` block is replaced by the draft (appended before `## Debt`, or at the end, when absent), and that ID's handoff-table row gets its last cell set from the draft's `- status:` line (a row is appended when absent). Nothing else in the plan changes.
3. Given `write-story <STORY-ID> --from <draft>`, then exactly that section is replaced; a draft whose first line is not `### <STORY-ID>:` exits 2.
4. Given `append-debt <PLAN-ID> --from <draft>` holding `### ` rows, then they are appended under `## Debt` (created at the end when absent), and nothing else changes.
5. Given story IDs of one epic, when `link-pr <PR> <ids...>` runs, then each story section records `- pr: #<PR>`; given IDs spanning two plans, then it exits 2 naming both plans and writes nothing. Re-running changes nothing.
6. Given a story, when `record-commit <ID> <sha>` runs (`^[0-9a-f]{7,40}$`), then the section records `- commit: <sha>`; re-running with the same args changes nothing, and a different sha replaces the line.
7. Given `write-plan EPIC-n --from <draft>`, then `backlog/EPIC-n.md` holds the draft's bytes.
8. Given a `--from` path outside `<root>/.agentic-sdlc/drafts/`, then the op exits 2 before reading it; a draft inside it is deleted after a successful write and left in place on failure (EPIC-3 ARCH-1 and its F1 amendment).

**Technical notes**
- Every targeted op (1-6) is one `updatePlan(id, transform)` call: read, transform one section, write. That function is the seam where a lock goes later (see Debt); ops never write a whole plan they did not just read.
- `- pr:` / `- commit:` / `- mode:` lines anchor after the section's `- status:` line, the way `recordStory` anchors `- mode:` today; reuse `upsertHeaderLine`'s approach (move it into the store if `mode-select.mjs` needs it there too).
- The cross-plan refusal compares the parent plan of each ID as the adapter resolves it (repo: the plan whose file heads the section). It must not depend on parsing the ID text.
- No op reads stdin and no body travels as an argument: headless rule matching (EPIC-3 ARCH-1).

**Out of scope**
- Selector; switching callers; any lock.

### STORY-6-3: Store selector: setting, `--store` flag, fail on unknown

- status: TODO
- estimate: M
- select: risk_class=none@brief:L45 one_way_doors=1@brief:L86 existing_pattern=yes@brief:L71 modules_crossed=2@brief:L45 review_bounced=no@brief:L45 risk_kind=code@brief:L45
- depends_on: [STORY-6-1]
- blocked_by_arch: []

**As a** maintainer **I want** the store resolved once from a setting with a `--store` override **So that** adding a store is one adapter plus one selector line.

**Acceptance criteria**
1. Given no `.claude/agentic-sdlc.json` (or one without `backlog.store`) and no flag, when any op runs, then the `repo` adapter is used.
2. Given `--store repo` or `{"schema":1,"backlog":{"store":"repo"}}`, then behaviour is identical to default.
3. Given any other value from either source, then the op exits 2 with a message naming the value, where it came from (`--store` or `.claude/agentic-sdlc.json backlog.store`), and the valid set (`repo`).
4. Given flag and setting that disagree, then the flag wins and the config is not consulted (tested with `"store":"github"` in the file plus `--store repo`).
5. Given the sources, then `config.mjs` is the only code that opens `.claude/agentic-sdlc.json`, and the store's `resolveStore()` is the only caller that asks it for `backlog.store`. No other script resolves a store.
6. Given `backlog.store` that is not a non-empty string, then `config.mjs` itself fails per ADR-0006 rule 3.

**Technical notes**
- Location and reader are fixed by ADR-0006 (ARCH-1). `config.mjs` validates the *type* of `backlog.store`; the store's selector validates *membership* against its adapter registry (`{ repo }`), so adding `github` in brief 02 is one registry line and needs no config change.
- `config.mjs` is created by EPIC-7 STORY-7-8. If it is not on `origin/main` when this story starts, create it to ADR-0006 rules 1-3 with `backlog.store` as its only key, plus `config.test.sh` (missing file, valid, bad JSON, wrong type, unknown key, `schema`≠1). Whichever epic lands second adds its key to the other's file.
- `--store` is accepted by every store op, and by every script that calls the store in-process (`mode-select.mjs`, `run-report.mjs`), which passes it straight through.

**Out of scope**
- Any non-`repo` adapter.

### STORY-6-4: mode-select reads and records through the store

- status: TODO
- estimate: M
- select: risk_class=none@brief:L69 one_way_doors=1@brief:L89 existing_pattern=yes@brief:L69 modules_crossed=2@brief:L69 review_bounced=no@brief:L69 risk_kind=code@brief:L69
- depends_on: [STORY-6-2, STORY-6-3]
- blocked_by_arch: []

**As a** maintainer **I want** `mode-select.mjs` to get story text and record mode lines via the store **So that** it holds no backlog path.

**Acceptance criteria**
1. Given `--plan <ID>` in place of `--file <path>` on `story`, `lane`, `record` and `correct` (every other flag unchanged, plus an optional `--store`), when they run on the same fixture content, then their JSON output and the resulting plan bytes match today's.
2. Given `mode-select.test.sh`, then its expectations are unchanged; only fixture placement (`<tmp>/backlog/EPIC-<n>.md`, run with that tmp dir as `--project` or cwd) and `--file` → `--plan` change.
3. Given the sources, then `mode-select.mjs` contains no `backlog/` literal and no `--file` flag.
4. Given `build.md`, `plan.md`, `reference/fast-mode.md` and `reference/runtime-correction.md`, then every `mode-select.mjs` call uses `--plan <ID>`.

**Technical notes**
- Per ARCH-2: reads go through the store's exported `readPlan`; writes through `updatePlan(id, transform)` with today's `upsertHeaderLine`/`recordStory` logic as the transform; `storyBounds` is imported back from the store (`sectionBounds`).
- `writeDecisions`/`resolveRunId` take `dirname(file)` as the git cwd today; use the store root instead.
- `--file` is removed, not kept beside `--plan`: two input shapes is a fork the next adapter has to honour.

**Out of scope**
- Scoring logic, field spec.

### STORY-6-5: /plan, the planner and the architect use the store

- status: TODO
- estimate: M
- select: risk_class=none@brief:L48 one_way_doors=0@brief:L48 existing_pattern=yes@brief:L48 modules_crossed=3@brief:L67 review_bounced=no@brief:L48 risk_kind=code@brief:L48
- depends_on: [STORY-6-2, STORY-6-3]
- blocked_by_arch: []

**As a** maintainer **I want** plan creation to claim and write via the store **So that** the planner prompt names no path.

**Acceptance criteria**
1. Given `planner.md`, `architect.md`, `plan.md`, `reference/fast-mode.md`, when edited, then none names `backlog/<ID>.md` and each points to the store protocol in `reference/backlog-store.md`.
2. Given `/plan <brief> [--store repo]`, then it produces the same epic file as before.
3. Given the planner, then it writes its plan only to the draft path its prompt names (`<root>/.agentic-sdlc/drafts/<ID>.md`), and `/plan` runs `write-plan <ID> --from <draft>`. The planner gets no Bash.
4. Given an architect resolving a handoff, then it writes through `resolve-arch`, `write-story` (ACs it sharpens) and `append-debt`, never by editing the plan.
5. Given `agents/*.md`+`commands/*.md` sizes, then total bytes do not exceed `scripts/size-budget.json` and the budget is not raised.

**Technical notes**
- Files: `commands/plan.md`, `agents/planner.md`, `agents/architect.md`, `reference/fast-mode.md`, `reference/plan-artifacts.md`.
- STEP 3's `- Artifacts:` line runs after every architect has returned, so it is a single writer: `read-plan` → edit a draft → `write-plan`.
- Parallel architects stay safe because each writes only its own ARCH block, story sections and appended debt rows (ARCH-3).

**Out of scope**
- `carry` behaviour.

### STORY-6-6: /build and the coder use the store

- status: TODO
- estimate: M
- select: risk_class=none@brief:L48 one_way_doors=0@brief:L48 existing_pattern=yes@brief:L48 modules_crossed=4@brief:L67 review_bounced=no@brief:L48 risk_kind=code@brief:L48
- depends_on: [STORY-6-4, STORY-6-5]
- blocked_by_arch: []

**As a** maintainer **I want** build to read stories and write status, ARCH resolution, PR link and landing commit via the store **So that** build prompts carry no path.

**Acceptance criteria**
1. Given `build.md`, `coder.md`, `reference/coder-fast-mode.md`, `reference/runtime-correction.md`, then none names `backlog/<ID>.md` for plan content; `backlog/pair/` references stay.
2. Given a build, then story status, ARCH resolutions, the PR link and each landing SHA are written by store subcommands.
3. Given the size budget, then it does not grow.
4. Given a coder, SOLO or FAST, then it never calls the store: its story arrives inlined, and a FAST `⚠ one-way` item is reported in its `DEFERRED` line, not written into the plan.

**Technical notes**
- Orchestrator inlines story text from `read-story`; keep the "inline the story, don't point at a path" rule.
- `record-commit <STORY> <sha>` runs right after each LAND commit. In repo mode the plan edits (status, commit) accumulate in the epic worktree's plan and are committed as one `docs: update <ID> plan` commit before step 7's push.
- `link-pr <PR> <ids...>` runs right after `gh pr create`. In repo mode its edit is committed and pushed at once (see Debt).
- FAST: the orchestrator inlines the coders' `⚠ one-way` lines into the single end-of-run architect prompt, and the architect writes mark and resolution into each task with `write-story`.

**Out of scope**
- Pair-log handling.

### STORY-6-7: /review, the code-reviewer and run-report use the store

- status: TODO
- estimate: M
- select: risk_class=none@brief:L48 one_way_doors=1@brief:L9 existing_pattern=yes@brief:L48 modules_crossed=4@brief:L67 review_bounced=no@brief:L48 risk_kind=code@brief:L48
- depends_on: [STORY-6-2, STORY-6-3]
- blocked_by_arch: []

**As a** maintainer **I want** review and reporting to read plan content via the store **So that** the last path knowledge is gone.

**Acceptance criteria**
1. Given `review.md` and `code-reviewer.md`, then the reviewer gets story sections from `read-story`, not by Grep of a file.
2. Given `run-report.mjs`, then it resolves plan content through the store's exported functions in the order ARCH-4 sets, contains no `backlog/<ID>.md` site, and `run-report.test.sh` and `run-report-hook.test.sh` pass unchanged.
3. Given the run marker, then its `backlog` field keeps its name, and in repo mode its value stays the project-relative path written today, so in-flight markers resume across the upgrade. The `backlog_file` degraded token is unchanged. ADR-0001's report schema is untouched.
4. Given the store selector fails (e.g. an unknown `backlog.store`), then `run-report.mjs` exits 0 with `backlog_file` in `degraded`, never a hook failure.

**Technical notes**
- `resolveBacklogPath` (~L446-473) becomes, per ARCH-4: `--backlog <file>` (explicit override, read as a file, unchanged) → `marker.backlog` (an adapter ref handed back to the store) → plan ID in `marker.target` → `readPlan(id)` → plan run: last ID from `listPlans({ brief })`. The store's `locate(id)` returns the ref stored in the marker.
- `buildUnits` re-reads `ctx.backlog.path` for FAST tasks; use the text already loaded.
- A `--store <v>` in `marker.target` (the raw command argument) is passed to the selector, so a run's report reads the store that run used.

**Out of scope**
- Report content changes.

### STORY-6-8: Protocol doc, headless allow rules, zero-path guard

- status: TODO
- estimate: S
- select: risk_class=none@brief:L50 one_way_doors=0@brief:L50 existing_pattern=yes@brief:L50 modules_crossed=2@brief:L28 review_bounced=no@brief:L50 risk_kind=code@brief:L50
- depends_on: [STORY-6-6, STORY-6-7]
- blocked_by_arch: []

**As a** maintainer **I want** the protocol documented, runnable headless, and the metric enforced **So that** path knowledge cannot creep back.

**Acceptance criteria**
1. Given `reference/backlog-store.md`, then it lists every subcommand with its args and output (ARCH-3), the ID rules, the drafts directory, the selector, and the setting (`backlog.store` in `.claude/agentic-sdlc.json`, per ADR-0006).
2. Given `claude -p`, then each new `backlog-store.mjs` invocation matches a scoped allow rule (EPIC-3 ARCH-1 pattern).
3. Given a test, when it scans `commands/`, `agents/`, `scripts/*.mjs` (excluding the store, tests, `reference/`, `backlog/pair/`), then it finds 0 `backlog/<ID>.md` sites and fails if one is added.
4. Given `./scripts/preflight.sh`, then it passes.

**Technical notes**
- Allow rules follow EPIC-3 ARCH-1: one rule per subcommand, never `Bash(node *)`, plus `Write` scoped to `<root>/.agentic-sdlc/drafts/**` for the planner and architect. The callers are the `/plan`, `/build` and `/review` orchestrators, the architect and the code-reviewer. Coders and pair agents never call the store (STORY-6-6 AC4). Reproduce under `claude -p --permission-mode dontAsk` before choosing where the rules live (command `allowed-tools` frontmatter vs. a documented settings snippet), and record the result in the reference doc. Whether `${CLAUDE_PLUGIN_ROOT}` expands inside frontmatter is unverified.
- Guard test may live in `backlog-store.test.sh`.

**Out of scope**
- Any GitHub code.

### ARCH-1: Store setting location
- status: RESOLVED
- reversibility: ONE-WAY → already recorded in `docs/adr/0006-per-repo-pipeline-config.md` (ACCEPTED 2026-10-09), which names this brief's question and settles it. No new ADR.
- blocks: [STORY-6-3, STORY-6-8]
- category: contract (run-report-categories.mjs)

**Decision:** `backlog.store` in the committed `.claude/agentic-sdlc.json`, read only through `config.mjs`. The precedence is `--store` > `backlog.store` > `repo`. `config.mjs` type-checks the value (a non-empty string). The store's `resolveStore()` checks it against the adapter registry and is the only caller that asks for the key. A `--store` flag short-circuits the config read entirely.
**Why:** ADR-0006 is ACCEPTED and explicitly binds this brief, so the epic works within it. I re-verified the facts it rests on: plugin `userConfig` lives under `pluginConfigs` in **user or managed** settings only, and its values reach hooks (`CLAUDE_PLUGIN_OPTION_*`) and prompt text (`${user_config.*}`), never a Bash-tool process (code.claude.com plugins-reference and settings-reference, fetched 2026-10-09). The `**Agent models:**` precedent stays where it is for models. A store choice is typed, script-read state, and that is exactly what ADR-0006 moved out of `CLAUDE.md`.
**Note:** Splitting type from membership means brief 02 adds `github` by adding one registry line. See STORY-6-3 for the `config.mjs` sequencing with EPIC-7 STORY-7-8.

### ARCH-2: mode-select input
- status: RESOLVED
- reversibility: TWO-WAY
- blocks: [STORY-6-4]
- category: contract (run-report-categories.mjs)

**Decision:** `--plan <PLAN-ID>` replaces `--file <path>` on every subcommand that has it (`story`, `lane`, `record`, `correct`). `--id` is unchanged, and `--store` is passed through. `mode-select.mjs` imports the store in-process, the way it already imports `decisions.mjs`. It reads with `readPlan` and writes with `updatePlan(id, transform)`, and its existing upsert logic is the transform. `--file` is removed. No file is materialised.
**Why:** Materialising a file means a temp copy, an edit and a write-back. That is three steps that can desync, and the file it produces is still a path. Taking the plan ID keeps today's tested section logic byte-for-byte and swaps only the I/O. The edit to `build.md`, `plan.md`, `fast-mode.md` and `runtime-correction.md` is mechanical (`--file backlog/EPIC-<n>.md` → `--plan EPIC-<n>`). I chose an explicit `--plan` over deriving the plan from the story ID because the tests use IDs like `STORY-A`, and IDs are opaque.
**Note:** Fixtures move under `<tmp>/backlog/`. Expectations do not change.

### ARCH-3: Op list vs brief 02
- status: RESOLVED
- reversibility: TWO-WAY (the interface ships in one plugin version with every caller; no consuming project calls it directly)
- blocks: [STORY-6-1, STORY-6-2]
- category: contract (run-report-categories.mjs)

**Decision:** I accept the op list, with three additions and two shape changes:

| Op | Args | Stdout |
|----|------|--------|
| `read-brief` | `<brief-ref>` | brief markdown |
| `read-plan` | `<PLAN-ID>` | plan markdown (repo-file shape in every store) |
| `read-story` | `<STORY-ID>` | that section |
| `list-plans` *(added)* | `--brief <ref>` | plan IDs, newest last |
| `claim` | `<EPIC\|FAST> [--brief <ref>] [--id <KIND-n>]` | the plan ID |
| `write-plan` | `<PLAN-ID> --from <draft>` | — |
| `set-status` | `<ID> <TODO\|IN_PROGRESS\|BLOCKED\|DONE>` | — |
| `resolve-arch` | `<PLAN-ID> <ARCH-ID> --from <draft>` (upsert) | — |
| `write-story` *(added)* | `<STORY-ID> --from <draft>` | — |
| `append-debt` *(added)* | `<PLAN-ID> --from <draft>` | — |
| `link-pr` | `<PR> <STORY-ID...>` | — |
| `record-commit` | `<STORY-ID> <sha>` | — |

All ops take `--store` and `--project`. Errors go to stderr with exit 2, and nothing is written.

- **Bodies arrive by `--from <draft>`, never stdin.** This replaces STORY-6-2's "stdin content". EPIC-3 ARCH-1 measured piped bodies being denied under `-p`. Drafts live in `<root>/.agentic-sdlc/drafts/`, which is gitignored local state. Paths outside it are refused, and a draft is deleted on success.
- **Targeted writes, not whole-plan rewrites.** Today the architect and coder use the Edit tool, which is a targeted replace. Parallel architects in `/plan` STEP 2 therefore do not clobber each other. A read-whole/write-whole interface would introduce lost updates that do not exist today. So the architect's three kinds of write (its ARCH block, ACs it sharpens, debt rows) each get a per-entity op. `write-plan` is for single-writer moments only (planner output, `/plan` STEP 3). The per-entity ops are also what lets 02 answer its ARCH-concurrency question: each ARCH can become its own comment or issue without changing a caller.
- **IDs.** Plan IDs are store-assigned by `claim` and must match `^(EPIC|FAST)-\d+$`. Callers read the kind (lanes, `run-report`, branch `feat/<ID>`) but treat the number as opaque: they never compute n+1 and never derive a path. A per-store counter and the issue number as the ID both fit this pattern, so 02 keeps that choice. Story, task and ARCH IDs are the plan's own heading IDs and stay canonical in every store, because commit tags, branch names and ADR-0002's decision subject join on them. Adapters map them to native objects internally.
- **Hierarchy.** The plan → story parent is resolved by the adapter, and `link-pr`'s cross-plan refusal is checked before any write. The brief → plan parent is what `claim --brief` and `list-plans --brief` exist for.
- **Idempotence.** `link-pr`, `record-commit`, `set-status`, `resolve-arch` and `write-story` are all idempotent, so a crashed `/build` can re-run its bookkeeping safely.

Checked against 02's open questions. Coarseness holds: every op is entity-level, and none is per pair turn. The rate-limit rule holds because writes happen at story boundaries. Over-size bodies and untrusted comments are adapter concerns that the contract allows, since any write may refuse with exit 2 and reads return plan content only, never comments. Snapshotting does not touch the interface: it is a `carry`-side choice. Roll-up stays adapter-internal: `repo` does none, as today.
**Why:** The ops come from what the callers actually do. Reading the code turned up three writers the brief's list missed: the architect's AC edits, debt rows, and FAST `⚠ one-way` marks. It also showed one headless hazard (stdin).
**Note:** STORY-6-1 owns the reads and `claim`. STORY-6-2 owns the writes. The `- pr:` and `- commit:` lines are new, additive story-section lines. `run-report`'s `parseBacklog` ignores unknown `- x:` lines, so nothing downstream changes.

### ARCH-4: run-report and the store
- status: RESOLVED
- reversibility: TWO-WAY
- blocks: [STORY-6-7]
- category: data (run-report-categories.mjs)

**Decision:** `run-report.mjs` reads through the store's exported library functions in-process. It never spawns the CLI, because it runs inside hooks. The resolution order is kept and only the I/O moves: `--backlog <file>` (explicit override, unchanged) → `marker.backlog` → the plan ID in `marker.target` via `readPlan` → for a plan run, the last ID from `listPlans({ brief })`. The marker's `backlog` field keeps its name. It now means "the adapter's ref for this run's plan", and in repo mode it is byte-for-byte today's relative path (from `locate(id)`). A selector failure degrades to `backlog_file`. It never fails the hook.
**Why:** The handoff misreads ADR-0001. The run marker is not in ADR-0001's schema. It is local state that `run-report.mjs`'s own header comment documents, and it "may carry paths", while the exported report never sees it. So no ACCEPTED ADR is touched. Keeping the field and its repo value means markers written by the previous release resume cleanly, and both run-report test files pass unchanged. A path-based run-report would leave two sites and a second resolver that 02 would have to fork.
**Note:** See STORY-6-7's ACs 3-4 and its notes on `buildUnits` and on passing `--store` from `marker.target`.

## Debt

### No lock around the repo adapter's read-modify-write
- Raised: 2026-10-09 by architect (ARCH-3)
- Current: `updatePlan` reads, transforms one section and writes with no lock. Two store ops on the same plan in the same millisecond window can lose one update. Targeted ops keep that window to milliseconds. The old Edit-tool path had a comparable window.
- Risk: LOW
- Category: robustness
- Address when: a lost plan update is observed, or `/plan` or `/build` start running more than about four writers at once on one plan. Then add a `wx` lock file inside `updatePlan`.

### `link-pr` in repo mode costs one extra push and CI run per epic
- Raised: 2026-10-09 by architect (ARCH-3)
- Current: the PR number exists only after `gh pr create`. Recording it in the branch's plan therefore needs a commit and a push to the open PR, which re-runs `validate.yml` and `pr-title-lint.yml` once.
- Risk: LOW
- Category: other
- Address when: CI minutes per epic become a tracked cost, or a repo-mode project asks to skip the record. Then batch it into the first REVISE push, or let `repo` leave the PR link to the `[STORY-<id>]` commit tags.

### FAST `⚠ one-way` items are not persisted until the end-of-run architect
- Raised: 2026-10-09 by architect (ARCH-3)
- Current: coders no longer write the mark into the plan. It lives in their `DEFERRED` report until the single architect batch writes mark and resolution together. A session that dies between the two loses the deferred list, and the orchestrator has to re-derive it from the unbuilt tasks.
- Risk: LOW
- Category: robustness
- Address when: a FAST run is resumed after a crash and re-dispatches a deferred task without its one-way line. Then have the orchestrator `write-story` the mark when the coder reports it.
