---
description: Plan a feature — stories from the planner, architecture decisions from the architect. Non-blocking. `--fast` takes the lean lane: a flat task list, no handoffs.
argument-hint: <path-to-brief.md-or-epic-description> [--fast] [--model <agent>=<m>]
allowed-tools: Agent, Task, Read, Write, Glob, Grep, LSP, Skill, Bash(cat:*)
---

Input: `$ARGUMENTS` minus flags.
**Models:** `--model` or `**Agent models:**` in `CLAUDE.md` → `cat ${CLAUDE_PLUGIN_ROOT}/reference/models.md`.
**Consent:** `cat ${CLAUDE_PLUGIN_ROOT}/reference/consent.md` first.

**Delegate — you write no stories.**

---

## FAST LANE

`--fast` replaces everything below: one planner call, a ~40-line task list, no architect pass unless a one-way door is tagged.

```bash
cat ${CLAUDE_PLUGIN_ROOT}/reference/fast-mode.md
```

---

## STEP 1 — Decompose

`cat ${CLAUDE_PLUGIN_ROOT}/reference/plan-artifacts.md` and `reference/epic-budget.md`, then `claim EPIC` per
epic — the planner never picks a number.

```
Agent(subagent_type: "agentic-sdlc:planner", prompt: "Decompose this into epics and stories with
acceptance criteria. Raise ARCH-<n> handoffs for architecture or tooling
decisions — do NOT decide them. Overwrite <claimed path>.")
```

Over the cap: planner returns later parts' outline (SPLIT in epic-budget.md); claim one EPIC per part, Part 1 in full, later parts stubs. Several epics: parallel.

---

## STEP 2 — Resolve handoffs

Each `OPEN` `ARCH-<n>`:

```
Agent(subagent_type: "agentic-sdlc:architect", prompt: "Resolve ARCH-<n>. Read the codebase first;
consistency beats cleverness. WebFetch version-dependent facts. DECIDE. ADR only for one-way doors; else resolve inline in the epic file. Shortcuts go under ## Debt there.")
```

Batch related handoffs into one call.

---

## STEP 3 — Review (non-blocking)

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-artifacts.mjs check EPIC-<n>` on each epic. Fail → one re-split with the error text; again → report "still over", stop.
Add `- Artifacts:` (new ADRs, brief). Record the lane (Part 1 only):
`node ${CLAUDE_PLUGIN_ROOT}/scripts/mode-select.mjs record --file <claimed path> --chosen deliberate`.
Show:
- Epics, stories
- Architecture decisions and reasoning
- Any ADR, new tooling debt

**Skim it, correct anything wrong.** Silence lets `/build` proceed.

---

## REPORT

Rows in build order.

| Epic | Stories | Points | Depends on | ARCH | Status |
|--|--|--|--|--|--|

Then `/build EPIC-<n>`
