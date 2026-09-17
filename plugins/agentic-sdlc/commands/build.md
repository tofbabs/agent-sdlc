---
description: Build an epic to completion — stories cascade onto one epic branch, each built SOLO or as a navigator⇄coder TDD pair and landed as ONE squash commit. Architect unblocks mid-build. Opens one PR. Review is `/agentic-sdlc:review`; the REVISE loop that closes its findings runs here separately. `--fast` takes the lean lane instead: one branch, SOLO throughout, gate once.
argument-hint: [EPIC-n | FAST-n | STORY-id] [--fast]
allowed-tools: Agent, Task, Read, Write, Glob, Grep, LSP, Skill, Bash(git:*), Bash(gh:*), Bash(cat:*)
---

Target: `$ARGUMENTS` minus the flag — strip `--fast` if present; what remains is the target.

Execute the backlog. **Delegate all code.**

---

## FAST LANE

`--fast` in the arguments replaces the cascade below: one branch, SOLO throughout,
no worktrees, no navigator, gate once, one PR.

```bash
cat ${CLAUDE_PLUGIN_ROOT}/reference/fast-mode.md
```

**Read it before the first coder turn** — that file is the protocol, this is not.
A deliberate run never reads it and never pays for it.

---

## PRECONDITIONS

- [ ] `backlog/EPIC-<n>.md` exists with stories
- [ ] No `ARCH` blocking a target story is still `OPEN`

Any `OPEN` handoff on a target story → run the architect first.

---

## BASE BRANCH

Everything below branches from, merges in, and opens its PR against **`<base>`** —
the project's integration branch. Resolve it once, before anything else:

- A literal line `**Integration branch:** <name>` in the project's `CLAUDE.md`
  names it (e.g. `**Integration branch:** staging`).
- No such line → `<base>` is `main`.

```bash
git fetch origin <base>
```

Fetch it **once** per run, then work against `origin/<base>`. Wherever this file
says `<base>`, substitute the resolved name — never hardcode `main` into a
command you actually run, and name `<base>` explicitly in every agent prompt that
needs it. Agents do not resolve it themselves.

---

## MODE SELECTION — per story

Each story is built one of two ways. Decide per story, not per epic. (Under
`--fast` this heuristic does not run at all — every task is SOLO.)

- **estimate S, well-specified, a pattern for it already exists** → **SOLO**: one
  coder invocation runs the story to completion in its worktree.
- **estimate M or L, novel logic, or a story that came back from review** →
  **PAIR**: the navigator and coder ping-pong TDD, one increment at a time (see
  PAIR LOOP).

Pairing roughly doubles a story's turns, so it goes where the risk is, not
everywhere. When unsure, pair — a wrong M story costs more than the pairing
overhead on ten S stories. The mode is orthogonal to the cascade: a wave can hold
SOLO and PAIR stories at once, each in its own worktree.

---

## THE LOOP

`/build EPIC-<n>` **runs the epic to completion in one go.** Stories cascade: a
dependent story starts the moment its parent has *landed* on the epic branch. It
does not wait for a human to merge anything. That is the whole point — an epic
should take one run, not one run per story with a merge cycle between each.

Set up the integration branch once, then topologically sort by `depends_on` into
waves:

```bash
git worktree add ../wt-EPIC-<n> -b feat/EPIC-<n> origin/<base>   # integration only — never edit here
```

