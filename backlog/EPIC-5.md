# EPIC-5: Signal routine — cross-repo run reports into evidenced, proposed briefs

- Outcome: a daily routine turns new run reports into GitHub Issues (evidence + draft brief) or discard-log entries; every report is accounted for; humans still write the briefs.
- Success metric: accounting 100% (every report in exactly one issue or discard entry); re-run over the same input files 0 new issues (fixture test).
- Status: TODO
- Artifacts: docs/adr/0004-signal-envelope-key-and-fingerprint.md, docs/briefs/self-improvement/03-signal-routine.md
- Lane: deliberate — recommended deliberate (rubric 1): floor one_way_door, one_way_door, one_way_door, one_way_door, one_way_door, one_way_door, one_way_door, one_way_door fired, lane is deliberate
- Binding: ADR-0001 (report schema 1, closed vocab), ADR-0002 (decision records; `decisions`/`outcome_events` sections), ADR-0004 (store envelope 1, signal key, issue fingerprint). Lives outside `plugins/`; no `feat:` release.

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Input envelope (repo/token attribution, age) plus min runs / repos / token age / contribution cap, cost vs quality | 5-1, 5-3 | RESOLVED |
| ARCH-2 | What a "signal" is: signature fields, outlier metrics, baseline | 5-2, 5-4 | RESOLVED |
| ARCH-3 | Boundary and output contract of the model-assisted merge pass | 5-7 | RESOLVED |
| ARCH-4 | Issue fingerprint for dedupe and the discard-log location | 5-6 | RESOLVED |
| ARCH-5 | Where the routine runs and which credential reads the store | 5-8 | RESOLVED |
| ARCH-6 | How a shipped brief is tied to its signal for the shrink check | 5-9 | RESOLVED |
| ARCH-7 | Debt signal key: report has no joint category × risk cell | 5-2 | RESOLVED |

Assumptions (no handoff): scripts live in repo `scripts/` as plain Node 22 `.mjs` with `.test.sh`, importing the run-report validator and vocabulary read-only from the plugin; the prompt goes in `templates/routines/signal-scan-prompt.md`. `02-telemetry-export.md` has no brief yet, so 5-1 reads local fixtures through envelope 1 (ADR-0004).

## Stories

### STORY-5-1: Re-validate and account for every incoming report
- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: M
- select: risk_class=none@brief:L84-L88 one_way_doors=1@brief:L84-L88 existing_pattern=yes@brief:L84-L88 modules_crossed=2@brief:L61-L62 review_bounced=no@brief:L84-L88 risk_kind=code@brief:L84-L88
- depends_on: []
- blocked_by_arch: [ARCH-1]

**As a** plugin maintainer **I want** every report from a local directory re-validated and counted **So that** a poisoned or malformed report never reaches grouping and nothing is lost silently.

**Acceptance criteria**
1. Given a fixture dir of valid and invalid reports, when the scan runs, then each file lands in exactly one of accepted or rejected, and the summary counts sum to the file count.
2. Given a report with an unknown field or an unbounded string, when scanned, then it is rejected with an enum reason and never reaches later stages.
3. Given the same dir run twice, when scanned, then the summary is byte-identical.

**Technical notes**
- New `scripts/signal-scan.mjs` + `.test.sh`; reuse the plugin validator, do not copy it.

**Out of scope**
- Reading the real store (5-8).

### STORY-5-2: Deterministic grouping by signature and metric outlier
- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: M
- select: risk_class=none@brief:L43-L47 one_way_doors=1@brief:L43-L47 existing_pattern=no@brief:L43-L47 modules_crossed=1@brief:L43-L47 review_bounced=no@brief:L43-L47 risk_kind=code@brief:L43-L47
- depends_on: [STORY-5-1]
- blocked_by_arch: [ARCH-2]

**As a** plugin maintainer **I want** accepted reports grouped by signature and flagged by outlier **So that** recurring patterns surface as one group each.

**Acceptance criteria**
1. Given fixtures sharing (command, lane, mode, event, category, severity), when grouped, then they form one group carrying run count and distinct-repo count.
2. Given a metric far above the ARCH-2 baseline, when grouped, then it forms an outlier group with its ratio to baseline.
3. Given shuffled input order, when grouped, then output is identical (deterministic ordering and IDs).

**Technical notes**
- Group keys use only vocabulary tokens; no free text exists to carry.

