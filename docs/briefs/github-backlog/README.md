# GitHub Issues as a backlog store

Let a project keep its briefs, epics and stories in GitHub Issues instead of
`docs/briefs/` and `backlog/`. The project picks per command, or once in its
config. The repo stays the default.

```
01 store interface (repo only)  ──►  02 github adapter
   refactor, no behaviour change        brief/plan/stories in Issues
```

## The shape in GitHub

```
brief (umbrella, hand-written)
├── epic ──► one PR, which links and closes ONLY this epic's stories
│   ├── story ◄── PR + squash commit SHA recorded on it
│   └── story
├── epic
│   └── story
└── FAST (task list in body)
```

Closing rolls up: the last story closes its epic, and the last child closes the
brief. Every node links up and down, so any story, PR or commit traces to the
brief that asked for it.

## Implementation order

| # | Brief | Depends on | Lane | Ships to |
|---|-------|-----------|------|----------|
| 1 | [Store interface](01-store-interface.md) | — | deliberate (settings-location ADR) | `plugins/` → `feat:` |
| 2 | [GitHub adapter](02-github-adapter.md) | 1 merged | deliberate | `plugins/` → `feat:` |

## Why two, and not one or five

Each brief becomes one epic, which becomes one PR. Each PR costs CI on open, on
every REVISE push, on merge and on the release PR that follows. Stories inside
an epic share one branch and add nothing. So the cut is at seams that each have
value on their own:

- **01** is a pure refactor, proven by the existing tests passing unchanged.
  It is worth having even if 02 never ships.
- **02** is all of github mode, read and write together, plus the optional
  one-way `migrate` of existing `.md` files into Issues. Migration reuses the
  adapter's write ops, so a brief of its own would buy an extra PR and almost
  no isolation. Read-only github mode
  would be a release nobody can use, and it would pay for an extra PR to get
  there.

## Commands

```
/agentic-sdlc:plan docs/briefs/github-backlog/01-store-interface.md
# after 01 merges:
/agentic-sdlc:plan docs/briefs/github-backlog/02-github-adapter.md
```
