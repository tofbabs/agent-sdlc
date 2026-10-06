#!/usr/bin/env bash
#
# outcomes.test.sh — outcome events, the gh sweep, the verdict rules and the
# accounting check (STORY-2-9). Fixture-based: a temp git repo holds the
# decision store, `gh` is a stub, and every date is passed in so no test
# depends on the clock.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$ROOT/plugins/agentic-sdlc/scripts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 — got: $2, want: $3"; }

RUN=11111111-2222-4333-8444-555555555555
RUN2=22222222-2222-4333-8444-555555555555
NOW=2026-03-01T00:00:00Z

new_repo() {
  local d="$TMP/$1"
  mkdir -p "$d" && git -C "$d" init -q
  echo "$d"
}

# Test helpers shared by the node fixtures below.
cat > "$TMP/lib.mjs" <<LIB
import { writeDecision, appendEvent, readAllDecisions } from '$S/decisions.mjs'
export const RUN = '$RUN'
export const mk = (cwd, subject, layer, choice, extra = {}) =>
  writeDecision({
    run_id: RUN, subject, layer, rubric: 1, floor: null, score: 2, inputs: {},
    choice, alternative: null, overridden: false, fallback: false,
    created_at: '2026-01-01T00:00:00Z', ...extra,
  }, { cwd })
export const ev = (cwd, rec, event, at, rest = {}) =>
  appendEvent(rec.decision_id, { event, at, run_id: RUN, ...rest }, { cwd })
export const all = (cwd) => readAllDecisions({ cwd })
export const by = (cwd, subject, layer) => all(cwd).find((d) => d.subject === subject && (layer === undefined || d.layer === layer))
LIB

verdicts() { node "$S/mode-select.mjs" verdicts --cwd "$1" --now "${2:-$NOW}"; }
q() { node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String($1))"; }

# ---------------------------------------------------------------- AC1 events
echo "outcome events (AC1)"
R=$(new_repo events)
node --input-type=module -e "
  import { mk } from '$TMP/lib.mjs'
  mk('$R', 'STORY-2-9', 'score', 'PAIR')
  mk('$R', 'STORY-2-3', 'score', 'SOLO')