**Out of scope**
- Thresholds (5-3) and merging (5-7).

### STORY-5-3: Weighting and thresholds gate which groups become issues
- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- estimate: M
- select: risk_class=none@brief:L48-L51 one_way_doors=1@brief:L48-L51 existing_pattern=no@brief:L48-L51 modules_crossed=1@brief:L48-L51 review_bounced=no@brief:L48-L51 risk_kind=code@brief:L48-L51
- depends_on: [STORY-5-2]
- blocked_by_arch: [ARCH-1]

**As a** maintainer **I want** groups to qualify only past min runs, min distinct repos and min token age, with per-token caps **So that** one noisy repo or burst of fake tokens cannot steer the backlog.

**Acceptance criteria**
1. Given one token supplying 1000 reports, when evaluated, then its contribution is capped and the group stays below threshold.
2. Given tokens younger than the minimum age, when evaluated, then they add nothing to counts.
3. Given a group below threshold, when evaluated, then it gets a discard entry naming the failed rule; thresholds read from a versioned data file, cost and quality kept separable.

**Technical notes**
- Threshold values are data, not code, so tuning is a one-file diff.

**Out of scope**
- Writing the discard log to its final home (5-6).

### STORY-5-4: Decision-outcome signals by rubric version and layer
- status: DONE
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- correction: PAIR→SOLO trigger=navigator_no_rejections
- estimate: M
- select: risk_class=none@brief:L52-L56 one_way_doors=1@brief:L52-L56 existing_pattern=no@brief:L52-L56 modules_crossed=1@brief:L52-L56 review_bounced=no@brief:L52-L56 risk_kind=code@brief:L52-L56
- depends_on: [STORY-5-2]
- blocked_by_arch: [ARCH-2]

**As a** maintainer **I want** verdict rates grouped by (layer, rubric, choice) **So that** a mis-tuned rubric shows up as evidence.

**Acceptance criteria**
1. Given reports with `decisions` and verdict events, when grouped, then each (layer, rubric, choice) reports its share of earned/wasted, held/missed, etc., and open or orphaned decisions are counted separately.
2. Given a rubric change where the "right" rate falls past the ARCH-2 margin, when scanned, then it emits a signal of its own.
3. Given reports without the optional sections, when scanned, then they still pass and contribute nothing here.

**Out of scope**
- Editing the rubric.

### STORY-5-5: Render an aggregates-only issue with a draft brief
- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 0 at or below 2 is SOLO
- estimate: M
- select: risk_class=none@brief:L57-L60 one_way_doors=0@brief:L57-L60 existing_pattern=yes@brief:L57-L60 modules_crossed=1@brief:L57-L60 review_bounced=no@brief:L57-L60 risk_kind=code@brief:L57-L60
- depends_on: [STORY-5-3]
- blocked_by_arch: []

**As a** maintainer **I want** each qualifying group rendered as an issue body **So that** I can read the evidence and, if I agree, write the brief.

**Acceptance criteria**
1. Given a qualifying group, when rendered, then the body has counts, distinct-repo count, cost and round impact vs baseline, a label, and a draft in `templates/brief.md` section shape.
2. Given any fixture, when rendered, then a test proves the body contains no token, repo ID or run_id (only counts and ratios).
3. Given the same group twice, when rendered, then output is identical.

**Technical notes**
- Pure function returning title, body, labels; filing is 5-6.

**Out of scope**
- Writing into `docs/briefs/` or opening PRs.

### STORY-5-6: Match existing issues, update instead of duplicate, write discard log
- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- estimate: L
- select: risk_class=none@brief:L55-L58 one_way_doors=1@brief:L55-L58 existing_pattern=no@brief:L55-L58 modules_crossed=2@brief:L55-L58 review_bounced=no@brief:L55-L58 risk_kind=code@brief:L55-L58
- depends_on: [STORY-5-5]
- blocked_by_arch: [ARCH-4]

**As a** maintainer **I want** known signals to update their issue and sub-threshold groups logged **So that** re-runs are idempotent and nothing is dropped.

**Acceptance criteria**
1. Given an open or closed issue with the group's fingerprint, when scanned, then it is updated with new counts and no new issue is created.
2. Given the same fixtures run twice with `gh` stubbed, when run, then the second run files 0 issues.
3. Given sub-threshold groups, when run, then each appears in the discard log with its reason, and issues plus discards cover every accepted report.

