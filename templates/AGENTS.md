# Project Guidelines (Agent Contract)

This document establishes the project-specific contract for autonomous agents (Gemini / Antigravity / Claude Code).

---

## 1. Pipeline Contract

> **Integration branch:** `main`
> **Always run before opening a PR:** `npm test && npm run lint`

*(Replace the check command above with the actual verification commands for your project: tests, linter, typecheck, build).*

---

## 2. Project Architecture & Conventions

- **Module Structure**: Describe key directories and bounded contexts.
- **Language / Framework**: Primary toolchain, runtime, and version.
- **Accepted ADRs**: Stored in `docs/adr/`. All agents must follow `ACCEPTED` decisions.

---

## 3. Deliberate Shortcuts & Tooling Debt

- When skipping robust implementations for velocity, always record the gap in `docs/TOOLING-DEBT.md`.
- Never leave undocumented shortcuts in production code.

---

## 4. Hard Constraints

- **Never merge your own PR.** The human is the sole blocking merge gate.
- **Never push with `--force`** or execute destructive resets.
- **Never read `.env` or credential files.**
