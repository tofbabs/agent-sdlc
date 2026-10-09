---
description: Plan a feature — stories from the planner, architecture decisions from the architect. Non-blocking. `--fast` takes the lean lane: a flat task list, no handoffs.
argument-hint: <path-to-brief.md-or-epic-description> [--fast] [--model <agent>=<m>]
allowed-tools: Agent, Task, Read, Write, Glob, Grep, LSP, Skill, Bash(cat:*)
---

Input: `$ARGUMENTS` minus flags.
**Models:** `--model` or `**Agent models:**` in `CLAUDE.md` → `cat ${CLAUDE_PLUGIN_ROOT}/reference/models.md` first.
**Consent:** `cat ${CLAUDE_PLUGIN_ROOT}/reference/consent.md` first.

Build a backlog. **Delegate — you write no stories.**

---

## FAST LANE

`--fast` in the arguments replaces everything below: one planner invocation, a
~40-line task list, and no architect pass unless a one-way door was tagged.

```bash
cat ${CLAUDE_PLUGIN_ROOT}/reference/fast-mode.md
```

**Read it before STEP 1** — that file is the protocol, this is not.

---

## STEP 1 — Decompose

`cat ${CLAUDE_PLUGIN_ROOT}/reference/plan-artifacts.md`, then `claim EPIC` once
per epic — never let the planner pick a number.

```
Agent(subagent_type: "agentic-sdlc:planner", prompt: "Decompose this into epics and stories with
acceptance criteria. Raise ARCH-<n> handoffs for genuine architecture or tooling
decisions — do NOT decide those yourself. Overwrite <claimed path>.")
```

Several epics in the brief → run them in parallel.

---

## STEP 2 — Resolve handoffs

For every `ARCH-<n>` with status `OPEN`:

```
Agent(subagent_type: "agentic-sdlc:architect", prompt: "Resolve ARCH-<n>. Read the codebase first
— consistency with what exists beats cleverness. WebFetch for anything version- or
maturity-dependent. DECIDE. Write an ADR only for genuine one-way doors; otherwise
resolve inline in the epic file. Shortcuts go under ## Debt in the epic file.")
```

Batch related handoffs into one architect invocation.

---

## STEP 3 — Review (non-blocking)

Add the `- Artifacts:` line (new ADRs, uncommitted brief). Record the lane:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/mode-select.mjs record --file <claimed path> --chosen deliberate`.
Present:
- Epics and story count
- Architecture decisions made, and the reasoning
- Any ADR written
- New tooling debt logged

**Skim it. Correct anything wrong.** But this doesn't block — if you say nothing,
`/build` proceeds.

---

## REPORT

| Epic | Stories | ARCH handoffs | Status |
|------|---------|---------------|--------|

Then: `/build EPIC-<n>`