**Technical notes**
- `gh` behind an injectable adapter so tests never touch the network.

**Out of scope**
- Scheduling (5-8).

### STORY-5-7: Model-assisted merge of equivalent groups
- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- estimate: M
- select: risk_class=none@brief:L45-L47 one_way_doors=1@brief:L45-L47 existing_pattern=no@brief:L45-L47 modules_crossed=1@brief:L45-L47 review_bounced=no@brief:L45-L47 risk_kind=code@brief:L45-L47
- depends_on: [STORY-5-3]
- blocked_by_arch: [ARCH-3]

**As a** maintainer **I want** groups meaning the same thing merged **So that** one problem yields one issue.

**Acceptance criteria**
1. Given structured groups, when the pass runs, then its input is only vocabulary tokens and numbers (test asserts no raw report field is passed).
2. Given a merge proposal that references an unknown group or breaks the output contract, when applied, then it is rejected and groups stay unmerged.
3. Given a merge, when thresholds are re-evaluated, then merged counts use the 5-3 caps, so merging cannot lift a group over threshold by itself.

**Out of scope**
- Model choice of mode or rubric changes.

### STORY-5-8: Routine prompt, schedule and CLAUDE.md line
- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- estimate: M
- select: risk_class=none@brief:L59-L61 one_way_doors=1@brief:L59-L61 existing_pattern=yes@brief:L59-L61 modules_crossed=3@brief:L59-L61 review_bounced=no@brief:L59-L61 risk_kind=code@brief:L59-L61
- depends_on: [STORY-5-6, STORY-5-7]
- blocked_by_arch: [ARCH-5]

**As a** maintainer **I want** the scan to run daily from a prompt next to gap-scan **So that** proposals arrive without me remembering.

**Acceptance criteria**
1. Given `templates/routines/signal-scan-prompt.md`, when read, then it follows the gap-scan shape and states the routine proposes only and never writes briefs.
2. Given a run, when it ends, then the summary prints the accounting line (accepted = issues + discards).
3. Given CLAUDE.md, when read, then one line says the routine proposes briefs and humans write them; preflight stays green.

**Technical notes**
- Rescans the rolling window each run and prints how many reports are new since the last run (ARCH-1). Host and credential are set by ARCH-5.

**Out of scope**
- Any change under `plugins/`.

### STORY-5-9: Report whether a signal's group shrank after its brief shipped
- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): hard floor one_way_door forces PAIR
- estimate: S
- select: risk_class=none@brief:L111-L113 one_way_doors=1@brief:L111-L113 existing_pattern=no@brief:L111-L113 modules_crossed=1@brief:L111-L113 review_bounced=no@brief:L111-L113 risk_kind=code@brief:L111-L113
- depends_on: [STORY-5-6]
- blocked_by_arch: [ARCH-6]

**As a** maintainer **I want** the issue updated with before/after counts once its brief ships **So that** I learn whether the fix worked.

**Acceptance criteria**
1. Given a signal tied to a shipped brief, when scanned after ship, then its issue shows counts before and after as aggregates.
2. Given no tie exists, when scanned, then no claim is made.

**Out of scope**
- Gating anything on the result (tracked, not gated, in v1).

## Architect handoff details

Thresholds, baselines and verdict mappings all go in one data file,
`scripts/signal-thresholds.json` (`{"version": 1, ...}`), so tuning is a one-file
diff. The values below are its v1 contents.

### ARCH-1: Input envelope and anti-poisoning policy
- status: RESOLVED
- reversibility: ONE-WAY (envelope, ADR-0004) / TWO-WAY (values)
- category: security
- **Decision:** Use envelope 1 from ADR-0004. The store stamps `source`, `source_first_seen` and `received_at`, and the routine re-validates `report` with the plugin's `validate()`. A distinct repo means a distinct `source`. Each run rescans a **rolling 30-day window** of `received_at`, so the run itself keeps no cursor. It prints how many reports are new since the newest `received_at` already reflected in the issues. Thresholds per class are min runs, min sources, min source age and a per-source cap per group. **Quality** (every kind except outlier): 5 runs, 3 sources, 7 days, cap 2. **Cost** (outlier): 10 runs, 3 sources, 7 days, cap 2.
- **Why:** Cost metrics vary more from run to run than discrete events do, so they need more runs. Neither class gets fewer minimum sources, because the source minimum is the poisoning defence. A cap of 2 runs and a minimum of 3 sources means no single source can supply a majority of the counted runs.
- **Note:** A report from a source that is too young is still accepted and still belongs to its groups, with a weight of 0, so accounting is unchanged. The caps are applied after any merge (5-7). Local mode (`.agentic-sdlc/runs/`) is one source, so it always discards with `min_sources`. That is intended.

