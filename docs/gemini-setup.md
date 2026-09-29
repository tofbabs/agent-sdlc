# Gemini & Antigravity Setup Guide

This guide describes how to configure and run the **Agentic SDLC** protocol with Google Gemini and Google Antigravity agents, delivering the identical planner → architect → coder(+navigator) → code-reviewer pipeline and value guarantees as the Claude Code plugin.

---

## 1. Quick Install & Discovery

The pipeline is distributed as a native Antigravity plugin within this repository at `plugins/agentic-sdlc`.

### Option A: Declarative Workspace Registration (Recommended for Teams)

In your consuming repository, create `.agents/plugins.json`:

```json
{
  "entries": [
    {
      "path": "vendor/agent-sdlc/plugins/agentic-sdlc"
    }
  ]
}
```

*(Where `vendor/agent-sdlc` is a checked-in git submodule or vendored clone pinned to a specific release tag, e.g., `v0.2.1`).*

### Option B: Machine-Wide Global Registration

To make the SDLC protocol available across all local workspaces, add the repository path to `~/.gemini/config/plugins.json`:

```json
{
  "entries": [
    {
      "path": "/path/to/agent-sdlc/plugins/agentic-sdlc"
    }
  ]
}
```

Once registered, Antigravity automatically loads:
- **Rules**: `rules/AGENTS.md` (active in the workspace).
- **Skills**: `agentic-sdlc-plan`, `agentic-sdlc-build`, `agentic-sdlc-review`.

---

## 2. Consuming Project Contract

Antigravity agents look for the project contract in `AGENTS.md`, `GEMINI.md`, or `CLAUDE.md`. Copy the baseline templates into your repo on initial setup:

```bash
cp <agent-sdlc-path>/templates/AGENTS.md              <project>/AGENTS.md
cp <agent-sdlc-path>/templates/TOOLING-DEBT.md        <project>/docs/
cp <agent-sdlc-path>/templates/backlog/EPIC-template.md <project>/backlog/
cp <agent-sdlc-path>/templates/backlog/FAST-template.md <project>/backlog/
cp <agent-sdlc-path>/templates/brief.md               <project>/docs/templates/
cp <agent-sdlc-path>/templates/ADR.md                 <project>/docs/templates/
```

### The Two Literal Contract Lines

Ensure your `AGENTS.md` (or `GEMINI.md`) defines the integration branch and the verification command:

> **Integration branch:** `main`  
> **Always run before opening a PR:** `npm test && npm run lint`

- If `**Integration branch:**` is omitted, the pipeline defaults to `main`.
- `**Always run before opening a PR:**` specifies the exact command the coder and reviewer run to verify builds.

---

## 3. Running the Pipeline

Execute the three primary workflow commands directly in chat or via slash commands:

### A. Plan a Feature
```bash
/agentic-sdlc:plan docs/briefs/payments.md
```
- **Planner** (Gemini Flash) decomposes the brief into epics and stories with 2–5 acceptance criteria.
- Open `ARCH-<n>` handoffs are automatically dispatched to the **Architect** (Gemini Pro with thinking mode) to decide two-way doors inline or write `docs/adr/` for one-way doors.
- Or pass `--fast` for the lean lane: a flat ~40-line task list (`backlog/FAST-<n>.md`).

### B. Build an Epic
```bash
/agentic-sdlc:build EPIC-1
```
- Creates the integration worktree on `feat/EPIC-1`.
- Topologically executes waves of stories:
  - **SOLO** (small stories): Built by Coder (Gemini Flash) end-to-end.
  - **PAIR** (M/L or novel stories): Ping-pong TDD alternating **Navigator** (Gemini Pro, writes failing test) and **Coder** (Gemini Flash, writes minimal passing code). Communicated via `plugins/agentic-sdlc/scripts/pair-log.mjs`.
- Each story lands onto `feat/EPIC-1` as **one squash commit** with scoped conventional headers for `release-please`.
- Merges latest integration branch, re-runs full project gate, and opens **one pull request**.

### C. Review a Pull Request
```bash
/agentic-sdlc:review 42
```
- Spawns the **Code-Reviewer** (Gemini Pro) in an isolated, throwaway worktree (`../wt-review-42`).
- Checks acceptance criteria, ADR compliance, negative tests on risk surfaces (auth, money, data loss, contracts), and undocumented shortcuts.
- Posts one structured `## Review — round <k>` review comment with stable finding IDs (`F1..Fn`).
- If `REQUEST_CHANGES`, the coder's `REVISE` mode addresses findings by ID.
- If `APPROVE`, signals: *"Ready for human merge"*. **The human is the sole blocking gate.**

---

## 4. Gemini Model Tiering

The SDLC protocol enforces cost and turn discipline through asymmetric model selection:

| SDLC Role | Recommended Gemini Model | Function & Rationale |
|---|---|---|
| **`planner`** | **Gemini Flash** (`flash`) | Fast decomposition of briefs into vertical slices. Pattern matching against the brief; cost floor. |
| **`architect`** | **Gemini Pro** (`pro` + thinking) | Highest judgment density, few turns. Resolves one-way vs two-way doors, stack choices, and ADRs. |
| **`coder` (Driver)** | **Gemini Flash** (`flash`) | Dominates 70–80% of total turns. Executes tools rapidly and implements minimal passing code. |
| **`coder` (Escalation)** | **Gemini Pro** (`pro`) | For twice-bounced stories, tricky concurrency, or novel algorithms. |
| **`navigator`** | **Gemini Pro** (`pro`) | High-judgment TDD steering. Writes clean failing tests and prevents the driver from gaming the test suite. |
| **`code-reviewer`** | **Gemini Pro** (`pro`) | Thorough PR review across full diffs and surrounding context. Stable finding synthesis (`F1..Fn`). |

---

## 5. Token Economics & Freshness Invariant

Even though Gemini models support large context windows (1M–2M tokens), long multi-turn sessions degrade reasoning and incur unnecessary costs.

`agent-sdlc` enforces:
1. **Fresh Spawns per Turn in PAIR Mode**: The navigator and coder are re-spawned fresh on each alternation. The pair log (`scripts/pair-log.mjs`) is the only memory carried over.
2. **Strict Budget Caps**: Turn entries are capped at 10 lines, and the overall story is capped at 20 alternations.
3. **Linear Cost**: Holds turn costs linear $O(n)$ instead of quadratic $O(n^2)$.

---

## 6. Coexistence with Claude Code

The repository architecture is engine-agnostic:
- Both Claude Code and Google Gemini/Antigravity share the identical `reference/` protocols, `pair-log.mjs` script, backlog files, and `docs/TOOLING-DEBT.md`.
- Teams can plan with Gemini, build with Claude, review with Gemini, or vice versa on the same repository without friction.
