---
description: Build stories — coder implements, architect unblocks when the coder hits a decision. Opens PRs. Review happens separately.
argument-hint: [EPIC-n | STORY-id]
allowed-tools: Agent, Task, Read, Write, Glob, Grep, Skill, Bash(git:*), Bash(gh:*)
---

Target: $1

Execute the backlog. **Delegate all code.**

---

## PRECONDITIONS

- [ ] `backlog/EPIC-<n>.md` exists with stories
- [ ] No `ARCH` blocking a target story is still `OPEN`

Any `OPEN` handoff on a target story → run the architect first.

---

## THE LOOP

Topologically sort by `depends_on`. Run independent stories in parallel.

```
For each story:

  1. Agent(subagent_type: "coder", prompt: "Implement <STORY-ID>. Match existing
           patterns. Block to the architect if you hit an unanticipated tooling
           or pattern decision — do not guess. Log deliberate shortcuts to
           docs/TOOLING-DEBT.md. Open a PR when done.")

  2. If the coder reports BLOCKED on an ARCH:
       Agent(subagent_type: "architect", prompt: "Resolve ARCH-<n> — the coder is
             blocked and waiting. Read the codebase, decide, update the epic file.")
       → resume the coder on the same story

  3. Coder opens the PR → report the number and move on
```

**Code review is out of scope here.** It runs as a separate Claude Code routine
against the open PR. This command's job ends at "PR is open."

---

## PARALLEL WORK

Concurrent coders will fight over the working tree. One worktree per stream:

```bash
git worktree add ../wt-EPIC-2 -b feat/EPIC-2
```

---

## COST NOTE

Coder is on Sonnet 5 by default — it runs the most turns, so it dominates spend,
and the cheapest capable model belongs there.

**Escalate a specific story to Opus 4.8** when it's genuinely hard: novel
algorithm, tricky concurrency, or a story that's already come back twice. Override
the model on that invocation rather than changing the agent's default — one hard
story shouldn't multiply your rate across every easy one.

**Never Fable here.** It belongs on the architect, where turns are few and
judgment is dense. On the coder, its cost compounds across volume for decisions
that are mostly local and cheap to redo.

---

## HARD RULES

- **Never merge a PR.** That's the human's, after review.
- Never let the coder guess at an architecture decision. A block is cheap; a wrong
  pattern replicated across four stories is not.
- If a coder blocks three times on one story, the **story** is probably wrong.
  Escalate to the human rather than grinding.

---

## REPORT

| STORY-ID | Status | PR | ARCH blocks hit |
|----------|--------|----|-----------------|

Plus: new tooling debt logged this run.
