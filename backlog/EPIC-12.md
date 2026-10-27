# EPIC-12: Wave core, part 2 of 4: lock, phase classifier, `wave tick`

- Brief: docs/briefs/waves/02-wave-core.md
- Part: 2 of 4
- Depends on: EPIC-11
- Outcome: `wave tick` derives each brief's phase from GitHub evidence, writes only changed labels, edits the board, notifies once per stall, and applies the close rule.
- Status: DONE
- Artifacts: none
- Lane: deliberate — recommended deliberate (rubric 1): 2 stories are PAIR, lane is deliberate

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-2 | Round comment contract. RESOLVED by ADR-0005 | none | RESOLVED |
| ARCH-3 | Is `wave:deferred` kept, or must the human close the Issue? TWO-WAY, `lifecycle`. **Decision:** drop `wave:deferred`. To let a wave close past a brief that never reaches a PR, the human closes its Issue as not planned; tick treats any closed brief Issue as terminal for the close rule. Reopening the Issue returns it to the pool. **Why:** `wave-select` already reads `state_reason` (not planned never delivers, so dependents stay blocked), so this adds no label, no pool filter and no state. Adding a label later is additive; removing one is breaking. | STORY-12-3 | RESOLVED |
| ARCH-4 | Does a PR closed unmerged return its brief to the pool automatically, or after a human re-label? TWO-WAY, `lifecycle`. **Decision:** automatically. A brief whose PR is closed unmerged, with no open PR, leaves the wave: tick removes its `wave:<N>` and `phase:*` labels and drops its board row. Its Issue stays open, so the next `start` sees it in the pool. **Why:** the pool is "open `brief` Issues" (`wave-select.mjs`), so this needs no new code. Abandoning a brief already has a signal: closing the Issue (ARCH-3). | STORY-12-3 | RESOLVED |
| ARCH-5 | Notification channel; is a comment on the wave epic the durable one? TWO-WAY, `contract`. **Decision:** yes. Post one comment per stall on the wave epic, with the first line `<!-- wave-stall:<issue> phase=<p> since=<iso> -->` and then numbers, phase and age only. That marker is also the dedup key: tick reads the epic's comments (already fetched to find the board) and skips any stall whose marker exists. A new phase gives a new `since`, so a new stall gets a new notice. `PushNotification` is best effort, called by the command when available. It is never the record. **Why:** GitHub is the only state, and the same marker pattern as `wave-board` gives once-per-stall for free. | STORY-12-3 | RESOLVED |

STORY-12-1 and STORY-12-2 need no OPEN row; they are pure scripts over payloads.

## Stories

### STORY-12-1: Phase lock and stale detection

- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 2 at or below 2 is SOLO
- estimate: M
- select: risk_class=none@brief:L56 one_way_doors=0@brief:L56 existing_pattern=yes@brief:L56 modules_crossed=2@brief:L56 review_bounced=no@brief:L56 risk_kind=code@brief:L56
- depends_on: []
- blocked_by_arch: []

**As a** maintainer running phases by hand or by routine
**I want** one phase per brief at a time, with a crashed run detected
**So that** two sessions never work the same brief and a stuck one is surfaced

**Acceptance criteria**
1. Given an Issue with the `phase-running` label and a `<!-- wave-run phase=<p> started=<iso> -->` comment, when the lock is read, then it reports held with phase and start time.
2. Given a held lock older than the configured timeout for its phase (default 1h plan, 4h build), when read, then it reports stale and counts as one failed attempt.
3. Given a brief with two failed attempts, when evaluated, then it returns `blocked` for the phase label; given one, it returns the lock cleared and the attempt count. Only attempts whose `started` is after the payload's `wave_labeled_at` (when its current `wave:<N>` label was applied) count, so a reopened brief with failures from an earlier wave is not blocked by them.
4. Given a malformed or missing `started`, when read, then a named error is returned and the lock is treated as held, never stale.
5. Given `wave.lock_timeouts` in config, when `config.mjs get` runs, then defaults and validation apply, with a `config.test.sh` case.

**Technical notes**
- New `scripts/wave-lock.mjs` + `.test.sh`, pure over a JSON payload `{labels, comments, now, timeouts, wave_labeled_at}` (the `wave-select.mjs` pattern). The command makes the `gh api` label, comment and events calls; `wave_labeled_at` is the `created_at` of the latest `labeled` event for the `wave:<N>` label, as `status` already derives `since`.
- The `.test.sh` includes a reopened-brief case: two stale `wave-run` comments older than `wave_labeled_at` and none after give one-run-clean, not `blocked`; the same two after it give `blocked`.
- Adds `wave.lock_timeouts` to `config.mjs` DEFAULTS, `validateWave` and the known-key map (ADR-0006 rule 4).
- Failed-attempt count is read from comments, not stored elsewhere: GitHub is the only state. The `wave-run` comment format is the contract Part 3's worker writes.

**Out of scope**
- Taking or clearing the lock (the `phase` worker, EPIC-13). Writing labels (STORY-12-3).

### STORY-12-2: Eight-rule phase classifier

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): score 3 in the gap resolves to PAIR, flagged borderline
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: M
- select: risk_class=none@brief:L72 one_way_doors=0@brief:L72 existing_pattern=yes@brief:L72 modules_crossed=3@brief:L72 review_bounced=no@brief:L72 risk_kind=code@brief:L72
- depends_on: []
- blocked_by_arch: []

