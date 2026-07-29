# Changelog

Each entry says what a consuming project must do. Usually nothing.

## 0.1.0 — 2026-07-29

Initial extraction from `reward-fulfillment-app/.claude/`, **verbatim**. The
agents and commands are byte-identical to what MyJara was running, so upgrading
MyJara to this release is a plumbing change with no behavioural change. That is
the point of the release: prove distribution works before changing meaning.

**Added**

- `agentic-sdlc` plugin: `planner`, `architect`, `coder` agents; `/plan` and
  `/build` commands.
- `templates/` — tooling-debt ledger, epic template, the two cloud-routine
  prompts, and a permissions baseline covering the three deny categories that are
  wrong in every project.

**Consuming projects must**

- Add `extraKnownMarketplaces` + `enabledPlugins` to `.claude/settings.json`
  (see README).
- **Delete local `.claude/agents`, `.claude/commands` and any symlinks to them.**
  A local copy is where drift starts.
- Keep their own `permissions.deny` — plugins do not contribute permissions.

**Known issues, deliberately carried forward**

- `commands/plan.md` step 1 says "Planner is on 4.7". The `planner` agent is on
  Sonnet 5 and 4.7 is not in the current model range. It is a stale comment with
  no runtime effect — the agent's own frontmatter is what selects the model — but
  it contradicts the agent file shipped beside it. Left as-is to keep 0.1.0 a
  faithful copy. **Fix in 0.2.0.**
- Roughly twenty hard-coded project paths (`backlog/`, `docs/adr/`,
  `docs/TOOLING-DEBT.md`) and one hard-coded check command
  (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, `agents/coder.md`)
  are baked into the prompts. They are sensible defaults and match MyJara exactly;
  the `pnpm` line is the only one that would be actively wrong elsewhere.
  **Generalise in 0.2.0**, before onboarding a second project.
