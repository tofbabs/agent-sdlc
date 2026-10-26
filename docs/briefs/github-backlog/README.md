# GitHub Issues as a backlog store

Let a project keep each brief and its plan in **one GitHub Issue** instead of
`docs/briefs/` and `backlog/`. The project picks per command with
`--store repo|github`, or once in `.claude/agentic-sdlc.json`
(`backlog.store`, ADR-0006). The store resolves as **flag > project config >
`repo`**. The repo stays the default, and repo mode does not change.

```
01 store interface (repo only)  ──►  02 github store + /write-brief
   refactor, no behaviour change        brief and plan in the same Issue
```

## The shape in GitHub

```
Issue #n  (label: brief)                        ◄── the EPIC-n / FAST-n PR says Closes #n
├── body     four-line header + the brief         written once by /write-brief, then human-owned
└── comment  <!-- agentic-sdlc:plan EPIC-n -->    written by /plan, edited in place by /build
             the same markdown as backlog/EPIC-n.md: stories, ARCH table,
             status, each story's landing commit and PR
```

One brief is one Issue, and its plan id is the Issue number (`EPIC-<n>` or
`FAST-<n>`). That is the rule the wave already uses. There is no epic Issue and
no story sub-issue. A plan's stories stay sections of the plan, exactly as they
are in `backlog/EPIC-<n>.md` today. An epic that SPLITs into parts gets one more
Issue for each later part (see 02).

## How a brief gets there

`/agentic-sdlc:write-brief <slug> [--store repo|github]` drafts the brief from
`templates/brief.md` with the user:

- `--store repo` (the default) writes `docs/briefs/<slug>.md`, as people do by
  hand today.
- `--store github` creates the brief Issue directly, labelled `brief`. No file
  is written to the repo.

Then `/agentic-sdlc:plan <issue#>` writes the plan into that same Issue.

## Implementation order

| # | Brief | Depends on | Lane | Ships to |
|---|-------|-----------|------|----------|
| 1 | [Store interface](01-store-interface.md) | — | deliberate | `plugins/` → `feat:` |
| 2 | [GitHub store and `/write-brief`](02-github-adapter.md) | 1 merged | deliberate | `plugins/` → `feat:` |

ADR-0006 already settled where the setting lives (`backlog.store` in
`.claude/agentic-sdlc.json`), so 01 no longer needs a settings ADR of its own.

## Why two, and not one or five

Each brief becomes one epic, which becomes one PR. Each PR costs CI on open, on
every REVISE push, on merge and on the release PR that follows. Stories inside
an epic share one branch and add nothing. So the cut is at seams that each have
value on their own:

- **01** is a pure refactor, proven by the existing tests passing unchanged.
  It is worth having even if 02 never ships.
- **02** is all of github mode, read and write together, plus `/write-brief`
  and the optional one-way `migrate` of open briefs into Issues. Migration and
  `/write-brief` reuse the adapter's write ops, so a brief of their own would
  buy an extra PR and almost no isolation. Read-only github mode would be a
  release nobody can use.

## Relation to waves

Waves already treat a brief as an Issue labelled `brief` with a four-line
header, and already use the Issue number as the plan id. Under the github store
one decision in [`../waves/README.md`](../waves/README.md) changes: the brief
Issue **is** the brief (`Brief: inline`), not a tracking record that points at
a file. Under the repo store that decision holds unchanged.

## Commands

```
/agentic-sdlc:plan docs/briefs/github-backlog/01-store-interface.md
# after 01 merges:
/agentic-sdlc:plan docs/briefs/github-backlog/02-github-adapter.md
```