**As a** maintainer
**I want** a brief's phase computed from evidence in a fixed order
**So that** the same GitHub state always yields the same phase

**Acceptance criteria**
1. Given a payload per brief (Issue state, PR merged/open, check-runs, round-state output, plan flag), when classified, then the first matching rule wins: done, revise (CI red), blocked (past `review.round_cap` unapproved), revise (REQUEST_CHANGES with no Response), awaiting-merge (approved on head sha with green CI), ci (other open PR), build (plan exists), plan.
2. Given a PR merged or its Issue closed, when classified, then `done` wins over every later rule, including red CI.
3. Given CI red, when classified, then the result carries `ci_failure: true` and the failing check names so the command can post one CI-failure comment; no comment is posted by the script.
4. Given an approving round whose `reviewed sha` is not the PR head sha, when classified, then it is not awaiting-merge and falls through to `ci`.
5. Given each of the eight rules, then a test fixture pins it, and a fixture with two rules matching pins the order.

**Technical notes**
- New `scripts/wave-classify.mjs` + `.test.sh`; imports `classify` from `ci-state.mjs`, and takes `round-state.mjs` output as input rather than re-parsing comments.
- Replaces the partial `startPhase` in `wave-select.mjs` only if a call-site check (LSP) shows `select` can import it with no behaviour change; otherwise leave it and note the duplication.
- Round cap is `review.round_cap` (ADR-0005); stall timing is not decided here.

**Out of scope**
- Writing labels, the board, comments, or stall detection (STORY-12-3). Running review or revise.

### STORY-12-3: `wave tick` write path, stall notices and close rule

- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): score 5 at or above 4 is PAIR
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: M
- select: risk_class=none@brief:L83 one_way_doors=0@AC5 existing_pattern=no@brief:L83 modules_crossed=4@brief:L83 review_bounced=no@brief:L83 risk_kind=code@brief:L83
- depends_on: [STORY-12-1, STORY-12-2]
- blocked_by_arch: []

**As a** maintainer
**I want** `/agentic-sdlc:wave tick` to move the wave forward and close it
**So that** I stop reading PRs to see where each brief is

**Acceptance criteria**
1. Given an active wave, when `tick` runs, then it classifies each brief (STORY-12-2), applies lock results (STORY-12-1), and changes only `phase:*` labels whose value differs from the current one; an unchanged wave makes zero label calls.
2. Given the new phases, when `tick` finishes, then the board comment is edited in place via `wave-board.mjs`, with `since` reset only for briefs whose phase changed.
3. Given a brief past its stall threshold (default 24h awaiting-merge, 2h unreviewed green head, 3h stalled revise), when `tick` runs twice, then the first run returns one notice keyed `<!-- wave-stall:<issue> phase=<p> since=<iso> -->` for an epic comment, and the second run, which sees that marker, returns none. A later phase change with a new `since` yields a new notice (ARCH-5).
4. Given a brief whose PR is closed unmerged and which has no open PR, when `tick` runs, then it returns removal of that brief's `wave:<N>` and `phase:*` labels and drops its board row. Its Issue is left open (ARCH-4).
5. Given every remaining brief is terminal (PR merged or Issue closed, for any reason), when `tick` runs, then `wave:active` is removed from the epic, the epic is closed, and `start` runs. A brief with an open Issue and no merged PR keeps the wave open, whatever its phase, including `blocked` (ARCH-3).
6. Given any run, then GitHub access is REST `gh api` only, no output carries titles or bodies, and `size-budget.json` does not grow.

**Technical notes**
- New `scripts/wave-tick.mjs` + `.test.sh`: pure, takes classifier output, current labels, board state and `now`; returns the label diff, stall notices and close decision. The command makes the `gh api` calls. The payload also carries the epic's comment first lines, for the stall markers, and each brief's Issue `state` and the merged/closed state of its PR.
- `reference/wave.md` names the two human levers: close the Issue as not planned to let the wave close without it, and reopen it to return it to the pool. No `wave:deferred` label is created.
- Adds `wave.stall_thresholds` to `config.mjs` (DEFAULTS, `validateWave`, known-key map) with a `config.test.sh` case.
- Replaces the "not available in this release" line for `tick` in `reference/wave.md`; `commands/wave.md` stays a thin dispatcher. Bytes added there are cut elsewhere in the same PR.
- Calls `start` at close through the existing STORY-11-3 path; do not duplicate it.
- Sized M at the upper anchor (~400 lines, 4-5 files); if the coder finds it larger, report rather than split.

**Out of scope**
- The `phase` worker and migration-number check (EPIC-13). Taking or clearing locks. More than one active wave.

## Debt
- **Stall notices depend on a GitHub subscription** (ARCH-5, LOW, `observability`). The only durable channel is the epic comment, and GitHub delivers it only to people watching the epic or the repo. When a routine posts as a bot (03), the maintainer is not subscribed automatically. Address when: 03 routines run waves under a non-human token.
- **No guard against reselection churn** (ARCH-4, LOW, `robustness`). A brief whose PRs keep getting closed unmerged is rebuilt every wave until a human closes its Issue. It cannot run away, because each cycle needs a human to close a PR. Address when: a brief is reselected after two unmerged PRs.
