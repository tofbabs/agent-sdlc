---
description: Build an epic to completion — stories cascade onto one epic branch, each built SOLO or as a navigator⇄coder TDD pair. Architect unblocks mid-build. Opens one PR. Review is `/agentic-sdlc:review`; the REVISE loop that closes its findings runs here separately. `--fast` takes the lean lane instead: one branch, SOLO throughout, gate once.
argument-hint: [EPIC-n | FAST-n | STORY-id] [--fast]
allowed-tools: Agent, Task, Read, Write, Glob, Grep, Skill, Bash(git:*), Bash(gh:*), Bash(cat:*)
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
dependent story starts the moment its parent's *commit* is on the epic branch. It
does not wait for a human to merge anything. That is the whole point — an epic
should take one run, not one run per story with a merge cycle between each.

Set up the integration branch once, then topologically sort by `depends_on` into
waves:

```bash
git worktree add ../wt-EPIC-<n> -b feat/EPIC-<n> origin/main
```

```
For each wave (stories whose depends_on are all already committed):

  1. One story in the wave  → the coder works directly in ../wt-EPIC-<n>.
     Two or more           → one sub-worktree each, branched off the EPIC branch:
         git worktree add ../wt-STORY-<id> -b feat/STORY-<id> feat/EPIC-<n>

  2. Build the story in its worktree, by its selected mode:

     SOLO → Agent(subagent_type: "agentic-sdlc:coder", prompt: "MODE: SOLO.
            Implement <STORY-ID> in <worktree>. Match existing patterns. Block to
            the architect if you hit an unanticipated tooling or pattern decision
            — do not guess. Log deliberate shortcuts to docs/TOOLING-DEBT.md.
            Commit; do NOT open a PR — this is an epic wave.")

            **Inline the story into that prompt** — its acceptance criteria
            verbatim, the binding ARCH resolutions, and the exact file paths it
            owns. Do NOT write "read STORY-<id> in backlog/EPIC-<n>.md". A coder
            sent to the epic file reads the whole thing, and every coder in the
            epic reads it again; inlining is the difference between paying for
            the planning prose once and paying for it per story. Name the files
            so nothing greps for what you already know, and ask for a short
            structured report rather than a narrative.

     PAIR → run the PAIR LOOP (below) for <STORY-ID> in <worktree>. It ends with
            the story's increments committed on the worktree branch, the same
            state SOLO leaves. No PR — this is an epic wave.

  3. If the coder OR navigator reports BLOCKED on an ARCH:
       Agent(subagent_type: "agentic-sdlc:architect", prompt: "Resolve ARCH-<n> — the coder is
             blocked and waiting. Read the codebase, decide, update the epic file.")
       → resume the coder on the same story

  4. Fan-out only: merge each finished sub-worktree back into the epic branch
         git merge --no-ff feat/STORY-<id>
     Resolve, then re-run the FULL gate (see BRANCH TOPOLOGY).

  5. Next wave — its parents are now on the epic branch.

When every story is committed:

  6. git merge origin/main    → resolve → FULL gate → push
  7. Open ONE PR: feat/EPIC-<n> → main. Report the number. Stop.
```

**A single story is different.** `/build STORY-<id>` is the hotfix path: branch
from `origin/main`, one PR to `main`, squash-merge as usual. No epic branch.

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
origin/main
   └── feat/EPIC-<n> ──────────────────────► ONE PR → main   [HUMAN GATE]
         ├─ commit: STORY-a
         ├─ commit: STORY-b   ┐ same wave, sub-worktrees,
         ├─ commit: STORY-c   ┘ merged back with --no-ff
         └─ commit: STORY-d     (starts on a's commit, not a's merge)
```

**Everything inside the epic branches from the epic branch. Nothing inside the
epic squash-merges.** Those two rules are what make the cascade safe, and they
are the real fix for what #77 found.

#77 forbade stacking, and its diagnosis was right: EPIC-4 shipped five stories
stacked on each other, #74 carried both STORY-4-1's and STORY-4-3's commits, and
seven files came back as add/add conflicts on the second pass — none of them a
real difference of opinion. But the cause was never *stacking on its own*. It was
**stacking plus a squash merge to `main` under each story**. Squashing rewrites
the parent's work onto `main` under a new SHA, so the child still carrying the
old SHAs has no common ancestor for those files and git can only call it add/add.

Remove the intra-epic squash and the conflict class disappears. A child branched
off the epic branch shares real ancestry with its parent's commits, so a
`--no-ff` merge back is an ordinary three-way merge — usually a fast-forward, and
where it isn't, a genuine overlap worth looking at.

#77's fix — wait for the parent to *land on main* — also worked, but it paid for
correctness with a human merge cycle per story. An epic branch buys the same
correctness for free.

**Merge `origin/main` in before opening the PR, and again before asking for
review.**

```bash
git merge origin/main   # then run the four gates before pushing
```

Divergence is cheap to resolve while you still remember the epic and expensive
once the branch is a week old. Merging (not rebasing) keeps the pushed history
stable so review threads stay anchored. An epic branch lives longer than a story
branch did, so if the epic runs long, merge `origin/main` in **between waves**
too — do not save it all for the end.

After any conflict resolution, **re-run the full gate** —
`pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Tests alone are not
enough: a resolution that drops a closing brace from a type file still passes
every test and fails only at `build`, with the error reported at the *next*
declaration rather than the damage. That is from #73 and it still applies — the
merges moved, the lesson didn't.

