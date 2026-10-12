---
description: Plan a feature — stories from the planner, architecture decisions from the architect. Non-blocking. `--fast` takes the lean lane: a flat task list, no handoffs.
argument-hint: <path-to-brief.md-or-epic-description> [--fast] [--model <agent>=<m>]
allowed-tools: Agent, Task, Read, Write, Glob, Grep, LSP, Skill, Bash(cat:*)
---

Input: `$ARGUMENTS` sans flags.
**Models:** `--model` or `**Agent models:**` in `CLAUDE.md` → `cat ${CLAUDE_PLUGIN_ROOT}/reference/models.md`.
**Consent:** `cat ${CLAUDE_PLUGIN_ROOT}/reference/consent.md` first.

**Delegate — you write no stories.**

---

## FAST LANE

`--fast` replaces everything below: one planner call, a ~40-line list, no architect pass unless a one-way door is tagged.

```bash
cat ${CLAUDE_PLUGIN_ROOT}/reference/fast-mode.md
```

---

## STEP 1 — Decompose

`cat ${CLAUDE_PLUGIN_ROOT}/reference/plan-artifacts.md` and `reference/epic-budget.md`, then `claim EPIC [--id EPIC-<n>]` per
epic (given id is kept, taken fails) — the planner never picks a number.

```
Agent(subagent_type: "agentic-sdlc:planner", prompt: "Decompose this into epics and stories with
acceptance criteria. Raise ARCH-<n> for architecture or tooling decisions; do NOT decide them. Overwrite <claimed path>.")
```

Over the cap: planner returns later parts' outline (SPLIT in epic-budget.md); claim one EPIC per part, Part 1 in full, later parts stubs.

---

## STEP 2 — Resolve handoffs

Each `OPEN` `ARCH-<n>`:

```
Agent(subagent_type: "agentic-sdlc:architect", prompt: "Resolve ARCH-<n>. Read the codebase first;
consistency beats cleverness. DECIDE. ADR only for one-way doors; else resolve inline in the epic file. Shortcuts go under ## Debt there.")
```


---

## STEP 3 — Review (non-blocking)

Add `- Artifacts:` (new ADRs, brief). Record the lane (Part 1 only):
`node ${CLAUDE_PLUGIN_ROOT}/scripts/mode-select.mjs record --file <claimed path> --chosen deliberate`.
`node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-artifacts.mjs check EPIC-<n>`. Fail → re-split once; again → "still over".
Show epics, stories, decisions, ADRs, debt. Silence lets `/build` proceed.

---

## FILL-IN

Input `EPIC-<n>`: `plan-artifacts.mjs ready EPIC-<n> --base <base> --deps-only` (`<base>` as `/build`); non-zero → stop. Not a STUB → refuse, change nothing. Else follow `reference/epic-budget.md`.

---

## REPORT

Rows in build order.

| Epic | Stories | Points | Depends on | ARCH | Status |
|--|--|--|--|--|--|

Then `/build EPIC-<n>`
