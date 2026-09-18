---
name: agentic-sdlc-build
description: Build an epic or story using the Agentic SDLC protocol. Cascades stories onto an epic branch, executing each story SOLO or as a navigator⇄coder ping-pong TDD pair, lands each as a single squash commit, and opens one PR.
---

# Agentic SDLC: Build (`/agentic-sdlc:build`)

Use this skill to execute a backlog epic or standalone story to completion.

## Invocation & Arguments

```bash
/agentic-sdlc:build [EPIC-n | FAST-n | STORY-id] [--fast]
```

- **Target**: The epic identifier (`EPIC-1`, `FAST-1`) or single story hotfix (`STORY-1-1`).
- **`--fast` Flag**: Runs the lean lane: sequential SOLO execution on a single branch, gate once, decide-and-log debt.

---

## 1. Setup & Contract Resolution

1. **Resolve `<base>`**: Check `AGENTS.md`, `GEMINI.md`, or `CLAUDE.md` for `**Integration branch:** <name>`. If absent, `<base>` is `main`.
2. **Fetch Base**: `git fetch origin <base>`.
3. **Preflight**: Verify `backlog/EPIC-<n>.md` exists and no target story is blocked by an `OPEN` ARCH handoff.
4. **Lane Selection**:
   - If `--fast` is set: read `plugins/agentic-sdlc/reference/fast-mode.md` before starting.
   - If Deliberate: proceed with the epic worktree cascade.

---

## 2. Mode Selection (Per Story Heuristic)

In deliberate mode, evaluate each story before execution:
- **Estimate S, patterned, well-specified** $\rightarrow$ **SOLO**: Single coder (`model: flash`) builds end-to-end in its worktree.
- **Estimate M or L, novel logic, or previously bounced** $\rightarrow$ **PAIR**: Navigator (`model: pro`) and Coder (`model: flash`) ping-pong TDD using `plugins/agentic-sdlc/scripts/pair-log.mjs`.

---

## 3. The Deliberate Cascade Loop

### A. Integration Worktree
```bash
git worktree add ../wt-EPIC-<n> -b feat/EPIC-<n> origin/<base>
```
*The epic branch receives landings; it is never edited directly.*

### B. Wave Execution
Topologically sort stories by `depends_on`. For each wave:

1. **Create Story Worktree**:
   ```bash
   git worktree add ../wt-STORY-<id> -b feat/STORY-<id> feat/EPIC-<n>
   ```
2. **Execute Story**:
   - **SOLO**: Spawn `coder` subagent (`model: flash`) in `../wt-STORY-<id>`. Inline the acceptance criteria and file paths in the prompt. Run tests, run the project check command, commit changes. Report story title and package scopes touched.
   - **PAIR**: Follow `plugins/agentic-sdlc/reference/pair-loop.md`:
     - Run `node plugins/agentic-sdlc/scripts/pair-log.mjs init <STORY-ID>`.
     - Alternate fresh spawns of `navigator` (`model: pro`) and `coder` (`model: flash`).
     - Navigator writes the next failing test; coder makes it pass.
     - Cap: 20 alternations per story.
3. **Mid-Build Architecture Block**:
   If coder reports blocked on an `ARCH-<n>`:
   - Spawn `architect` subagent (`model: pro`).
   - Resolve the decision in `backlog/EPIC-<n>.md` (or ADR).
   - Resume the coder.
4. **Squash Landing on Epic Branch**:
   In `../wt-EPIC-<n>`:
   ```bash
   git merge --squash feat/STORY-<id>
   # Run full project gate: test, lint, typecheck, build
   git commit -m "feat(<scope>): <story title> [STORY-<id>]"
   ```
   *(Include multiple headers if multiple packages were touched for release-please).*
5. **Clean Up Worktree**:
   ```bash
   git worktree remove ../wt-STORY-<id>
   git branch -D feat/STORY-<id>
   ```

### C. Completion & PR
1. Merge latest `<base>`:
   ```bash
   git merge origin/<base>
   # Re-run full gate after resolution
   git push -u origin feat/EPIC-<n>
   ```
2. Open PR:
   ```bash
   gh pr create --base <base> --fill
   ```
3. Report PR number. **Stop and wait for human review / `/agentic-sdlc:review`. Never self-merge.**

---

## 4. The REVISE Loop (Addressing Code Review Findings)

When `/agentic-sdlc:review` posts a `REQUEST_CHANGES` verdict with finding IDs (`F1..Fn`):
1. Create a revision worktree off `feat/EPIC-<n>`:
   ```bash
   git worktree add ../wt-REVISE-<n>-<k> -b fix/EPIC-<n>-round-<k> feat/EPIC-<n>
   ```
2. Spawn `coder` (`model: flash`) in `REVISE` mode to fix or dispute each finding by ID and run the project gate.
3. Squash-land into `../wt-EPIC-<n>`:
   ```bash
   git merge --squash fix/EPIC-<n>-round-<k>
   git commit -m "fix(<scope>): address review round <k> [EPIC-<n>]"
   git push
   ```
4. Post response comment on PR:
   ```markdown
   ## Response — round <k>
   - F1: FIXED — <explanation>
   - F2: DISPUTED — <justification>
   ```
5. Remove revision worktree and re-trigger `/agentic-sdlc:review`. Max 3 rounds before escalating to the human.
