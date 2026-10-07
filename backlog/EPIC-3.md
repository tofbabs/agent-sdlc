# EPIC-3: Headless pair-log writes that never hit a permission denial

- Outcome: a headless navigator or driver writes STATE, appends its entry and
  sets the session in one tool call each, with no permission denial, in a
  consuming project's default setup. When a denial does happen anyway, the
  meter records it.
- Success metric: share of headless navigator turns with at least one
  permission denial on a pair-log write, ~20% → 0%, measured from
  `permission_denials` in the per-turn meter line over the next PAIR epic
  built here.
- Status: DONE
- Artifacts: docs/briefs/headless-pair-log-writes.md
- Lane: deliberate — recommended fast (rubric 1): no floor fired and 0 PAIR stories, lane is fast
- Override: lane recommended=fast chosen=deliberate

## Architect handoffs

| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Write mechanism for pair-log's `state`/`append`/`session`, and the actual trigger behind the denial | STORY-3-2, STORY-3-3, STORY-3-4 | RESOLVED |

### ARCH-1: Write mechanism and denial trigger

- status: RESOLVED
- reversibility: TWO-WAY
- blocks: [STORY-3-2, STORY-3-3, STORY-3-4]
- category: security

**Decision:** A combination, because neither half works alone. (1) `pair-run.mjs`
passes a scoped `--allowedTools` grant on every turn, for both roles. (2) Bodies
arrive through `pair-log.mjs state|append <ID> --from <path>`, from a draft file
the agent writes with its Write tool. (3) Every pair-log command the agent runs
names the script by a **literal absolute path**, which `pair-run`'s prompt
supplies. It is never `${CLAUDE_PLUGIN_ROOT}`. `session` has no body, so for it
the grant and the literal path are the whole fix. The rejected candidates: a
body passed as an argument, and a one-call quoted heredoc redirect
(`node … state X <<'EOF'`).

**Why:** Claude Code's docs give these rules. Under `-p`, a command with no
matching rule needs a prompt, and with no one to answer it is denied. Every
pipe segment has to match a rule on its own. A rule matches the literal command
text. Workspace trust gates project `permissions.allow`, so `-p` in an
untrusted folder ignores it. CLI `--allowedTools` is not gated that way. I
reproduced the rest on v2.1.292 with `--permission-mode dontAsk`, which is
deterministic because anything that matches no rule is denied:

