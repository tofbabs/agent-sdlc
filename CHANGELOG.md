# Changelog

Each entry says what a consuming project must do. Usually nothing.

## [0.2.1](https://github.com/tofbabs/agent-sdlc/compare/v0.2.0...v0.2.1) (2026-09-17)


### Features

* **agentic-sdlc:** land every story as one squash commit on the epic branch; configurable base branch ([5083d69](https://github.com/tofbabs/agent-sdlc/commit/5083d69f59ca19e9991f2bf5856060ee03751599))
* **agentic-sdlc:** land every story as one squash commit on the epic branch; configurable base branch ([bd4c9d4](https://github.com/tofbabs/agent-sdlc/commit/bd4c9d4489b9dc36864f41f49a6770fc695f18e3))

## [0.2.0](https://github.com/tofbabs/agent-sdlc/compare/v0.1.7...v0.2.0) (2026-09-11)


### ⚠ BREAKING CHANGES

* the marketplace namespace is renamed from kodobe-sdlc to sanimara. Consuming projects must update .claude/settings.json -- the extraKnownMarketplaces key (kodobe-sdlc -> sanimara) and the enabledPlugins key (agentic-sdlc@kodobe-sdlc -> agentic-sdlc@sanimara) -- and re-install. The plugin name and version pins are unchanged.

### Features

* relicense MIT and rebrand kodobe-sdlc -&gt; sanimara ([6638259](https://github.com/tofbabs/agent-sdlc/commit/663825946977e0391bdda58e9aabda06917ab9ab))

## [0.1.7](https://github.com/tofbabs/agent-sdlc/compare/v0.1.6...v0.1.7) (2026-09-11)


### Documentation

* add LSP preflight SessionStart hook template ([39d1fa9](https://github.com/tofbabs/agent-sdlc/commit/39d1fa91e694f3da009e20d24ed9d9a8d21ba0a5))

## [0.1.6](https://github.com/tofbabs/agent-sdlc/compare/v0.1.5...v0.1.6) (2026-09-11)


### Documentation

* reframe README around audience, quality ladder, token gains and roadmap ([2d861a2](https://github.com/tofbabs/agent-sdlc/commit/2d861a20a25c11d546887e6bf16984cf2157de86))
* rewrite and restructure README into focused docs + add CONTRIBUTING ([50384bf](https://github.com/tofbabs/agent-sdlc/commit/50384bf7d5888f96a1a5d912fed97f1278f88934))
* split README into focused docs and add CONTRIBUTING ([c17e84d](https://github.com/tofbabs/agent-sdlc/commit/c17e84d277265733a59b834f4b66f92f4d0edbb6))

## [0.1.5](https://github.com/tofbabs/agent-sdlc/compare/v0.1.4...v0.1.5) (2026-09-11)


### Features

* **agentic-sdlc:** add code-reviewer agent and /review command ([e843852](https://github.com/tofbabs/agent-sdlc/commit/e8438524b66fce968b5d4d016960de28962de08a))
* **agentic-sdlc:** add code-reviewer agent and /review command ([994cd9d](https://github.com/tofbabs/agent-sdlc/commit/994cd9d8537a3f0eba3e591d35e03f0bb10599f5))
* **agentic-sdlc:** add the --fast lean lane, gated by a negative-test floor ([f6c0e6e](https://github.com/tofbabs/agent-sdlc/commit/f6c0e6ea1ff18f33faf93d3adfa4adeb849c1d66))
* **agentic-sdlc:** add the --fast lean lane, gated by a negative-test floor ([a6bab4b](https://github.com/tofbabs/agent-sdlc/commit/a6bab4bb01d9f65ec045b0a396f06969e632f558))
* **agentic-sdlc:** make agents navigate code with LSP, not grep ([9250024](https://github.com/tofbabs/agent-sdlc/commit/925002485ca133ff42036946265a91e40a4727e4))
* **agentic-sdlc:** make agents navigate code with LSP, not grep ([7f31742](https://github.com/tofbabs/agent-sdlc/commit/7f317420c116bfd3b9b6df049f3d1f4542a5bcb6))

## [0.1.4](https://github.com/kodobe/agent-sdlc/compare/v0.1.3...v0.1.4) (2026-08-24)


### Features

* **agentic-sdlc:** load PAIR and REVISE protocols on demand, bound the epic file ([4214d92](https://github.com/kodobe/agent-sdlc/commit/4214d92d6a7ee343c0f80d5967ee55dd2648cff4))
* **agentic-sdlc:** load PAIR and REVISE protocols on demand, bound the epic file ([8b81d5a](https://github.com/kodobe/agent-sdlc/commit/8b81d5a015223de1962732debffcea8e807dcc7f))

## [0.1.3](https://github.com/kodobe/agent-sdlc/compare/v0.1.2...v0.1.3) (2026-07-31)


### Features

* **build:** enforce pair-log carryover limits in code, not prose ([aa05bb8](https://github.com/kodobe/agent-sdlc/commit/aa05bb8cfc993dbf4f800d5ff416fbd86567e573))
* **build:** enforce pair-log carryover limits in code, not prose ([f9c5d46](https://github.com/kodobe/agent-sdlc/commit/f9c5d46e3c23db02fe9f1bf6c159163905fb7fb7))


### Bug Fixes

* **build:** stop pair stories costing O(alternations squared) ([27aed0a](https://github.com/kodobe/agent-sdlc/commit/27aed0a4195e77ee94b0e8883a3360fe694de028))
* **build:** stop pair stories costing O(alternations squared) ([445503d](https://github.com/kodobe/agent-sdlc/commit/445503d593b061785fd82b86e164a6fa9161beb8))


### Documentation

* **build:** design for cutting pair-log carryover cost ([827f020](https://github.com/kodobe/agent-sdlc/commit/827f020509ce7d2dd44aa504b45ea5b51aa69afa))

## [0.1.2](https://github.com/kodobe/agent-sdlc/compare/v0.1.1...v0.1.2) (2026-07-29)


### Features

* **agents:** add navigator agent and TDD pairing mode ([3e5405f](https://github.com/kodobe/agent-sdlc/commit/3e5405f859af31645e3e79e2e7671ff5fb1dc612))
* **agents:** add navigator agent and TDD pairing mode ([660bbe2](https://github.com/kodobe/agent-sdlc/commit/660bbe278fe0f65829a6a01e170f433623c062b2))


### Bug Fixes

* resolve plugin-namespaced agent names from /plan and /build ([d2e0980](https://github.com/kodobe/agent-sdlc/commit/d2e0980fde58428043872781c16ee97d8cf501a4))
* resolve plugin-namespaced agent names from /plan and /build ([243e36c](https://github.com/kodobe/agent-sdlc/commit/243e36cd9ccb924a0e031dd648e9d92b5b0e19fe))

## 0.1.1 — 2026-07-29

**Supersedes 0.1.0. Do not pin 0.1.0** — it shipped a stale `/build` and a README
pointing at a repository that does not exist. It is left on the remote rather than
retagged, because rewriting a published tag is the failure this repo exists to
prevent.

**Fixed**

- `commands/build.md` re-synced from `reward-fulfillment-app` (88 → 192 lines).
  0.1.0 was cut against a copy taken minutes before the source gained the
  epic-branch cascade: waves off `feat/EPIC-<n>`, sub-worktrees merged back
  `--no-ff`, the `#77` add/add analysis, and the rule that the epic PR is
  merge-committed rather than squashed so release-please still sees per-package
  scopes. Pinning 0.1.0 would have handed a project the pre-cascade `/build`.
- README install snippets point at `kodobe/agent-sdlc`, the actual repository.

**Noted, not fixed** — see the 0.1.0 known-issues list below, which still applies.
It gained one entry: `agents/coder.md` and `commands/build.md` now disagree about
whether the coder opens a PR.

> The gap between 0.1.0 and 0.1.1 is roughly forty minutes, and drift caused it.
> That is the argument for this repo, made faster than expected.

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

- `agents/coder.md` still describes the pre-cascade flow: branch from `main` with
  `git checkout -b feat/<STORY-ID>`, then `gh pr create` and report the PR number.
  `commands/build.md` now branches stories off the **epic** branch and instructs
  the coder to "Commit; do NOT open a PR". The command's prompt overrides at
  runtime so `/build` behaves correctly, but the agent file misleads anyone
  invoking `coder` directly, and the two files shipped together disagree.
  **Reconcile in 0.2.0** — the agent should describe committing to the branch it
  was given, and leave PR policy to the command.
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
