# MODE SELECTION — the rubric

Read by `/build` **only when `mode-select.mjs story` returns `fallback: true`**
(the story has no select line, so its mode comes from the prose rule below).
Otherwise the script's `choice` is the dispatch and this file is not needed.

Decide per story from its `risk:` line, **not its estimate** — an L story of
plumbing is SOLO, an S story of save/restore wiring is PAIR.

- **SOLO** — plumbing or UI following an existing pattern, pure helpers, config.
  One coder turn; the review at the PR is its check.
- **SOLO, coder on Opus** — the risk is in the *data* (sourcing, seeding,
  migration content), not the code. Before landing, check it independently
  yourself: recompute a total or count from the source.
- **PAIR** — the risk is in rules or wiring: invariants, persistence and restore,
  auth/session timing and races, cross-module integration, money, destructive
  data, or a story that came back from review. Every defect measured in paired
  runs came from reviewing wiring steps, none from red-green on helpers.

No `risk:` line → infer it from the ACs; when genuinely unsure, pair. A wave can
hold SOLO and PAIR stories at once, each in its own worktree.

## Reading the script output

`mode-select.mjs story` prints JSON. Dispatch on `choice`: `SOLO` → coder,
`SOLO_OPUS` → coder with `model: opus` (and the data check before LAND), `PAIR` →
the pair loop. `fallback: true` means the story has no select line; `reason` says
so, and `mode` (when set) is the one already recorded. Apply the prose rule above
to pick the mode, then record it with `--chosen`.