### ARCH-2: What a signal is, and its baseline
- status: RESOLVED
- reversibility: ONE-WAY (key, ADR-0004) / TWO-WAY (baseline, margins)
- category: contract
- **Decision:** The signal key is the per-kind canonical key in ADR-0004, which also lists the five outlier metrics. The **baseline is the median for each (command, metric)** across all weighted reports in the window. It is global rather than per lane or mode, so a cell that runs hot shows up against it ("PAIR averages 4 review rounds"). A report is an outlier when its value is at least 2.0 times the baseline. An outlier group is keyed by (command, lane, mode, metric) and carries `ratio = group median / baseline`. With fewer than 20 weighted reports from 3 sources there is no baseline, and the discard reason is `no_baseline`. Verdicts: `right = {earned, held, needed, better}` and `wrong = {wasted, missed, under_ceremony, over_ceremony, worse}`. Open and orphaned decisions are counted on their own and are never rated. `verdict_drift` fires when the right-rate at rubric r is at least 0.15 below the rate at r−1, with at least 10 settled decisions on each side.
- **Why:** The 01 baseline is unmeasured, and the plugin ships weekly, so a fixed baseline would go stale. A rolling median is robust to the outliers it is meant to find.
- **Note:** A settlement joins its decision by `decision_id` within the window. If the decision is outside the window, it counts as `unjoined`, never as a guess. The `ignore` list in the data file (for example `degraded:gate_history`, which is permanently degraded until a gate recorder exists) discards with the reason `ignored`.

### ARCH-3: Model-assisted merge boundary
- status: RESOLVED
- reversibility: TWO-WAY
- category: security
- **Decision:** The routine's own Claude Code session is the model. There is no API call and no key. The pass has three steps:
  1. `signal-scan.mjs groups` writes `groups.json`, which holds fingerprints, key tokens and counts only.
  2. The session writes `merges.json`, shaped `{"merges":1,"proposals":[{"members":["sig-…","sig-…"]}]}`. It contains no free text at all.
  3. `signal-scan.mjs apply-merges` validates the proposal. **Any** violation rejects the whole file, and every group stays unmerged. Violations are: an unknown field, an unknown fingerprint, fewer than 2 members, a fingerprint in two proposals, or members of different `kind`s. The summary then records `merge_rejected:<reason>`.
  The merged group's primary is the smallest member fingerprint, its reports are the union deduplicated by `run_id`, and the ARCH-1 caps are recomputed on that union. The issue marker lists every member, so the next run re-applies known merges deterministically **before** the model pass. The model only proposes new merges.
- **Why:** Reusing the session adds no dependency or credential. A closed proposal shape means a hostile or confused output can only fail to merge.
- **Note:** If `merges.json` is absent, the pass is skipped, which is the fixture path for 5-6 AC2. The 5-7 AC1 test asserts that `groups.json` holds only `sig-*`, vocabulary tokens, `*` and numbers.

### ARCH-4: Issue fingerprint and discard-log home
- status: RESOLVED
- reversibility: ONE-WAY (fingerprint, ADR-0004) / TWO-WAY (discard home)
- category: data
- **Decision:** The fingerprint and its matching follow ADR-0004: a `<!-- signal: sig-… -->` body marker matched locally against `gh issue list --label signal --state all`. On a match, the routine rewrites the body only if the rendered bytes differ. It never comments. It **never reopens** a closed issue, but it does keep its counts current. Accounting gives every accepted report exactly one disposition, with precedence in this order: `filed` (in at least one qualifying group), `discarded` (in groups, none qualifying), `no_signal` (no group at all). The summary line reads `accepted N = filed a + discarded b + no_signal c; rejected M by reason`. The **discard log** has two parts. One is the deterministic local `discards.json`. The other is the body of one long-lived issue labelled `signal-discards`, overwritten each run: a table of discarded groups (fingerprint, key, runs, sources, failed rule) plus the no_signal and rejected counts.
- **Why:** A repo file would make a daily routine commit or open PRs, which the brief rules out. A store prefix waits on 02. The issue body holds aggregates only, and GitHub keeps its edit history.
- **Note:** If the table would exceed 60,000 characters, it is cut off by the lowest run count and the body states how many rows were omitted (see Debt).