```
For each wave (stories whose depends_on have all LANDED on feat/EPIC-<n>):

  1. Every story gets its own branch off the CURRENT epic tip — one story or ten:
         git worktree add ../wt-STORY-<id> -b feat/STORY-<id> feat/EPIC-<n>
     There is no "single story works directly on the epic branch" case. The epic
     branch receives landings; it never receives work.

  2. Build the story in its worktree, by its selected mode:

     SOLO → Agent(subagent_type: "agentic-sdlc:coder", prompt: "MODE: SOLO.
            Implement <STORY-ID> in <worktree>, on branch feat/STORY-<id>. Match
            existing patterns. Block to the architect if you hit an unanticipated
            tooling or pattern decision — do not guess. Log deliberate shortcuts
            to docs/TOOLING-DEBT.md. Commit; do NOT open a PR — this is an epic
            wave. Report the story title and every release-please package scope
            you touched.")

            **Inline the story into that prompt** — its acceptance criteria
            verbatim, the binding ARCH resolutions, and the exact file paths it
            owns. Do NOT write "read STORY-<id> in backlog/EPIC-<n>.md". A coder
            sent to the epic file reads the whole thing, and every coder in the
            epic reads it again; inlining is the difference between paying for
            the planning prose once and paying for it per story. Name the files
            so nothing greps for what you already know, and ask for a short
            structured report rather than a narrative.

     PAIR → run the PAIR LOOP (below) for <STORY-ID> in <worktree>. It ends with
            the story's increments committed on the story branch, the same state
            SOLO leaves. No PR — this is an epic wave.

  3. If the coder OR navigator reports BLOCKED on an ARCH:
       Agent(subagent_type: "agentic-sdlc:architect", prompt: "Resolve ARCH-<n> — the coder is
             blocked and waiting. Read the codebase, decide, update the epic file.")
       → resume the coder on the same story

  4. LAND — in ../wt-EPIC-<n>, one story at a time:
         git merge --squash feat/STORY-<id>
         → resolve → FULL gate →
         git commit -m "feat(<scope>): <story title> [STORY-<id>]"

     One conventional header per release-please scope the story touched — see
     MULTI-SCOPE LANDINGS. **The story's report names its scopes and title; do
     not grep the diff for them.**

  5. CLEAN UP:
         git worktree remove ../wt-STORY-<id>
         git branch -D feat/STORY-<id>      # -D: a squash leaves it "unmerged"

  6. Next wave — its parents are now landed.

When every story has landed:

  7. git merge origin/<base>  → resolve → FULL gate → git push -u origin feat/EPIC-<n>
  8. Open ONE PR: feat/EPIC-<n> → <base>. Report the number. Stop.
```

Nothing but `feat/EPIC-<n>` is ever pushed. Story branches and revise branches are
local scaffolding; they exist between a worktree being created and its landing
commit, and then they are gone.

### MULTI-SCOPE LANDINGS

A story that touched more than one release-please package gets one conventional
header per scope in the landing message — release-please parses multiple headers
in a single commit, so each package still gets its bump:

```
feat(bff): <story title> [STORY-<id>]

feat(field-pwa): <story title> [STORY-<id>]
```

Keep the `[STORY-<id>]` tag on every header: `/agentic-sdlc:review` derives the
story IDs it reviews from commit subjects.

**A single story is different.** `/build STORY-<id>` is the hotfix path: branch
from `origin/<base>`, one PR to `<base>`, squash-merge as usual. No epic branch.

**Code review is out of scope here.** It is `/agentic-sdlc:review <PR-n>` — run
by hand or by the hourly routine — and posts a round comment on the PR. This
command's job ends at "PR is open." Closing what that review finds is the
REVISE LOOP (below) — a separate `/build` invocation once a round comment has
landed, not part of the cascade run.

---

## PAIR LOOP — loaded only when a story selects PAIR

A PAIR story is driven by **the orchestrator** alternating fresh navigator and
coder agents, one increment at a time, with `backlog/pair/<STORY-ID>/` as the
shared memory. That protocol runs ~130 lines and only a PAIR story needs it, so
it lives in a file instead of in this prompt:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/reference/pair-loop.md
```

**Read it before the first navigator turn of the first PAIR story in a run.** An
all-SOLO run never reads it and never pays for it. Do not improvise the protocol
from the summary below — it is a reminder, not a substitute.

Three things you must not get wrong even before you read it:

- **Every turn is a FRESH `Agent()`. Never `SendMessage`.** A live agent's
  context is re-sent on each of its 18-42 internal round trips per turn, so
  keeping one alive makes a story cost O(alternations²) — measured at 139M input
  tokens for a single agent on a 31-alternation story.
- **Never read a pair-log file into your own context.** `pair-log.mjs status` is
  the only thing you need between turns, and it prints one line.
- **CAP: 20 alternations per story**, counted by the script. Hitting it means the
  story is too big — split it rather than raising the cap.

---

## BRANCH TOPOLOGY

```
origin/<base>
   └── feat/EPIC-<n>   integration only ──────────► ONE PR → <base>  [HUMAN GATE]
         ├─ feat(x): STORY-a [STORY-a]   ← squash of feat/STORY-a
         ├─ feat(x): STORY-b [STORY-b]   ┐ same wave: both branched from a's landing,
         ├─ feat(y): STORY-c [STORY-c]   ┘ landed one after the other
         ├─ Merge origin/<base>          ← between waves / before the PR
         └─ fix(x): address review round 1 [EPIC-<n>]   ← squash of fix/EPIC-<n>-round-1