### The epic PR is merge-committed, never squashed

This is load-bearing for release-please, not a style preference.

`release-please-config.json` maps each package to its own component and reads
**per-package conventional commits** — `feat(bff):`, `feat(field-pwa):`. Squashing
the epic PR collapses every story into one commit with one scope, so exactly one
package gets a version bump and every other package the epic touched is silently
missed. EPIC-5 touched four.

Merge-committing preserves each story's own scoped commit, which is what
release-please needs. Use **"Create a merge commit"** on the epic PR — never
"Squash and merge". Squash stays correct for the single-story `/build STORY-<id>`
path, where there is only one scope anyway.

---

## REVISE LOOP — closing the reviewer's round

The code-reviewer posts one structured comment per round on the epic PR
(verdict, reviewed sha, findings `F1..Fn`) via `/agentic-sdlc:review`. It is
not part of the cascade — so this loop runs as its own `/build` invocation
after a verdict lands. When the latest round says `REQUEST_CHANGES`:

```
1. Agent(subagent_type: "agentic-sdlc:coder", prompt: "MODE: REVISE on PR <n>. Read the
         latest `## Review — round <k>` comment, address EVERY finding — fix or
         dispute, never ignore — run the full gate, push, and reply on the PR
         ruling on each finding by ID.")
2. Run `/agentic-sdlc:review <n>` again (or let the routine) to re-review the
   new head and rule on disputes.
3. Max 3 rounds. Still REQUEST_CHANGES → the story or a contract is probably
   wrong. Escalate to the human rather than grinding.
```

`APPROVE` + "Ready for human merge" → report it as such. The human still owns the
merge; nothing here merges its own PR.

---

## COST NOTE

Coder is on Sonnet 5 by default — it runs the most turns, so it dominates spend,
and the cheapest capable model belongs there. In a PAIR story the navigator is on
Opus 4.8 (the escalation tier) — cheaper hands, better eyes — and it runs every
other turn, which is the other half of why pairing roughly doubles a story's cost
and why mode selection matters.

**Escalate a specific story's coder to Opus 4.8** when it's genuinely hard: novel
algorithm, tricky concurrency, or a story that's already come back twice. Override
the model on that invocation rather than changing the agent's default — one hard
story shouldn't multiply your rate across every easy one.

**Never Fable on the coder or navigator.** It belongs on the architect, where
turns are few and judgment is dense. In the loops its cost compounds across
volume for decisions that are mostly local and cheap to redo.

**The model tier is the small lever; the context curve is the big one.** A PAIR
story's spend is `Σ over turns of (round trips × context at that turn)`. Model
choice scales the rate. Whether the agents are fresh scales the *shape* — flat or
quadratic — and on EPIC-15 that shape was worth more than any tier decision in
this section. Get freshness right first.

---

## HARD RULES

- **Never merge a PR to `main`.** That's the human's, after review. Merging a
  story's sub-worktree into the *epic branch* is not that — it is assembling the
  thing the human will review, and the pipeline does it.
- **Never squash inside an epic**, and never branch a story that belongs to the
  open epic off `origin/main` — branch it off the epic branch instead. Both
  reintroduce #77's add/add conflicts — see BRANCH TOPOLOGY. This does not apply
  to the hotfix path (`/build STORY-<id>` for a story outside any open epic):
  that still branches from `origin/main` and squash-merges to `main` as usual.
- **The epic PR is merge-committed, not squashed.** Squashing costs release-please
  every package bump but one.
- **One epic in flight at a time**, unless two epics provably touch disjoint
  packages. Two long-lived epic branches diverging from `main` is the same
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
- **Check the epic file's `status:` against `main` before starting.** Story status
  in the backlog is hand-maintained and goes stale — EPIC-5 read `TODO` on all
  four stories when three had already shipped. Trust merged PRs and the code, not
  the marker; then fix the marker.

---

## REPORT

One PR for the epic, so the table reports stories against it:

| STORY-ID | Mode | Status | Commit | ARCH blocks hit |
|----------|------|--------|--------|-----------------|

Plus: the epic PR number, and new tooling debt logged this run.
