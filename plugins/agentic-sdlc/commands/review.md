---
description: Review an open PR — the code-reviewer reads it in its own worktree and posts one "Review — round <k>" comment with findings F1..Fn, then the GitHub verdict. Never edits, never merges. Closing its findings is /build's REVISE loop.
argument-hint: <PR-number> [--fable] [--model <agent>=<m>]
allowed-tools: Agent, Task, Read, Glob, Grep, Skill, Bash(git:*), Bash(gh:*), Bash(cat:*), Bash(node:*)
---

Target: `$ARGUMENTS` minus flags.
**Models:** `cat ${CLAUDE_PLUGIN_ROOT}/reference/models.md` first; it resolves the reviewer's model.

Delegate the judgment; do the bookkeeping.

---

## 1. GATHER

```bash
gh api repos/{owner}/{repo}/pulls/<n>   # .head.sha is headRefOid
gh api repos/{owner}/{repo}/commits/<headRefOid>/check-runs?per_page=100 \
  | node ${CLAUDE_PLUGIN_ROOT}/scripts/ci-state.mjs
```

Also read `pulls/<n>/reviews`, `issues/<n>/comments` and `pulls/<n>/commits`.

- **State must be OPEN.** Anything else → report and stop.
- `Mode: FAST` = a line matching `^Mode: FAST\s*$` in the PR body.
- **CI gate** (`reference/review-rounds.md`): `pending` → "waiting on CI", `red` → "CI red: <jobs>"; **stop**.
- **Story IDs** from `[STORY-…]` / `[T<n>-…]` tags in commit subjects, and
  from the branch name (`feat/STORY-<id>`, `feat/EPIC-<n>`, `feat/FAST-<n>`)
  → the backlog file that holds them. An epic PR has one squash commit per
  story, so one tag per story. `feat/STORY-<id>` appears as a PR
  head only on the hotfix path; inside an epic it is local and already landed.
  `fix/EPIC-<n>-round-<k>` is **never** a PR head at all — a revise round only
  ever exists locally, landing as one `fix(...)` commit on the epic branch —
  so skip it.
- **Previous round**: save the reviews and comments JSON to files, then
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/round-state.mjs --reviews f --comments f`
  → `round` (`k`), `verdict`, `sha`, `response`.

---

## 2. GUARD — nothing new, no spawn

- If `k ≥ 1`, the head sha equals `sha` and `response` is false: report `"already reviewed at <sha>, no
  response yet"` and **stop**. This is what makes an hourly routine call
  cheap — nothing changed, nothing spawns.
- If `k ≥` the cap (`node ${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs get review.round_cap`; non-zero
  exit → stop) and the last verdict was `REQUEST_CHANGES`: report `"needs a human"`, post nothing, **stop**.

---

## 3. WORKTREE

```bash
git fetch origin <head-branch>
git worktree remove ../wt-review-<n> 2>/dev/null || true   # if stale
git worktree add --detach ../wt-review-<n> origin/<head-branch>
```

`--detach` avoids "branch already checked out" if the PR's own branch is
active elsewhere. **Never `gh pr checkout`** — it moves the user's own
checkout, not just yours.

---

## 4. SPAWN

One fresh agent, every fact inlined — the reviewer never re-derives what you
already gathered:

```
Agent(subagent_type: "agentic-sdlc:code-reviewer",
      model: <resolved code-reviewer model>,
      prompt: "Review PR <n>, round <k+1>. Worktree: <abs path>. Head sha:
      <sha>. Base: origin/<base>. Story IDs: <ids> in <backlog file> — read
      only those sections. Mode: FAST — yes|no. CI: <summary>. Round k≥1:
      re-check <last sha>..<head>; earlier findings: <findings>;
      `## Response — round <k>`: <responseBody>; see Rounds 2+. Post one `## Review — round <k+1>` review and the verdict per your OUTPUT
      section. Report in your REPORT shape.")
```

---

## 5. CLEANUP

Always, whether the reviewer succeeded or blocked:

```bash
git worktree remove ../wt-review-<n>
```

Note the removal in your report in one line.

---

## 6. REPORT

| PR | Round | Verdict | Reviewed sha | Findings | Escalate |
|----|-------|---------|--------------|----------|----------|

Record a review event per story ID (`reference/outcomes.md`), `--findings` = open findings (unresolved), then the next step:

- `REQUEST_CHANGES` → `/agentic-sdlc:build` REVISE on PR `<n>`.
- `APPROVE` → "Ready for human merge — the human owns the merge."
- `[ARCH]` → the human.

---

## HARD RULES

- Never merge.
- Never edit code.
- Never `gh pr checkout` in the user's own tree.
- Never spawn the reviewer when step 2 says nothing changed.
- Never leave the review worktree behind — remove it in step 5 even when the
  reviewer blocks or reports an escalation.
- One fresh `Agent()` per invocation. Never `SendMessage` to continue one.
- Never restate or soften the reviewer's verdict.
