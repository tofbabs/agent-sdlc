# EPIC-11: Wave core, part 1 of 3: brief Issues, selection, `wave start` and `status`

- Brief: docs/briefs/waves/02-wave-core.md
- Part: 1 of 3
- Depends on: none
- Artifacts: none
- Lane: deliberate — recommended deliberate (rubric 1): 3 stories are PAIR, lane is deliberate
- Parts: EPIC-12 (tick), EPIC-13 (phase), stubs
- Outcome: a maintainer runs `/agentic-sdlc:wave start` and gets one wave of every brief that can safely be built together, as labelled Issues plus a board. `wave status` previews or prints it. Phases are still started by hand.
- Success metric: briefs in a wave that conflict with one another: 0 (the ~5 → 1 human-actions metric is measured after Part 3)
- Status: TODO

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Config location. RESOLVED by ADR-0006/0007: `.claude/agentic-sdlc.json`, `wave.*` keys added by the story that reads them, additive, via `config.mjs` | none | RESOLVED |
| ARCH-2 | Round comment contract. RESOLVED by ADR-0005: verdict and `reviewed sha:` read from the body; cap is `review.round_cap` | Part 2 | RESOLVED |
| ARCH-3 | Is `wave:deferred` kept, so a human can let a wave close past a brief that never reaches a PR, or must the human close the Issue? | Part 2 close rule | OPEN |
| ARCH-4 | Does a brief whose PR closed unmerged return to the pool automatically, or only once a human re-labels it? | Part 2 close rule | OPEN |
| ARCH-5 | Notification channel: `PushNotification` when available, else board and run report. Is a comment on the wave epic the durable channel? | Part 2 stall notices | OPEN |

Part 1 needs none of the OPEN rows: `start` reads only labels it creates, and
`wave:deferred` is not created until ARCH-3 settles.

## Stories

### STORY-11-1: Brief-Issue schema, parser and Issue template

- status: LANDED
- mode: PAIR — recommended PAIR (rubric 1): score 3 in the gap resolves to PAIR, flagged borderline
- estimate: S
- select: risk_class=none@brief:L40 one_way_doors=0@brief:L40 existing_pattern=yes@brief:L50 modules_crossed=3@brief:L50 review_bounced=no@brief:L40 risk_kind=code@brief:L50
- depends_on: []
- blocked_by_arch: []

**As a** maintainer with a backlog of briefs
**I want** a fixed four-line Issue body that a script can read
**So that** wave selection never depends on prose

**Acceptance criteria**
1. Given a body with `Brief:`, `Lane:`, `Depends on:` and `Conflicts with:` lines, when parsed, then it returns the brief path, lane (`fast|standard`), and two lists of Issue numbers, with `—` giving an empty list.
2. Given a body with other text, injected instructions, or a malformed line (unknown lane, non-number ref), when parsed, then only the four lines are read and a malformed one yields a named error, never a guess.
3. Given A lists `Conflicts with: #B` and B does not list A, when conflicts are queried for either, then the pair conflicts (both directions).
4. Given `templates/`, when a consuming project copies the Issue template, then it has the four lines and the `brief` label.

**Technical notes**
- New `scripts/brief-issue.mjs` + `scripts/brief-issue.test.sh`; plain Node. Template under `templates/` (no copy kept in this repo).
- Exports pure functions; no `gh` calls here.

**Out of scope**
- Inferring `Depends on` or `Conflicts with` (03's `/conflicts`).

### STORY-11-2: Wave selection

- status: LANDED
- mode: PAIR — recommended PAIR (rubric 1): score 3 in the gap resolves to PAIR, flagged borderline
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: M
- select: risk_class=none@brief:L62 one_way_doors=0@brief:L62 existing_pattern=yes@brief:L154 modules_crossed=3@brief:L62 review_bounced=no@brief:L62 risk_kind=code@brief:L62
- depends_on: [STORY-11-1]
- blocked_by_arch: []

**As a** maintainer
**I want** the set of briefs that can go together computed the same way every time
**So that** I stop making the "which together" call by hand

**Acceptance criteria**
1. Given any Issue labelled `wave:active`, when selecting, then it refuses and names that Issue.
2. Given the open `brief` Issues, when computing eligibility, then a brief is eligible only if every `Depends on` Issue is closed as completed; an open PR on a dependency, or a dependency closed not-planned, does not count.
3. Given eligible briefs, when selecting, then they are sorted by priority label, then dependents count, then Issue number, and each is taken unless it conflicts (either direction) with one already taken.
4. Given each selected brief, when assigning a start phase, then a brief with a plan starts at `build`, one with an open PR starts at that PR's evidence phase, and the rest start at `plan`.
5. Given nothing selected, when reporting, then an empty pool says "backlog exhausted" and otherwise "cannot continue" lists what blocks each brief.

**Technical notes**
- New `scripts/wave-select.mjs` + `.test.sh`, over JSON payloads on stdin or a file (the `ci-state.mjs` pattern), so the command makes the `gh api` calls and the script stays pure.
- Adds `wave.priority_labels` (default `priority:P0..P3`) to `config.mjs` DEFAULTS and validation (ADR-0006 rule 4); `config.test.sh` gains the case.
- Start phase from an open PR reuses `ci-state.mjs` and `round-state.mjs`; the full tick ordering is Part 2, so only "has plan / has open PR" is needed here.

**Out of scope**
- Writing labels, the epic Issue or the board (STORY-11-3). `wave:deferred`.

### STORY-11-3: `/wave start` and `/wave status` dispatcher

- status: LANDED
- mode: PAIR — recommended PAIR (rubric 1): score 5 at or above 4 is PAIR
- estimate: M
- select: risk_class=none@brief:L60 one_way_doors=0@brief:L60 existing_pattern=no@brief:L147 modules_crossed=4@brief:L147 review_bounced=no@brief:L60 risk_kind=code@brief:L60
- depends_on: [STORY-11-2]
- blocked_by_arch: []

**As a** maintainer
**I want** to run `/agentic-sdlc:wave start` and `status`
**So that** a wave is opened on GitHub, and I can see it or preview it

**Acceptance criteria**
1. Given no active wave and a selection, when `start` runs, then it creates the labels it needs (`wave`, `wave:active`, `wave:<N>`, `phase:*`) if missing, creates one wave epic Issue, labels each selected brief with `wave:<N>` and its start phase, and writes the board as one comment it can later edit in place.
2. Given an active wave, when `start` runs, then it refuses and changes nothing.
3. Given an active wave, when `status` runs, then it prints the board from labels and comments; given none, it prints the briefs `start` would pick; in both cases it writes nothing.
4. Given any run, then GitHub access is REST `gh api` only, and boards carry only Issue and PR numbers, phases and timings.
5. Given the PR, then `commands/wave.md` is a thin dispatcher (protocol in `reference/wave.md`) and `scripts/size-budget.json` does not grow: bytes added to `agents/` or `commands/` are cut elsewhere in the same PR.

**Technical notes**
- New `commands/wave.md`, `reference/wave.md`, `scripts/wave-board.mjs` + `.test.sh` (renders the board from JSON, pure). `./scripts/preflight.sh` checks the budget; the coder picks the cuts.
- Port the mechanism from QuestionMe `wave/SKILL.md` at `e0fde3f0`, not its repo facts (gate, `staging`, Supabase).
- `tick` and `phase` are not wired yet; `wave.md` answers "not available in this release" for `tick`.

**Out of scope**
- `tick`, locks, `phase`, `wave:deferred`, closing a wave, notifications.