| Shape, with grant `Bash(node <abs>/pair-log.mjs state *)` | Result |
|---|---|
| `cat <<'EOF' \| node <abs> state X` (today's shape) | **denied** |
| `node ${VAR}/pair-log.mjs state X --from f` | **denied** |
| `node <abs> state X <<EOF` (unquoted heredoc) | **denied** |
| `node <abs> state X --from f` | allowed |
| `node <abs> state X --from a && node <abs> append X --from b` (each segment granted) | allowed |
| `node <abs> init …` (subcommand not granted) | denied, so scoping per subcommand holds |
| same `--from` command, no grant | denied, so the grant is what allows it |
| Write to the drafts dir, no grant, then with `Edit(//<abs>/drafts/**)` | denied, then allowed |
| `--permission-mode auto` with the grant plus a `Bash(python*)` control | the debug log drops only `python*`, so the narrow rule survives |

That identifies the trigger. **There is no allow rule for the pair-log script in
any default setup.** Most `-p` sessions start in `default` mode, where today's
call is denied every time. This repo runs in `auto`, because
`~/.claude/settings.json` sets `defaultMode: auto`. In `auto` the classifier
judges the call, and its stochastic verdict is the ~20%. A grant alone would not
fix it: the piped heredoc and the `${CLAUDE_PLUGIN_ROOT}` path both still fail
rule matching. `--from` with a literal path is the only shape that rests on
documented matching alone: one simple command, no operators, no expansion. The
quoted-heredoc form passed too, but it depends on how the parser treats a
heredoc body, which is undocumented (newlines *are* documented separators). It
also turns into a denial the moment the model drops the quotes on the delimiter.
A body passed as an argument fails on the first apostrophe or backtick in prose.

**Driver: covered.** The trigger does not depend on role, so nothing waits on
STORY-3-1's split. The driver pipes the same shape, and in `default` mode it is
denied every time. The same grant and shape apply to both roles.

**Note for the coder:**
- **Grant**, built in `runTurn()` and passed before `extraArgs`, so a project's
  `PAIR_RUN_CLAUDE_ARGS` can still add to it:
  `--allowedTools "Bash(node <PAIR_LOG> read *)" "Bash(node <PAIR_LOG> state *)"
  "Bash(node <PAIR_LOG> append *)" "Bash(node <PAIR_LOG> session *)"
  "Edit(//<abs drafts dir>/**)"`.
  Grant these four subcommands only. `init --root --force` copies a file to an
  arbitrary directory, so it stays ungranted. `<abs drafts dir>` is
  `<git toplevel of the worktree>/backlog/pair/<STORY-ID>/drafts`, and the
  leading `//` marks an absolute path. Do not add `Bash(node *)` or any wider
  rule.
- **Drafts:** use `backlog/pair/<STORY-ID>/drafts/state.md` and `drafts/entry.md`.
  They sit under the already-gitignored log dir and are not the log files, so
  STORY-3-2 AC4 holds. On a successful write, `--from` deletes the file **only
  if it resolves inside that story's `drafts/`**, so a stale draft can never be
  posted again. A path anywhere else is read and left alone, so the grant never
  becomes a way to delete files. If the file is missing, exit 2 with a clear
  message. Empty input, fence stripping and the line caps go through the
  unchanged `clamp()`.
- **Prompt:** `pair-run`'s `PROMPTS` already carry the absolute `PAIR_LOG` for
  `read`. Extend them with the absolute drafts dir and the exact write
  commands. The agent `.md` files show the shape with a placeholder ("the
  pair-log path and drafts dir from your prompt") and never
  `${CLAUDE_PLUGIN_ROOT}`.
- **Round trips:** the navigator issues both Writes in parallel in one message,
  then one chained Bash call:
  `node <abs> state <ID> --from <drafts>/state.md && node <abs> append <ID> --role navigator --from <drafts>/entry.md`.
  That is two round trips, the same as today's two pipes. The driver takes two
  (Write, then Bash) where it took one, which adds about 1 to its ~42.

**Context:** Today the navigator/driver pipe a heredoc body into
`node ${CLAUDE_PLUGIN_ROOT}/scripts/pair-log.mjs state|append <STORY-ID>`
under `claude -p` (headless, no prompt possible). About 20% of navigator turns
get the Bash call denied outright, burn a retry at full re-sent context, and
sometimes exit 5 ("turn made no pair-log entry"). Candidates named in the
brief: `pair-run.mjs` passes a scoped `--allowedTools` grant naming the
pair-log script; `pair-log.mjs` gains a `--from <path>` flag and the agent
writes the body with its existing Write tool first; or the body moves to a
CLI argument instead of stdin. The brief also asks whether the heredoc itself
is the trigger, or the `${CLAUDE_PLUGIN_ROOT}` expansion, or the pipe into
`node` — reproduce before picking, since the fix only holds if it targets the
actual matcher behaviour, not the shape that merely looks suspicious. Check
STORY-3-1's meter data (denied tool names, navigator vs driver split) before
deciding the fix is navigator-only — the driver pipes the same shape and may
already be hitting denials at a different rate.

**Why I'm not deciding:** This is a permission-matcher behaviour question on
the Claude Code version the plugin supports — "don't build on undocumented
matcher behaviour" is a hard constraint in the brief, and the matcher's actual
rules aren't something a story-decomposition pass can verify. It also sets a
write-shape contract every future PAIR story inherits, for both roles, for
good.

## Stories

### STORY-3-1: Permission denials recorded in pair-run's meter line

- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 0 at or below 2 is SOLO
- estimate: S
- select: risk_class=none@brief:L95 one_way_doors=0@brief:L56 existing_pattern=yes@brief:L26 modules_crossed=1@brief:L56 review_bounced=no@brief:L56 risk_kind=code@brief:L56
- depends_on: []
- blocked_by_arch: []

**As a** maintainer running headless PAIR stories
**I want** `pair-run.mjs`'s per-turn meter line to carry the permission
denial count and the denied tool names for that turn
**So that** the ~20% baseline is measured from data instead of inferred from
transcripts, before any fix lands

**Acceptance criteria**
1. Given a turn's `claude -p --output-format json` result carries
   `permission_denials`, when `pair-run.mjs` writes its meter line to
   `.agentic-sdlc/meter/pair-run-<STORY-ID>.jsonl`, then the line includes the
   denial count and the denied tool names for that turn, and no argument or
   command text from the denial.
2. Given a turn with zero denials, when the meter line is written, then the
   count reads `0` and the tool-name list is empty, never an omitted field.
3. Given `scripts/pair-run.test.sh`, when it runs, then a fixture asserts the
   new field's shape for both a clean turn and a turn with a denial.

**Technical notes**
- `plugins/agentic-sdlc/scripts/pair-run.mjs`'s `runTurn()` already parses
  `out` from the turn's JSON result (see `totals`/`cost_usd` handling) — add
  the same read for `out?.permission_denials`. On v2.1.292 it is an array
  of `{ tool_name, tool_use_id, tool_input }` (ARCH-1 repro), and
  `tool_input.command` carries the full command, body included. Keep only
  `tool_name` and the array length. `tool_input` must never be serialised.
- Constraint from the brief: tool names and counts only, never command text —
  a STATE body may quote code, and that must never reach the meter file.
- This story has value standing alone (the brief's "value dependency" calls
  this out explicitly as the piece to build first): it is what makes the
  success metric's baseline measurable, independent of whether/how the
  mechanism gets fixed.

**Out of scope**
- Changing the write mechanism itself (STORY-3-2/3-3/3-4).
- The run-report schema. If the denial count belongs there too, raise it
  against `docs/briefs/self-improvement/01-run-report.md` instead of adding
  it here.

---

### STORY-3-2: `pair-log.mjs` accepts the new write shape for state/append/session

- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 2 at or below 2 is SOLO
- estimate: M
- select: risk_class=none@brief:L50 one_way_doors=0@brief:L50 existing_pattern=no@brief:L103 modules_crossed=1@brief:L81 review_bounced=no@brief:L50 risk_kind=code@brief:L50
- depends_on: []
- blocked_by_arch: []

**As a** headless navigator or driver
**I want** `pair-log.mjs state`, `append` and `session` to accept input
through the one shape ARCH-1 picks
**So that** the call the permission matcher reliably allows under `-p`
replaces the shape it reliably denies

**Acceptance criteria**
1. Given ARCH-1's chosen mechanism, when `state`, `append` or `session` is
   invoked that way, then the body is written exactly as today's stdin path
   would have written it — same 15/10-line caps, same fence-stripping, same
   truncation warnings on stderr.
2. Given the old stdin-body invocation, when it is still used (a consuming
   project mid-upgrade, or the manual fallback loop), then it continues to
   work unchanged — this story adds the new shape, it does not remove the
   old one.
3. Given `scripts/pair-log.test.sh`, when it runs, then it covers the new
   input path for all three subcommands, including the truncation and
   empty-body rejection cases the stdin path already covers.
4. Given `pair-log.mjs` remains the log's only write surface, when this
   story lands, then no new path lets an agent touch `state.md`, `turns.md`
   or `session.json` directly.

**Technical notes**
- `plugins/agentic-sdlc/scripts/pair-log.mjs` — the existing `readStdin()` /
  `clamp()` pipeline is what every shape must still feed into; this story
  adds how the body arrives, not what happens to it once it does.
- `reference/pair-loop.md`'s "PAIR LOG SHAPE" table documents the write
  surface once — update it here, in the same place, for both roles.
- Hard constraint carried from the brief: this must not weaken `pair-log.mjs`
  as the log's only write surface — agents still never touch the files
  directly, whatever the chosen input shape turns out to be.
- ARCH-1 decided: `state` and `append` take `--from <path>`. `session`
  takes no body, so it gains nothing here. AC3's "all three subcommands"
  means `state` and `append`, plus a test that `session` still works
  with flags only. `--from` reads the file through the same `clamp()`
  and deletes it after a successful write **only if** it resolves inside
  `<log dir>/drafts/`. Any other path is read and left alone. A missing
  file exits 2. Test cases: a consumed drafts file, a path outside drafts
  left intact, a missing file, an empty file, and truncation and fence
  stripping through `--from`.
- `init` creates `<log dir>/drafts/` so the agent's first Write has a
  directory to land in.

**Out of scope**
- `pair-run.mjs`'s side of making the new shape allowed by default
  (STORY-3-3).
- `navigator.md`/`driver.md` actually switching to it (STORY-3-4).
- Any change to STATE/entry contents or the 15/10-line caps themselves.

---

### STORY-3-3: `pair-run.mjs` allows the new shape by default

- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 2 at or below 2 is SOLO
- estimate: S
- select: risk_class=none@brief:L52 one_way_doors=0@brief:L52 existing_pattern=no@brief:L103 modules_crossed=1@brief:L82 review_bounced=no@brief:L52 risk_kind=code@brief:L52
- depends_on: [STORY-3-2]
- blocked_by_arch: []

**As a** consuming project running `/build` headless
**I want** `pair-run.mjs` to set up whatever ARCH-1's mechanism needs so the
new write shape is allowed by default
**So that** the fix works out of the box, with no edit to the consuming
project's own `.claude/settings.json`

**Acceptance criteria**
1. Given a fresh consuming project with no edits to its own
   `.claude/settings.json`, when `pair-run.mjs` spawns a navigator or driver
   turn, then the new write shape (STORY-3-2) is allowed without a
   permission denial.
2. Given whatever `pair-run.mjs` passes or sets up for this (e.g. a scoped
   grant via `PAIR_RUN_CLAUDE_ARGS`-equivalent wiring, or an argument to the
   `claude -p` invocation), when it is applied, then it covers only the
   pair-log script's new write shape — no `--dangerously-skip-permissions`,
   no `bypassPermissions` default, matching the brief's explicit "scope of
   grant" constraint.
3. Given `scripts/pair-run.test.sh`, when it runs, then it asserts the turn
   invocation carries whatever setup ARCH-1's mechanism requires.

**Technical notes**
- `plugins/agentic-sdlc/scripts/pair-run.mjs`'s `runTurn()` builds the `args`
  array passed to `claude -p` today (model, turn-budget, `extraArgs` from
  `PAIR_RUN_CLAUDE_ARGS`) — whatever ARCH-1 needs set up almost certainly
  lands here.
- ARCH-1 decided the grant: one `--allowedTools` with
  `Bash(node <PAIR_LOG> read *)`, `… state *`, `… append *`,
  `… session *` and `Edit(//<abs drafts dir>/**)`, pushed **before**
  `extraArgs`. `<PAIR_LOG>` is the absolute path `pair-run` already
  computes. The drafts dir is `<git toplevel of cwd>/backlog/pair/<ID>/drafts`.
  Don't grant `init`, `Bash(node *)` or any other wider rule. AC3: assert
  each of the five rules is in the stub's argv, and that nothing broader is.
- The same story extends `PROMPTS` so each prompt carries the absolute
  drafts dir and the exact literal write commands. A rule matches literal
  text, so `${CLAUDE_PLUGIN_ROOT}` in a command is denied even with the
  grant (ARCH-1 repro).
- Correct the pair-loop.md sentence, because it is wrong under `-p`.
  Workspace trust gates project `permissions.allow`, so a never-trusted
  folder ignores it under `-p`. Say that `pair-run` grants the pair-log
  surface itself, and that the project's settings and `PAIR_RUN_CLAUDE_ARGS`
  govern everything else.
- `reference/pair-loop.md` already tells `/build` that headless turns get no
  permission prompts and that the project's own allow-list governs them —
  this story is what makes that sentence true for the pair-log write shape
  specifically, update the sentence if the mechanism changes what governs it.

**Out of scope**
- Widening permissions for anything beyond the pair-log script's new shape.
- `navigator.md`/`driver.md` text (STORY-3-4).

---

### STORY-3-4: `navigator.md` and `driver.md` switch to the new write shape

- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 2 at or below 2 is SOLO
- estimate: S
- select: risk_class=none@brief:L54 one_way_doors=0@brief:L54 existing_pattern=yes@brief:L54 modules_crossed=2@brief:L54 review_bounced=no@brief:L54 risk_kind=code@brief:L54
- depends_on: [STORY-3-2, STORY-3-3]
- blocked_by_arch: []

**As a** headless navigator or driver
**I want** my turn's instructions to show the write shape ARCH-1 picked,
not the heredoc-and-pipe shape that gets denied
**So that** I write STATE, my entry and the session on the first try, every
turn, without retrying through `echo`, `printf`, a temp file improvised on
the spot, or the Write tool on the log file

**Acceptance criteria**
1. Given `navigator.md`'s current heredoc-and-pipe examples for `state`,
   `append` and `session`, when this story lands, then they are replaced
   in place by ARCH-1's shape — the same instruction, not an addition
   alongside the old one.
2. Given `driver.md`'s equivalent example, when this story lands, then it is
   replaced the same way, so both roles show one shape.
3. Given `scripts/size-budget.mjs`, when it runs after this change, then
   `agents/navigator.md` and `agents/driver.md` are at or under their current
   caps (text replaces, never adds, per the boot-path budget).
4. Given `reference/pair-loop.md`'s manual-fallback prompts (the ones
   `pair-run.mjs` and the manual loop both quote), when this story lands,
   then they show the same shape too, so the documented protocol and the
   agent instructions never disagree.

**Technical notes**
- `plugins/agentic-sdlc/agents/navigator.md`, `agents/driver.md` — the
  "Write through the same script" block (navigator) and the `append` line
  (driver) are the sections carrying today's heredoc shape.
- The brief is explicit that `navigator.md` already forbids the Write-tool-
  on-the-log-file retry some navigators improvise today — if ARCH-1's
  mechanism *is* `--from <path>` written by the Write tool, that prohibition
  line needs to flip to an instruction, not just get a neighbor.
- ARCH-1 decided: it *is* `--from`. Write the body with the Write tool to
  `drafts/state.md` or `drafts/entry.md` under the drafts dir from the
  prompt, then run the literal command from the prompt. The navigator
  issues both Writes in one message, then one chained call,
  `node <pair-log> state <ID> --from <drafts>/state.md && node <pair-log> append <ID> --role navigator --from <drafts>/entry.md`,
  so its turn keeps today's two round trips. Show the path as a placeholder
  ("the pair-log path and drafts dir from your prompt"), never
  `${CLAUDE_PLUGIN_ROOT}`. That includes the `read` example in both
  files. Narrow "never open a pair-log file directly" to the log files, and
  allow `drafts/`.
- Add one line to both roles: no pipes, no heredocs, no `$VARS` in a
  pair-log command. These shapes are denied headless, and retrying them
  costs the full context each time.
- Byte-for-byte, this should net shrink or hold flat: one shape replaces one
  shape, it doesn't illustrate both.

**Out of scope**
- Any change to what STATE or a turn entry contains.
- The manual (non-headless) fallback loop's reliance on a human to approve
  prompts — unaffected by this story.

## Debt

Ledgered in docs/TOOLING-DEBT.md by the plan commit.

