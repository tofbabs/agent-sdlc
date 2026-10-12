# Epic budget — weights, limits and size anchors

Read by `/plan` in STEP 1, and by the planner when it sizes a story. The
numbers live in `scripts/plan-artifacts.mjs`; `plan-artifacts.test.sh` fails
if this file and the script disagree.

---

## THE BUDGET

| Size | Points |
|------|--------|
| S | 3 |
| M | 5 |
| L | 15 |

- **Cap: 15 points per epic.** An L fills an epic alone.
- **150 lines** is the longest an epic file may be.
- **`## Stories` starts by line 40.** Every coder in the epic reads the file,
  so each line above the stories is paid for once per story.

`plan-artifacts.mjs check <EPIC-n>` enforces exactly these, plus a missing or
non-S|M|L estimate and a missing `Depends on` target.

---

## ANCHORS

Counted over production plus test lines, excluding `backlog/` and `docs/`.

| Size | Lines changed | Files touched | New modules |
|------|---------------|---------------|-------------|
| S | ≤ ~150 | ≤ ~4 | none |
| M | ≤ ~400 | ≤ ~8 | at most one |
| L | ≤ ~800 | ≤ ~12 | — |

**The largest size any anchor dimension reaches wins.** A story at L's files
anchor is L even if its lines say M, and as an L it fills its epic alone.

Anchors are advisory: `check` never reads them. They make an estimate a
measurement rather than a mood; the points cap is what is enforced. Size
blast radius with LSP, not Grep.
