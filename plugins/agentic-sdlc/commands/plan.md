---
description: Plan a feature — stories from the planner, architecture decisions from the architect. Non-blocking.
argument-hint: <path-to-brief.md-or-epic-description>
allowed-tools: Agent, Task, Read, Write, Glob, Grep, Skill
---

Input: $1

Build a backlog. **Delegate — you write no stories yourself.**

---

## STEP 1 — Decompose

```
Agent(subagent_type: "agentic-sdlc:planner", prompt: "Decompose this into epics and stories with
acceptance criteria. Raise ARCH-<n> handoffs for anything that is genuinely an
architecture or tooling decision — do NOT decide those yourself. Write
backlog/EPIC-<n>.md.")
```

Run in parallel across epics if the brief covers several. Planner is on Sonnet 5 —
the cost floor — so this is cheap: go wide.

---

## STEP 2 — Resolve handoffs

For every `ARCH-<n>` with status `OPEN`:

```
Agent(subagent_type: "agentic-sdlc:architect", prompt: "Resolve ARCH-<n>. Read the codebase first
— consistency with what exists beats cleverness. WebFetch for anything version- or
maturity-dependent. DECIDE. Write an ADR only for genuine one-way doors; otherwise
resolve inline in the epic file. Log any deliberate shortcut to docs/TOOLING-DEBT.md.")
```

Batch these — one architect invocation can handle several related handoffs and
saves the context reload.

**The architect decides.** It does not produce an options paper for you to
adjudicate. Bias is toward moving.

---

## STEP 3 — Review (non-blocking)

Present:
- Epics and story count
- Architecture decisions made, and the reasoning
- Any ADR written
- New tooling debt logged

**Skim it. Correct anything wrong.** But this doesn't block — if you say nothing,
`/build` proceeds.

*Worth actually reading though: this remains the cheapest place to catch a
misunderstanding. A wrong story here becomes a wrong branch and a wrong PR later.*

---

## REPORT

| Epic | Stories | ARCH handoffs | Status |
|------|---------|---------------|--------|

Then: `/build EPIC-<n>`
