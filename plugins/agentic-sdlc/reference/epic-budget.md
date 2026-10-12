# Epic budget — weights, limits and size anchors

Read by `/plan` in STEP 1, and by the planner when it sizes a story. The
numbers below are the **defaults**; they live in `scripts/plan-artifacts.mjs`,
and `plan-artifacts.test.sh` fails if this file and the script disagree. A
project overrides them in `.claude/agentic-sdlc.json` under `plan.epic`.

## EFFECTIVE BUDGET

The planner has no Bash, so it cannot read the config itself. In STEP 1 and
in FILL-IN, before spawning the planner, `/plan` runs
`config.mjs get plan.epic`, pastes the JSON into the planner prompt as the
effective budget, and stops on a non-zero exit rather than planning against
the defaults.

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

Defaults, counted over production plus test lines, excluding `backlog/` and `docs/`.

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

---

## SPLIT

An outcome that does not fit one epic is cut into parts, each its own epic.

- Cut at a release-signal seam (a part that ships a user-visible change on
  its own) or a contract seam (a schema, API or interface the later part
  consumes). Both let Part 1 merge before Part 2 starts.
- Cut between stories, never mid-story. A story is never divided to make
  the points fit.
- Each part carries `Part: k of N` and a `Depends on:` naming the part it
  needs merged.
- A brief within the cap stays one epic: `Part: 1 of 1` and `Depends on: none`.

---

## STUB

Parts after Part 1 are written as stubs, so their detail is planned against
what Part 1 actually merged.

- `Status: STUB`, with `Brief:`, `Part: k of N`, `Depends on:` and `Outcome:`.
- Stories carry only an `estimate` and `depends_on`: no detail.
- Keep any RESOLVED ARCH rows the part relies on. An architecture question the
  part will probably raise goes in as an OPEN ARCH row.
- Stubs are not added to Part 1's Artifacts.

---

## FILL-IN

Planning a stub's detail once the parts it depends on have merged.

- Resolve `<base>` exactly as `/build`'s BASE BRANCH does (the
  `**Integration branch:**` line in `CLAUDE.md`, else `main`), then run
  `ready EPIC-n --base <base> --deps-only` first. `ready` fetches `origin/<base>`
  itself, so a stale ref cannot report a merged part as unmerged. Not ready: stop.
- Re-read the brief at the stub's `Brief:`, limited to that part's stories and
  nothing else in it.
- Read the merged code, so the detail matches what the earlier parts built
  rather than what the brief assumed.
- Overwrite the same file. There is no new claim: the epic keeps its number.
- Run the architect, then `plan-artifacts.mjs check`.
- The result is `Status: TODO`.
- Over the cap: report and stop. There is no re-split in v1, because a re-split
  would need new part numbers the other stubs already depend on.
