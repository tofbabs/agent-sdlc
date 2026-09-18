---
name: agentic-sdlc-plan
description: Plan a feature using the Agentic SDLC protocol. Decomposes a brief into epics, stories with acceptance criteria, and ARCH handoffs, or under --fast into a flat task list. Resolves handoffs with the architect.
---

# Agentic SDLC: Plan (`/agentic-sdlc:plan`)

Use this skill to plan any product feature or architectural initiative from a brief.

## Invocation & Arguments

```bash
/agentic-sdlc:plan <path-to-brief.md-or-description> [--fast]
```

- **Input**: The path to a brief (e.g., `docs/briefs/feature.md`) or a concise description string.
- **`--fast` Flag**: Enables the lean lane (flat task list, decide-and-log debt, no blocking handoffs).

---

## Workflow Steps

### Step 1: Check Lane & Read Protocols

- If `--fast` is passed:
  Read `plugins/agentic-sdlc/reference/fast-mode.md` before proceeding.
  The fast lane generates `backlog/FAST-<n>.md` (~40 lines, `## Tasks` by line 10, one `done when` per task).

### Step 2: Decompose (Planner)

Spawn the **planner** subagent using `invoke_subagent` (or execute the planner persona):
- **Model**: `flash` (Gemini Flash — cost floor, high speed).
- **Role**: `Planner`.
- **System Instructions**: Use `plugins/agentic-sdlc/agents/planner.md`.
- **Task Prompt**:
  > "Decompose the feature in <brief> into epics and vertically sliced stories with 2–5 falsifiable acceptance criteria each. Raise ARCH-<n> handoffs for anything requiring tooling, schema, external vendors, or cross-cutting architectural choices—do NOT decide those yourself. Write backlog/EPIC-<n>.md (or backlog/FAST-<n>.md if in FAST mode)."

### Step 3: Resolve Handoffs (Architect)

*(Skipped in `--fast` mode unless a one-way door touches auth, money, data loss, or external contracts).*

Scan the generated `backlog/EPIC-<n>.md` for `ARCH-<n>` entries with `status: OPEN`.
For each open handoff (batched together to conserve context):
- **Model**: `pro` (Gemini Pro — high judgment, deep reasoning/thinking).
- **Role**: `Architect`.
- **System Instructions**: Use `plugins/agentic-sdlc/agents/architect.md`.
- **Task Prompt**:
  > "Resolve the open ARCH handoffs in backlog/EPIC-<n>.md. Inspect the surrounding codebase using LSP/definition search. Decide: if a TWO-WAY door, resolve inline in the epic markdown. If a ONE-WAY door, write docs/adr/<NNNN>-<slug>.md. Log any deliberate shortcut to docs/TOOLING-DEBT.md. Never defer; make the decision."

### Step 4: Non-Blocking Review & Reporting

Present a clean markdown summary to the user:
- Epics and story counts.
- Architectural decisions resolved (two-way inline vs ADRs).
- New tooling debt logged to `docs/TOOLING-DEBT.md`.

Output the next action:
```
Next step: Run `/agentic-sdlc:build EPIC-<n>` (or `/agentic-sdlc:build FAST-<n> --fast`)
```
