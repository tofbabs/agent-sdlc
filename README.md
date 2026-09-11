# agentic-sdlc

[![validate](https://github.com/tofbabs/agent-sdlc/actions/workflows/validate.yml/badge.svg)](https://github.com/tofbabs/agent-sdlc/actions/workflows/validate.yml)
[![Release](https://github.com/tofbabs/agent-sdlc/actions/workflows/release-please.yml/badge.svg)](https://github.com/tofbabs/agent-sdlc/actions/workflows/release-please.yml)

A versioned, reusable **planner → architect → coder → reviewer** pipeline for
Claude Code, distributed as a plugin so many projects can pull the same protocol
in at a pinned version and move forward deliberately instead of drifting.

It is stack- and language-agnostic: the protocol lives in the plugin, and
everything a specific project learned about itself stays in that project.

## Who this is for

You are probably here because you have hit one of these:

- **Agents that sprawl.** A one-line brief comes back as a plausible, confident,
  *wrong* backlog — ten epics where you wanted two, a stack nobody chose,
  decisions buried in code that should have been decisions on paper.
- **Copy-paste protocol rot.** You wrote a good `.claude/agents` setup once, then
  copied it into three more repos. Now they have all drifted and nobody can say
  what changed or why.
- **No dial between "quick" and "careful".** A throwaway spike and a payments
  migration get the same ceremony, so you either over-engineer prototypes or
  under-engineer the things that hold real data.
- **Silent, unaccounted shortcuts.** The corners you cut to ship live in people's
  heads, not on paper, so the debt is invisible until it bites.
- **Token bills that scale with ceremony, not value.** Long-lived agents re-send
  their whole context on every internal round trip; agents `grep` their way
  around a codebase and drown in noise.

If a team ships product with Claude Code across more than one repository and wants
the *how* to be reviewable, pinned, and shared rather than folklore, this is the
shape of the answer.

## What it does, in three commands

```
/agentic-sdlc:plan <brief>     planner → epics, stories, ARCH handoffs
                               architect → resolves the handoffs, decides
                               you skim (non-blocking)

/agentic-sdlc:build EPIC-<n>   per story, SOLO or PAIR:
                                 SOLO  coder builds the story end to end
                                 PAIR  navigator ⇄ coder ping-pong TDD, one increment a turn
                               both cascade onto one feat/EPIC-<n> branch
                               architect → unblocks mid-build
                               ends at "one PR is open"

/agentic-sdlc:review <PR-n>    code-reviewer reads the PR head in its own worktree
                               posts `## Review — round <k>` + a verdict
                               REQUEST_CHANGES → /build's REVISE loop closes it
                               APPROVE → the human merges
```

Or the lean lane, on the same commands:

```
/agentic-sdlc:plan <brief> --fast    planner → a ~40-line task list, one `done when` each
                                     no ARCH handoffs — one-way doors tagged, not blocked

/agentic-sdlc:build FAST-<n> --fast  SOLO throughout, one branch, no worktrees
                                     tests: the check, plus the negative case on any
                                     auth/money/destructive-data/contract surface
                                     gate once, one PR, every shortcut in the ledger
```

**The one blocking gate is the human.** Nothing here merges its own PR.

## The quality dial

Everything sits on one axis: **how much rigor you spend per unit of work.** You
pick the rung — the rung decides how many agents run, how many tests are required,
and whether decisions get written to paper. The one thing that never changes with
the rung is that **the corners you cut are always recorded** in
`docs/TOOLING-DEBT.md`. That is the difference between a shortcut and drift.

From least to most rigor: **`--fast` SOLO** → **deliberate SOLO** →
**deliberate PAIR** (ping-pong TDD) → **reviewed** (the code-reviewer gate, which
sits on top of any of the three). Pick the lowest rung you would be comfortable
defending if the code outlived its intended life; persisted data, contracts,
money, auth and PII always climb.

The full ladder, the two-lane table, and how LSP-first navigation and `--fast`
buy back tokens and output quality are in **[docs/concepts.md](docs/concepts.md)**.

## Quick install

```bash
claude plugin marketplace add tofbabs/agent-sdlc@v0.1.1
claude plugin install agentic-sdlc@sanimara
```

Better, pin it declaratively in the consuming project's `.claude/settings.json`
so the version is checked in and reviewable — see
**[docs/setup.md](docs/setup.md)** for the declarative form, the paths a project
must provide, and the one-per-machine LSP requirement.

## Documentation

| Doc | What's in it |
|---|---|
| **[docs/concepts.md](docs/concepts.md)** | The quality ladder, the two lanes, and the token-utility / output-quality story behind LSP-first navigation and `--fast` |
| **[docs/setup.md](docs/setup.md)** | Install (declarative pin), the contract a consuming project must satisfy, what stays in the project, and the cloud routines |
| **[docs/positioning.md](docs/positioning.md)** | Where this sits among other SDLC tools, and its relationship to superpowers |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | How to propose changes, the release process, anti-drift rules, the repository layout, and the roadmap |

## License

Released under the [MIT License](LICENSE) — Copyright (c) 2026 Sanimara.