```

Two invariants make the cascade safe, and every rule below follows from them:

1. **A story branches only from the epic tip, and only after every `depends_on`
   has landed on it.**
2. **The epic branch is never worked on directly** — it receives story landings,
   review-round landings, and `origin/<base>` merges, nothing else.

- **Never branch a story off `origin/<base>` or off another story's branch.**
  Only the epic tip, after its `depends_on` have landed. That stacking, not the
  squash, is what #77 measured — so squashing inside the epic is safe here.
- **Merge `origin/<base>` in before opening the PR, again before asking for
  review, and between waves on a long epic** — `git merge origin/<base>`, then
  re-gate. Merge, never rebase, so pushed history stays stable and review threads
  stay anchored.
- **After any conflict resolution and after every squash landing, re-run the
  FULL gate** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Tests
  alone miss a dropped brace in a type file that only `build` catches (#73).
- **The epic PR is merge-committed, never squashed** — "Create a merge commit",
  never "Squash and merge". Squashing collapses every story into one scope and
  release-please then bumps exactly one package of the several an epic touched.
  Squash stays correct for the single-story `/build STORY-<id>` path.

The full #77/#74 post-mortem, the #73 gate lesson, and the release-please
reasoning behind these four rules are in
[docs/build-rationale.md](../../../docs/build-rationale.md) — read once, not
re-read on every `/build`.

---

## REVISE LOOP — closing the reviewer's round

The code-reviewer posts one structured comment per round on the epic PR
(verdict, reviewed sha, findings `F1..Fn`) via `/agentic-sdlc:review`. It is
not part of the cascade — so this loop runs as its own `/build` invocation
after a verdict lands. **The orchestrator owns the git bookkeeping, the push and
the PR comment; the coder owns only the judgment.** When the latest round says
`REQUEST_CHANGES`:

```
0. Set up — the round gets its own branch, exactly like a story:
       gh pr view <n> --json headRefName,baseRefName   → feat/EPIC-<n>, <base>
       git fetch origin feat/EPIC-<n>
       ../wt-EPIC-<n> missing (a new session)?
           git worktree add ../wt-EPIC-<n> feat/EPIC-<n>
       git worktree add ../wt-REVISE-<n>-<k> -b fix/EPIC-<n>-round-<k> feat/EPIC-<n>

