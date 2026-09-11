---
description: Review an open PR — the code-reviewer reads it in its own worktree and posts one "Review — round <k>" comment with findings F1..Fn, then the GitHub verdict. Never edits, never merges. Closing its findings is /build's REVISE loop. --fable escalates the model for a security-critical or contract-changing PR.
argument-hint: <PR-number> [--fable]
allowed-tools: Agent, Task, Read, Glob, Grep, Skill, Bash(git:*), Bash(gh:*), Bash(cat:*)
---

Target: `$ARGUMENTS` minus the flag — strip `--fable` if present; what remains
is the PR number.

Delegate the judgment; do the bookkeeping yourself.

---

## 1. GATHER

```bash
gh pr view <n> --json state,headRefName,baseRefName,headRefOid,body,reviews,comments,commits
gh pr checks <n>
```

- **State must be OPEN.** Anything else → report and stop.
- `Mode: FAST` = a line matching `^Mode: FAST\s*$` in the PR body.
- CI summary: green, or red naming the job(s).
- **Story IDs** from `[STORY-…]` / `[T<n>-…]` tags in commit subjects, and
  from the branch name (`feat/STORY-<id>`, `feat/EPIC-<n>`, `feat/FAST-<n>`)
  → the backlog file that holds them.
- **Previous round `k`** = the highest `## Review — round <k>` heading across
  **all** review and comment bodies, any author — the human, the routine, and
  this command may all post under one `gh` identity. Note its reviewed sha
  and verdict, and whether a `## Response — round k` from the coder exists.

---

## 2. GUARD — nothing new, no spawn

- If `k ≥ 1`, the current head sha equals round `k`'s reviewed sha, **and**
  no `## Response — round k` exists: report `"already reviewed at <sha>, no
  response yet"` and **stop**. This is what makes an hourly routine call
  cheap — nothing changed, nothing spawns.
- If `k ≥ 4` and the last verdict was `REQUEST_CHANGES`: report `"round cap
  reached — escalate to the human"` and **stop**.

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
      [model: "claude-fable-5" if --fable was passed],
      prompt: "Review PR <n>, round <k+1>. Worktree: <abs path>. Head sha:
      <sha>. Base: origin/<base>. Story IDs: <ids> in <backlog file> — read
      only those sections. Mode: FAST — yes|no. CI: <summary>. Previous
      round: <k> at <sha>, verdict <v>; coder response present: yes|no. Post
      one `## Review — round <k+1>` review and the verdict per your OUTPUT
      section. Report in your REPORT shape.")
```

---

## 5. CLEANUP

Always, whether the reviewer succeeded or blocked:

```bash
git worktree remove ../wt-review-<n>
```

Note the removal in your report in one line — this is the first command in
this repo's pipeline that removes a worktree rather than merging it or
leaving it for a human, so say so rather than diverging silently.

---

## 6. REPORT

| PR | Round | Verdict | Reviewed sha | Findings | Escalate |
|----|-------|---------|--------------|----------|----------|

Then the next step:

- `REQUEST_CHANGES` → `/agentic-sdlc:build` REVISE on PR `<n>`.
- `APPROVE` → "Ready for human merge — the human owns the merge."
- round cap or `[ARCH]` → the human.

---

## HARD RULES

- Never merge.
- Never edit code.
- Never `gh pr checkout` in the user's own tree.
- Never spawn the reviewer when the guard in step 2 says nothing changed.
- Never leave the review worktree behind — remove it in step 5 even when the
  reviewer blocks or reports an escalation.
- One fresh `Agent()` per invocation. Never `SendMessage` to continue one.
- Never restate or soften the reviewer's verdict.