### ARCH-5: Routine host and store credential
- status: RESOLVED
- reversibility: TWO-WAY
- category: security
- **Decision:** The routine runs as a **Claude Code cloud routine**, matching the existing review and gap-scan routines (`docs/setup.md`). It is scheduled daily at a time a few minutes past the hour, has a single repo (`tofbabs/agent-sdlc`), and has **every connector removed**. Issue writes go through the routine's connected GitHub identity via `gh`, the same way review comments already do. The store credential is a **read-only token held as a network secret** on a dedicated environment, whose allowlist is the default plus the store host only. It is never an environment variable, because environment variables are visible to anyone using the environment. The schedule is **not enabled until 02's store is reachable**. Until then, maintainers run `node scripts/signal-scan.mjs --source dir:.agentic-sdlc/runs` and the prompt by hand.
- **Why:** This is consistent with the two existing routines and needs no API key for the merge pass. GitHub Actions would add a second host and an Anthropic API bill. Routines are a research preview (checked against code.claude.com/docs/en/routines on 2026-10-09). That is acceptable for a job that only proposes.
- **Note:** The prompt's step list must state the reader adapter flag, so switching to 02 is a one-line prompt change. Network secrets currently exist only on Pro and Max plans, not Team or Enterprise.

### ARCH-6: Tying a shipped brief to its signal
- status: RESOLVED
- reversibility: TWO-WAY
- category: lifecycle
- **Decision:** The tie is the **issue itself**, and briefs get no new convention. When the fix ships, a human closes the signal issue as **completed**, either directly or through "Closes #N" in a PR. A close as `not planned` makes no claim. The cut-over is the first release tag whose date is on or after `closedAt`, called V. Each run compares the group's **rate** (group runs ÷ weighted runs in that cohort), where before means `plugin_version < V` and after means `plugin_version ≥ V`. On the first run after close, the before-rate is frozen into the body, so it survives the window rolling past it. The routine makes no claim when V does not exist yet or when the after cohort is below the class's min runs.
- **Why:** Consuming repos adopt fixes by pin bump, so a release cohort says when the change actually reached users, and close time alone does not. A rate corrects for changes in report volume.
- **Note:** The routine reads tags from the cloned checkout. It updates the issue body only and never reopens.

### ARCH-7: Debt signal key without a joint category × risk cell
- status: RESOLVED
- reversibility: ONE-WAY (key, ADR-0004 amended in place, unpublished) / TWO-WAY (secondary figure)
- category: contract
- **Decision:** Option (a). Emit one `debt` key per `debt.by_category` entry whose count is > 0: `["debt", command, lane, mode, <debt_category>, "*"]`. `severity` is always the structural `*`. `debt.by_risk` feeds no key. The group counts one report per group, as usual. Its secondary figure is the sum of `by_category[<cat>]` across those reports (debt rows, not runs).
- **Why:** The report schema keeps `by_risk` and `by_category` as independent tallies, so any category × risk pairing is invented and a cross product inflates counts. What a maintainer can act on across repos is the category ("repos keep stubbing integrations"); a risk-only family ("repos log HIGH debt") names no fix, and per-repo risk is already triaged by gap-scan in each repo's `docs/TOOLING-DEBT.md`. Keeping the `severity` slot as `*` lets a later additive report field with joint cells add `(category, risk)` keys without changing any existing fingerprint.
- **Note:** 5-2 test: a report with `by_category: {robustness: 2, other: 1}` and `by_risk: {HIGH: 3}` yields exactly two debt groups, both with severity `*`, each counting 1 report; secondary figures 2 and 1. A report with `rows_logged: 0` (empty `by_category`) yields no debt group. Nothing under `plugins/` changes (see Debt).

## Debt

Ledgered in docs/TOOLING-DEBT.md by the plan commit.

- Debt signals ignore risk (ARCH-7): `debt` keys carry `severity = *` until the report schema has a joint category × risk count. Appended to docs/TOOLING-DEBT.md mid-build, since carry had already run.
