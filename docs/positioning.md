# Positioning — where this sits among other SDLC tools

Back to the [README](../README.md).

The AI-coding landscape splits roughly three ways, and this plugin is deliberately
in the third:

- **Inline assistants** — Copilot, Cursor's autocomplete, Cody. They complete the
  line and answer questions in the editor. Fast, local, and stateless about your
  process: they have no opinion about *how* a feature gets planned, tested and
  reviewed.
- **Autonomous single agents** — Devin, Cursor Composer/Agent, Aider, OpenAI
  Codex, and plain Claude Code used ad hoc. You hand one agent a task and it works
  the whole thing. Powerful, but the *process* is implicit and unversioned:
  quality depends on the prompt you happened to write that day, and two repos
  running "the same" agent are running whatever each person typed.
- **Opinionated, versioned pipelines** — where this lives. The unit of reuse is
  not a completion or a single agent but a **multi-agent protocol** with roles
  (planner, architect, coder, navigator, reviewer), explicit handoffs, a debt
  ledger, model tiering, and a human merge gate — shipped as a plugin and **pinned
  by tag** so every consuming repo runs a known version.

The nearest cousins to the *idea* are spec-driven kits like GitHub's **spec-kit**
(spec → plan → tasks) and role/skill libraries like **superpowers**. The
differences that matter:

- **Spec-kit** structures the artifacts; it does not tier models, split solo/pair,
  carry a tooling-debt ledger, or ship a review agent with a fast-floor. This is
  the *execution* pipeline around such a spec, with cost as a first-class concern.
- **superpowers** sits **underneath** this pipeline, not in front of it — see
  below. It supplies skills; this supplies the workflow that decides when a skill
  is worth reaching for.

What distinguishes this plugin specifically: **versioning as the anti-drift
mechanism** (pin a tag, bump with a one-line diff, changelog derived from commit
type), a **two-lane quality dial** with the same commands, **an explicit debt
ledger at every rung**, and **token cost treated as a design constraint** rather
than an afterthought.

---

## Relationship to superpowers

Superpowers sits **underneath this pipeline, not in front of it.** `/plan` and
`/build` are the entry points for product work — running the brainstorm →
write-plan → execute-plan loop as well produces a backlog *and* a plan file that
disagree about which is real.

Each agent has the `Skill` tool and a short section naming the superpowers skills
that fit its role. **When to reach for one is the agent's judgment**, not a gate.
Skipping one is a shortcut like any other, and the ledger rule applies.