"
out=$(node "$S/outcomes.mjs" event --cwd "$R" --subject STORY-2-9 --event build --run-id $RUN --tokens 1200 --wall-s 300 --alternations 4 --rejections 1 --gate-failures 2 --blocks 0 --now 2026-01-02T00:00:00Z)
check "a build event appends to the story's decision" "$(echo "$out" | q r.appended)" true
got=$(node --input-type=module -e "
  import { by } from '$TMP/lib.mjs'
  const e = by('$R', 'STORY-2-9').outcome_events
  console.log(e.length, e[0].event, e[0].tokens, e[0].wall_s, e[0].alternations, e[0].rejections, e[0].gate_failures, e[0].blocks, e[0].run_id)
")
check "the event carries every build measure and the appending run" "$got" "1 build 1200 300 4 1 2 0 $RUN"
node "$S/outcomes.mjs" event --cwd "$R" --subject STORY-2-3 --event review --run-id $RUN2 --findings 3 --revise-rounds 2 --now 2026-01-05T00:00:00Z >/dev/null
got=$(node --input-type=module -e "
  import { by } from '$TMP/lib.mjs'
  const d = by('$R', 'STORY-2-3'); console.log(d.outcome_events[0].event, d.outcome_events[0].findings, d.outcome_events[0].revise_rounds, d.outcome_events[0].run_id)
")
check "a later run's review event joins the earlier run's decision" "$got" "review 3 2 $RUN2"

# --from-session reads the observe tally and the mirrored pair session.
COMMON=$(git -C "$R" rev-parse --git-common-dir); COMMON=$(cd "$R" && cd "$COMMON" && pwd)
mkdir -p "$COMMON/agentic-sdlc/observe" "$COMMON/agentic-sdlc/pair/STORY-2-3"
echo '{"blocks":1,"gate_failures":{"AC1":2,"AC2":1},"escalated":null}' > "$COMMON/agentic-sdlc/observe/$RUN-STORY-2-3.json"
echo '{"story":"STORY-2-3","session":"active","alternation":5,"rejections":2}' > "$COMMON/agentic-sdlc/pair/STORY-2-3/session.json"
node "$S/outcomes.mjs" event --cwd "$R" --subject STORY-2-3 --event build --run-id $RUN --from-session --tokens 10 --ref b1 --now 2026-01-06T00:00:00Z >/dev/null
got=$(node --input-type=module -e "
  import { by } from '$TMP/lib.mjs'
  const e = by('$R', 'STORY-2-3').outcome_events.find((x) => x.event === 'build')
  console.log(e.blocks, e.gate_failures, e.alternations, e.rejections, e.tokens)
")
check "--from-session reads blocks, gate failures, alternations and rejections from the existing recorders" "$got" "1 3 5 2 10"
out=$(node "$S/outcomes.mjs" event --cwd "$R" --subject STORY-2-3 --event build --run-id $RUN --ref b1 --now 2026-01-06T00:00:00Z)
check "an event whose ref is already on the record is not appended twice" "$(echo "$out" | q r.appended)" false
out=$(node "$S/outcomes.mjs" event --cwd "$R" --subject STORY-9-9 --event build --run-id $RUN)
check "no decision for the subject: exit 0, nothing appended" "$(echo "$out" | q r.reason)" no_open_decision
node "$S/outcomes.mjs" event --cwd "$R" --subject STORY-2-3 --event nonsense >/dev/null 2>&1 && bad "an unknown event token must be rejected" || ok "an unknown event token is rejected"
out=$(node "$S/outcomes.mjs" event --cwd "$TMP" --subject STORY-2-3 --event build 2>/dev/null); rc=$?
check "outside a git repo the producer degrades to exit 0" "$rc $(echo "$out" | q r.appended)" "0 false"

# ---------------------------------------------------------------- verdicts
echo "verdict rules (AC3)"
R=$(new_repo verdicts)
node --input-type=module -e "
  import { mk, ev, by } from '$TMP/lib.mjs'
  const merged = '2026-01-10T00:00:00Z'
  const set = (s, layer, choice, events, extra) => {
    const d = mk('$R', s, layer, choice, extra)
    ev('$R', d, 'merged', merged)
    for (const [e, rest] of events) ev('$R', d, e, '2026-01-12T00:00:00Z', rest)
  }
  set('S-SOLO-HELD', 'score', 'SOLO', [['build', { alternations: 0 }]])
  set('S-SOLO-MISSED', 'score', 'SOLO', [['post_merge_fix', {}]])
  set('S-SOLO-REVERT', 'score', 'SOLO_OPUS', [['post_merge_revert', {}]])
  set('S-SOLO-FINDINGS', 'score', 'SOLO', [['review', { findings: 2 }]])
  set('S-PAIR-EARNED', 'score', 'PAIR', [['build', { rejections: 1 }]])
  set('S-PAIR-WASTED', 'score', 'PAIR', [['build', { rejections: 0, alternations: 5 }]])
  set('S-FLOOR-PAIR', 'floor', 'PAIR', [['build', { rejections: 0 }]])
  set('S-FAST-HELD', 'score', 'SOLO', [['build', {}]])
  set('lane-held', 'lane', 'FAST', [['build', {}]])
  set('lane-under', 'lane', 'FAST', [['review', { revise_rounds: 1 }]])
  set('lane-needed', 'lane', 'deliberate', [['review', { findings: 1 }]])
  set('lane-over', 'lane', 'deliberate', [['build', { gate_failures: 0 }]])
  // Override: selector said SOLO, human chose PAIR.
  set('S-OV-BETTER', 'score', 'SOLO', [])
  set('S-OV-BETTER', 'override', 'PAIR', [['build', { rejections: 2 }]], { alternative: 'SOLO', overridden: true, score: null })
  set('S-OV-WORSE', 'score', 'SOLO', [])
  set('S-OV-WORSE', 'override', 'PAIR', [['build', { rejections: 0 }]], { alternative: 'SOLO', overridden: true, score: null })
" 2>&1
out=$(verdicts "$R")
check "every decision past its window closes (none open, none orphaned)" "$(echo "$out" | q 'r.open+" "+r.orphaned.length')" "0 0"
v() { node --input-type=module -e "import { by } from '$TMP/lib.mjs'; const d = by('$R', '$1', ${2:-undefined}); console.log(d.state, d.verdict, d.verdict_rubric)"; }
check "SOLO with no fix/findings: held, stamped rubric 1" "$(v S-SOLO-HELD)" "closed held 1"
check "SOLO then a post-merge fix: missed" "$(v S-SOLO-MISSED)" "closed missed 1"
check "SOLO_OPUS then a revert: missed" "$(v S-SOLO-REVERT)" "closed missed 1"
check "SOLO with review findings: missed" "$(v S-SOLO-FINDINGS)" "closed missed 1"
check "PAIR with a navigator rejection: earned" "$(v S-PAIR-EARNED)" "closed earned 1"
check "PAIR with none: wasted" "$(v S-PAIR-WASTED)" "closed wasted 1"
check "a floor-forced PAIR is judged as PAIR" "$(v S-FLOOR-PAIR)" "closed wasted 1"
check "FAST lane, clean: held" "$(v lane-held)" "closed held 1"
check "FAST lane with a REVISE round: under_ceremony" "$(v lane-under)" "closed under_ceremony 1"
check "deliberate lane that caught something: needed" "$(v lane-needed)" "closed needed 1"
check "deliberate lane that caught nothing: over_ceremony" "$(v lane-over)" "closed over_ceremony 1"
check "override whose path caught something: better" "$(v S-OV-BETTER "'override'")" "closed better 1"
check "override whose path caught nothing: worse" "$(v S-OV-WORSE "'override'")" "closed worse 1"
check "the selector's own record is judged by its override (override better: SOLO missed)" "$(v S-OV-BETTER "'score'")" "closed missed 1"
check "the selector's own record is judged by its override (override worse: SOLO held)" "$(v S-OV-WORSE "'score'")" "closed held 1"
out=$(verdicts "$R"); check "re-running verdicts settles nothing twice" "$(echo "$out" | q 'r.closed.length+r.orphaned.length+r.open')" 0

echo "outcome window and orphans"
R=$(new_repo window)
node --input-type=module -e "
  import { mk, ev } from '$TMP/lib.mjs'
  const inside = mk('$R', 'S-INSIDE', 'score', 'SOLO'); ev('$R', inside, 'merged', '2026-02-20T00:00:00Z')
  const edge = mk('$R', 'S-EDGE', 'score', 'SOLO'); ev('$R', edge, 'merged', '2026-02-15T00:00:00Z')
  const gone = mk('$R', 'S-GONE', 'score', 'SOLO'); ev('$R', gone, 'abandoned', '2026-01-20T00:00:00Z')
  mk('$R', 'S-NEVER', 'score', 'SOLO')
  const stale = mk('$R', 'S-STALE', 'score', 'SOLO'); ev('$R', stale, 'build', '2026-01-05T00:00:00Z')
  const fresh = mk('$R', 'S-FRESH', 'score', 'SOLO', { created_at: '2026-02-25T00:00:00Z' })
  const replaced = mk('$R', 'S-REPLACED', 'score', 'SOLO'); ev('$R', replaced, 'abandoned', '2026-01-02T00:00:00Z'); ev('$R', replaced, 'merged', '2026-02-20T00:00:00Z')
  const early = mk('$R', 'S-EARLY', 'score', 'SOLO', { created_at: '2026-02-25T00:00:00Z' }); ev('$R', early, 'abandoned', '2026-02-26T00:00:00Z')
"
out=$(verdicts "$R")
st() { node --input-type=module -e "import { by } from '$TMP/lib.mjs'; const d = by('$R', '$1'); console.log(d.state, d.verdict ?? d.orphan_reason ?? '-')"; }
check "merged 9 days ago: still open inside the 14-day window" "$(st S-INSIDE)" "open -"
check "merged exactly 14 days ago: the window has passed" "$(st S-EDGE)" "closed held"
check "an abandoned PR orphans as pr_deleted" "$(st S-GONE)" "orphaned pr_deleted"
check "no events past the window: orphaned subject_missing" "$(st S-NEVER)" "orphaned subject_missing"
check "built but never merged past the window: orphaned other" "$(st S-STALE)" "orphaned other"
check "an unmerged decision younger than the window stays open" "$(st S-FRESH)" "open -"
check "an abandoned PR replaced by one that merged is judged on the merge" "$(st S-REPLACED)" "open -"
check "an abandoned PR inside the window does not orphan yet" "$(st S-EARLY)" "open -"

echo "layer stacking"
R=$(new_repo stacking)
node --input-type=module -e "
  import { mk, ev } from '$TMP/lib.mjs'
  import { recordCorrection } from '$S/decisions.mjs'
  const score = mk('$R', 'S-STACK', 'score', 'SOLO')
  recordCorrection({ run_id: '$RUN', subject: 'S-STACK', seq: 1, trigger: 'blocked_twice', from: 'SOLO', to: 'PAIR' }, { cwd: '$R' })
  const down = mk('$R', 'S-DOWN', 'score', 'PAIR')
  recordCorrection({ run_id: '$RUN', subject: 'S-DOWN', seq: 1, trigger: 'navigator_no_rejections', from: 'PAIR', to: 'SOLO' }, { cwd: '$R' })
"
node "$S/outcomes.mjs" event --cwd "$R" --subject S-STACK --event build --run-id $RUN --rejections 1 --now 2026-01-03T00:00:00Z >/dev/null
node "$S/outcomes.mjs" event --cwd "$R" --subject S-STACK --event merged --run-id $RUN --now 2026-02-20T00:00:00Z >/dev/null
got=$(node --input-type=module -e "
  import { by } from '$TMP/lib.mjs'
  console.log(by('$R', 'S-STACK', 'score').outcome_events.length, by('$R', 'S-STACK', 'correction').outcome_events.map((e) => e.event).join(','))
")
check "events after a correction land on the correction's record, not the corrected one" "$got" "0 build,merged"
verdicts "$R" 2026-02-21T00:00:00Z >/dev/null
check "a correction firing closes the decision it corrected, inside the window (SOLO then PAIR: missed)" "$(v S-STACK "'score'")" "closed missed 1"
check "PAIR corrected down to SOLO: the PAIR record closes wasted" "$(v S-DOWN "'score'")" "closed wasted 1"
check "the correction's own record stays open until its window passes" "$(v S-STACK "'correction'" | cut -d' ' -f1)" open
verdicts "$R" 2026-03-10T00:00:00Z >/dev/null
check "post-correction events close the correction's record (PAIR with a rejection: earned)" "$(v S-STACK "'correction'")" "closed earned 1"

# ------------------------------------------------------------------- sweep
echo "outcome sweep (AC2)"
R=$(new_repo sweep)
GHD="$TMP/gh"; mkdir -p "$GHD"
cat > "$GHD/gh" <<STUB
#!/usr/bin/env bash
[ -e "$GHD/fail" ] && exit 1
if [ "\$1" = pr ]; then cat "$GHD/prs.json"; else cat "$GHD/commits.json"; fi
STUB
chmod +x "$GHD/gh"
cat > "$GHD/prs.json" <<'JSON'
[
 {"number":10,"title":"feat(x): the epic [EPIC-2]","body":"","state":"MERGED","createdAt":"2026-02-01T00:00:00Z","mergedAt":"2026-02-04T00:00:00Z","closedAt":"2026-02-04T00:00:00Z","mergeCommit":{"oid":"aaa111"}},
 {"number":11,"title":"fix(x): repair the thing","body":"Fixes a regression from [STORY-2-9]","state":"MERGED","createdAt":"2026-02-05T00:00:00Z","mergedAt":"2026-02-06T00:00:00Z","closedAt":"2026-02-06T00:00:00Z","mergeCommit":{"oid":"bbb222"}},
 {"number":12,"title":"fix(x): unnamed fix to the same files","body":"no tag here","state":"MERGED","createdAt":"2026-02-05T00:00:00Z","mergedAt":"2026-02-07T00:00:00Z","closedAt":"2026-02-07T00:00:00Z","mergeCommit":{"oid":"ccc333"}},
 {"number":13,"title":"fix(x): too late [STORY-2-9]","body":"","state":"MERGED","createdAt":"2026-02-19T00:00:00Z","mergedAt":"2026-02-25T00:00:00Z","closedAt":"2026-02-25T00:00:00Z","mergeCommit":{"oid":"ddd444"}},
 {"number":14,"title":"feat(y): other work [STORY-3-1]","body":"","state":"CLOSED","createdAt":"2026-02-01T00:00:00Z","mergedAt":null,"closedAt":"2026-02-02T00:00:00Z","mergeCommit":null},
 {"number":15,"title":"fix(z): epic-level fix [EPIC-2]","body":"","state":"MERGED","createdAt":"2026-02-08T00:00:00Z","mergedAt":"2026-02-09T00:00:00Z","closedAt":"2026-02-09T00:00:00Z","mergeCommit":{"oid":"eee555"}}
]
JSON
cat > "$GHD/commits.json" <<'JSON'
[
 {"sha":"bbb222","commit":{"message":"fix(x): repair the thing (#11)","committer":{"date":"2026-02-06T00:00:00Z"}}},
 {"sha":"fff666abcdef","commit":{"message":"Revert \"feat(x): the epic [EPIC-2]\"\n\nbody","committer":{"date":"2026-02-10T00:00:00Z"}}},
 {"sha":"abc777abcdef","commit":{"message":"fix: direct hotfix with no tag","committer":{"date":"2026-02-10T00:00:00Z"}}}
]
JSON
node --input-type=module -e "
  import { mk } from '$TMP/lib.mjs'
  mk('$R', 'STORY-2-9', 'score', 'SOLO')
  mk('$R', 'STORY-3-1', 'score', 'SOLO')
  mk('$R', 'STORY-4-1', 'score', 'SOLO')
"
sweep() { OUTCOMES_GH="$GHD/gh" node "$S/outcomes.mjs" sweep --cwd "$R" --now "${1:-2026-03-01T00:00:00Z}"; }
sweep >/dev/null
evs() { node --input-type=module -e "import { by } from '$TMP/lib.mjs'; console.log(by('$R', '$1').outcome_events.map((e) => e.event + ':' + e.ref).sort().join(' '))"; }
check "the story merges via its epic's PR; fixes attribute by [STORY] in the PR body and [EPIC] in the title; a tagged revert counts; unnamed and out-of-window fixes do not" \
  "$(evs STORY-2-9)" "merged:pr:10 post_merge_fix:pr:11 post_merge_fix:pr:15 post_merge_revert:sha:fff666abcdef"
check "a PR closed unmerged is an abandoned event" "$(evs STORY-3-1)" "abandoned:pr:14"
check "a decision no PR names collects nothing" "$(evs STORY-4-1)" ""
got=$(node --input-type=module -e "import { by } from '$TMP/lib.mjs'; console.log(by('$R', 'STORY-2-9').outcome_events.find((e) => e.event === 'merged').days_to_merge)")
check "the merge event carries days to merge" "$got" 3
sweep >/dev/null
check "a second sweep attaches nothing new" "$(evs STORY-2-9)" "merged:pr:10 post_merge_fix:pr:11 post_merge_fix:pr:15 post_merge_revert:sha:fff666abcdef"
touch "$GHD/fail"
out=$(sweep); rc=$?
check "gh failing degrades to exit 0 with a reason" "$rc $(echo "$out" | q r.swept)" "0 false"
rm "$GHD/fail"
out=$(OUTCOMES_GH="$TMP/no-such-gh" node "$S/outcomes.mjs" sweep --cwd "$R" --now $NOW); rc=$?
check "a missing gh binary degrades to exit 0" "$rc $(echo "$out" | q r.swept)" "0 false"
verdicts "$R" >/dev/null
check "the swept fixes feed the verdict: SOLO story that needed fixes closes missed" "$(v STORY-2-9)" "closed missed 1"

echo "sweep across runs, run stamping, failed commits read"
R=$(new_repo rerun)
GH2="$TMP/gh2"; mkdir -p "$GH2"
cat > "$GH2/gh" <<STUB
#!/usr/bin/env bash
if [ "\$1" = pr ]; then cat "$GH2/prs.json"; exit 0; fi
[ -e "$GH2/fail-api" ] && exit 1
echo '[]'
STUB
chmod +x "$GH2/gh"
cat > "$GH2/prs.json" <<'JSON'
[
 {"number":20,"title":"feat(x): first attempt [EPIC-5]","body":"","state":"MERGED","createdAt":"2026-01-02T00:00:00Z","mergedAt":"2026-01-05T00:00:00Z","closedAt":"2026-01-05T00:00:00Z","mergeCommit":{"oid":"a20"}},
 {"number":21,"title":"fix(x): rebuild the story [STORY-5-1]","body":"","state":"MERGED","createdAt":"2026-02-11T00:00:00Z","mergedAt":"2026-02-12T00:00:00Z","closedAt":"2026-02-12T00:00:00Z","mergeCommit":{"oid":"a21"}}
]
JSON
node --input-type=module -e "
  import { mk } from '$TMP/lib.mjs'
  mk('$R', 'STORY-5-1', 'score', 'SOLO', { run_id: '$RUN2', created_at: '2026-02-10T00:00:00Z' })
"
touch "$GH2/fail-api"
out=$(OUTCOMES_GH="$GH2/gh" node "$S/outcomes.mjs" settle --cwd "$R" --run-id $RUN2 --now $NOW); rc=$?
check "a failed commits read is a failed sweep, and settle defers the verdicts" "$rc $(echo "$out" | q 'r.swept+" "+r.settled')" "0 false false"
got=$(node --input-type=module -e "import { by } from '$TMP/lib.mjs'; const d = by('$R', 'STORY-5-1'); console.log(d.state, d.outcome_events.map((e) => e.event + ':' + e.ref + ':' + e.run_id).join(' '))")
check "a rebuilt story joins the PR that merged after its decision, not an earlier run's; sweep events carry the run" "$got" "open merged:pr:21:$RUN2"
rm "$GH2/fail-api"
out=$(OUTCOMES_GH="$GH2/gh" node "$S/outcomes.mjs" settle --cwd "$R" --run-id $RUN2 --now $NOW)
check "once the sweep succeeds, settle runs the verdict pass" "$(echo "$out" | q 'r.settled+" "+r.verdicts.closed.length')" "true 1"
got=$(node --input-type=module -e "import { by } from '$TMP/lib.mjs'; const d = by('$R', 'STORY-5-1'); console.log(d.state, d.verdict, d.settled_run_id)")
check "the verdict names the run that settled it" "$got" "closed held $RUN2"

# -------------------------------------------------------------- accounting
echo "accounting (AC4)"
R=$(new_repo account)
node --input-type=module -e "
  import { mk, ev } from '$TMP/lib.mjs'
  const a = mk('$R', 'A', 'score', 'PAIR'); ev('$R', a, 'merged', '2026-01-01T00:00:00Z'); ev('$R', a, 'build', '2026-01-01T00:00:00Z', { rejections: 1 })
  const b = mk('$R', 'B', 'score', 'SOLO'); ev('$R', b, 'abandoned', '2026-01-02T00:00:00Z')
  const c = mk('$R', 'C', 'score', 'SOLO', { created_at: '2026-02-27T00:00:00Z' })
  mk('$R', 'D', 'lane', 'FAST')
"
# Overdue and never swept: the verdict pass has not run, so it is not accounted for.
node "$S/outcomes.mjs" account --cwd "$R" --now $NOW >"$TMP/acc.json"; rc=$?
check "decisions past their window with no verdict pass are reported unaccounted" "$rc $(q 'r.unaccounted.length' < "$TMP/acc.json")" "1 3"
verdicts "$R" >/dev/null
out=$(node "$S/outcomes.mjs" account --cwd "$R" --now $NOW); rc=$?
check "after the verdict pass every decision is exactly one of closed, open, orphaned" "$rc $(echo "$out" | q 'r.total+"="+r.closed+"+"+r.open+"+"+r.orphaned+" unaccounted "+r.unaccounted.length')" "0 4=1+1+2 unaccounted 0"
node --input-type=module -e "
  import { readAllDecisions } from '$S/decisions.mjs'
  import { writeFileSync } from 'node:fs'
  const d = readAllDecisions({ cwd: '$R' }).find((x) => x.state === 'orphaned')
  console.log(d.orphan_reason !== undefined && d.verdict === null)
" | grep -q true && ok "an orphan names its reason and carries no verdict" || bad "orphan record malformed"

[ "$fail" -eq 0 ] && printf '\noutcomes: all invariants hold\n' || { printf '\noutcomes: FAILED\n' >&2; exit 1; }