1. Agent(subagent_type: "agentic-sdlc:coder", prompt: "MODE: REVISE on PR <n> in
         ../wt-REVISE-<n>-<k>. Address EVERY finding — fix or dispute, never
         ignore — run the full gate, commit. Do NOT push, do NOT comment on the
         PR. Report each finding's ruling (FIXED/DISPUTED + one line) as a
         structured list, plus the scopes you touched.")

2. LAND in ../wt-EPIC-<n>:
       git merge --squash fix/EPIC-<n>-round-<k>
       → resolve → FULL gate →
       git commit -m "fix(<scope>): address review round <k> [EPIC-<n>]"
       git merge origin/<base>   # if behind; re-gate after any resolution
       git push

3. Post the response yourself, from the coder's rulings:
       gh pr comment <n> --body '## Response — round <k>
       - F1: FIXED — <one line>
       - F2: DISPUTED — <why the finding is mistaken>'
   **Push BEFORE commenting** — `/agentic-sdlc:review`'s guard keys on
   "new sha AND a response exists"; commenting first can let a re-review fire
   against the old head.

4. Clean up:
       git worktree remove ../wt-REVISE-<n>-<k>
       git branch -D fix/EPIC-<n>-round-<k>

5. Run `/agentic-sdlc:review <n>` again (or let the routine) to re-review the
   new head and rule on disputes.

6. Max 3 rounds. Still REQUEST_CHANGES → the story or a contract is probably
   wrong. Escalate to the human rather than grinding.
```

One `fix(...)` commit per round on the epic branch, for the same reason stories
land as one commit each: the PR's history and release-please's changelog read as
one line per unit of work, not one per increment.

`APPROVE` + "Ready for human merge" → report it as such. The human still owns the
merge; nothing here merges its own PR.

---

## COST NOTE

- **Coder on Sonnet 5 by default** — it runs the most turns, so the cheapest
  capable model belongs there. **Escalate a story's coder to Opus 4.8** only when
  it is genuinely hard (novel algorithm, tricky concurrency, or twice-bounced);
  override on that invocation, not the agent default.
- **Never Fable on the coder or navigator** — it belongs on the architect, where
  turns are few and judgment is dense.
- **The model tier is the small lever; whether the agents are fresh is the big
  one.** Get freshness right first.

The full cost model — why freshness beats tier, and the corrected billing
arithmetic — is in [docs/build-rationale.md](../../../docs/build-rationale.md).

---

## HARD RULES

- **Never commit work directly on `feat/EPIC-<n>`.** Only story landings, review-
  round landings and `origin/<base>` merges touch it. Every story gets a branch,
  even when the wave holds exactly one.
- **Every story lands as one squash commit, branched from the epic tip after its
  parents landed.** Never branch a story off `origin/<base>` or off another
  story's branch — that stacking, not the squash, is what #77 measured. See
  BRANCH TOPOLOGY. This does not apply to the hotfix path (`/build STORY-<id>`
  for a story outside any open epic): that branches from `origin/<base>` and
  squash-merges to `<base>` as usual.
- **Never merge a PR to `<base>`.** That's the human's, after review. Landing a
  story into the *epic branch* is not that — it is assembling the thing the human
  will review, and the pipeline does it.
- **The epic PR is merge-committed, not squashed.** Squashing costs release-please
  every package bump but one.
- **Never push anything but `feat/EPIC-<n>`.** Story and revise branches are local
  and are deleted after landing.
- **One epic in flight at a time**, unless two epics provably touch disjoint
  packages. Two long-lived epic branches diverging from `<base>` is the same
  bookkeeping cost #77 measured, just moved up a level.
- Never let the coder guess at an architecture decision. A block is cheap; a wrong
  pattern replicated across four stories is not.
- **In a PAIR story, never skip the navigator turn to save time**, and never let
  the driver write or modify a test. Either collapses the pair back into solo work
  while still paying the pair's price. One increment per driver turn, one test per
  navigator turn. `--fast` selecting SOLO for every task is **not** the
  degradation this rule forbids — choosing the lane up front is the point of the
  flag. The forbidden thing is running a story *in* PAIR and skipping its
  navigator turns.
- **Never continue a pair agent with `SendMessage`. Every turn is a fresh
  `Agent()`.** A live agent's context is re-sent on each of its 18–42 internal
  round trips per turn, so keeping it alive makes a story cost O(alternations²) —
  see PAIR LOOP. The pair log is the memory; the agent must not be.
- **Never read a pair-log file into the orchestrator's own context.**
  `pair-log.mjs status` is the only thing you need between turns, and it prints
  one line. Anything you read accumulates one copy per alternation.
- If a coder blocks three times on one story, the **story** is probably wrong.
  Escalate to the human rather than grinding.
- **Check the epic file's `status:` against `<base>` before starting.** Story
  status in the backlog is hand-maintained and goes stale — EPIC-5 read `TODO` on
  all four stories when three had already shipped. Trust merged PRs and the code,
  not the marker; then fix the marker.

---

## REPORT

One PR for the epic, so the table reports stories against it:

| STORY-ID | Mode | Status | Landed as | ARCH blocks hit |
|----------|------|--------|-----------|-----------------|

`Landed as` is the story's squash commit on `feat/EPIC-<n>` — one sha per story.

Plus: the epic PR number, the resolved `<base>`, and new tooling debt logged this
run.
