#!/usr/bin/env bash
#
# run-report.test.sh — the invariants run-report.mjs exists to guarantee.
#
# The report is exported later, so the cases that matter most are the ones that
# would make it lie or leak:
#   * cost is the meter record's totals/derived VERBATIM — never re-derived, and
#     never with the record's free-string fields (label, by_agent, spawns),
#   * a missing input is null + named in `degraded` by vocabulary token — never a
#     zero, never prose,
#   * no field in the schema accepts an unbounded string.
#
# Each section's cases live in their own delimited block so section builders can
# be extended in parallel without colliding here.
#
# Bash, because the plugin repo has no test runner (see pair-log.test.sh).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
R="$ROOT/plugins/agentic-sdlc/scripts/run-report.mjs"
F="$ROOT/scripts/fixtures/run-report"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

RUN_ID="3f2b8c1e-9a4d-4e7f-8b21-6c5d4e3f2a10"
NOW="2020-01-01T00:10:00Z"
PLUGIN_VERSION=$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$ROOT/plugins/agentic-sdlc/.claude-plugin/plugin.json")

# q <file> <js-expression-on-r> — print one value from a JSON file.
q() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }

# mkproj <name> — an empty project with the fixture backlog files in place.
mkproj() {
  local p="$TMP/$1"
  mkdir -p "$p/backlog" "$p/.agentic-sdlc/meter"
  cp "$F/EPIC-7.md" "$F/FAST-3.md" "$p/backlog/"
  printf '%s' "$p"
}

# marker <project> <command> <lane> <target> <backlog-json> <arch-snapshot-json>
marker() {
  cat > "$1/.agentic-sdlc/run-state.json" <<EOF
{ "run_id": "$RUN_ID", "command": "$2", "lane": "$3", "target": "$4",
  "started_at": "2020-01-01T00:00:00Z", "sessions": 2, "wall_clock_s_prior": 100,
  "arch_snapshot": $6, "debt_snapshot": 0, "backlog": $5 }
EOF
}

report() { node "$R" report --now "$NOW" "$@" 2>/dev/null; }
OUT() { printf '%s/.agentic-sdlc/runs/%s.json' "$1" "$RUN_ID"; }

# ===================================================================== run

echo "run section"
P=$(mkproj plan-run)
marker "$P" plan deliberate "docs/briefs/fixture.md" '"backlog/EPIC-7.md"' '[]'
cp "$F/meter-record.json" "$P/.agentic-sdlc/meter/"
report --project "$P" >/dev/null; rc=$?
[ "$rc" -eq 0 ] && [ -f "$(OUT "$P")" ] && ok "report writes .agentic-sdlc/runs/<run_id>.json" \
  || bad "report rc=$rc, no file at $(OUT "$P")"
node "$R" validate "$(OUT "$P")" >/dev/null 2>&1 && ok "written report validates" || bad "written report is invalid"
got=$(q "$(OUT "$P")" '[r.run.run_id,r.run.command,r.run.lane,r.run.sessions,r.run.ended_at].join(" ")')
[ "$got" = "$RUN_ID plan deliberate 2 2020-01-01T00:10:00Z" ] && ok "run fields come from the marker" || bad "run fields: $got"
got=$(q "$(OUT "$P")" 'r.run.wall_clock_s')
[ "$got" = "700" ] && ok "wall_clock_s = prior (100) + now − started_at (600)" || bad "wall_clock_s=$got, want 700"
got=$(q "$(OUT "$P")" 'r.run.plugin_version')
[ "$got" = "$PLUGIN_VERSION" ] && ok "plugin_version read from the installed plugin.json" || bad "plugin_version=$got"
got=$(q "$(OUT "$P")" 'r.run.outcome')
[ "$got" = "completed" ] && ok "plan with a backlog file of stories → completed" || bad "outcome=$got"
grep -q 'docs/briefs/fixture.md\|backlog/EPIC-7' "$(OUT "$P")" && bad "marker target/backlog leaked into the report" \
  || ok "marker target and backlog path never reach the report"

P=$(mkproj plan-aborted)
marker "$P" plan fast "docs/briefs/never-planned.md" 'null' '[]'
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'r.run.outcome+" "+r.run.lane')
[ "$got" = "aborted fast" ] && ok "plan run with no backlog file → aborted" || bad "outcome/lane=$got"

P=$(mkproj build-blocked-pair)
marker "$P" build deliberate "EPIC-7" 'null' '["ARCH-1","ARCH-2","ARCH-3","ARCH-4","ARCH-5"]'
mkdir -p "$P/backlog/pair/STORY-7-2"
echo '{"session":"blocked","arch":"ARCH-6","alternation":3}' > "$P/backlog/pair/STORY-7-2/session.json"
report --project "$P" >/dev/null
[ "$(q "$(OUT "$P")" 'r.run.outcome')" = "blocked" ] && ok "build with a blocked pair session → blocked" \
  || bad "blocked pair session gave $(q "$(OUT "$P")" 'r.run.outcome')"

P=$(mkproj build-other-epic)
marker "$P" build deliberate "EPIC-7" 'null' '["ARCH-1","ARCH-2","ARCH-3","ARCH-4","ARCH-5"]'
mkdir -p "$P/backlog/pair/STORY-2-1"
echo '{"session":"blocked","arch":"ARCH-1"}' > "$P/backlog/pair/STORY-2-1/session.json"
report --project "$P" >/dev/null
[ "$(q "$(OUT "$P")" 'r.run.outcome')" = "aborted" ] && ok "another epic's blocked session does not block this run" \
  || bad "foreign session gave $(q "$(OUT "$P")" 'r.run.outcome')"

P=$(mkproj build-open-arch)
marker "$P" build deliberate "EPIC-7" 'null' '["ARCH-1","ARCH-2","ARCH-3","ARCH-4","ARCH-5"]'
printf '\n### ARCH-6: raised mid-build\n- status: OPEN\n- category: data\n' >> "$P/backlog/EPIC-7.md"
report --project "$P" >/dev/null
[ "$(q "$(OUT "$P")" 'r.run.outcome')" = "blocked" ] && ok "build with an OPEN mid-build ARCH → blocked" \
  || bad "open mid-build ARCH gave $(q "$(OUT "$P")" 'r.run.outcome')"

P=$(mkproj build-done)
marker "$P" build deliberate "EPIC-7" 'null' '["ARCH-1"]'
sed -i.bak 's/^- status: TODO$/- status: DONE/' "$P/backlog/EPIC-7.md"
report --project "$P" >/dev/null
[ "$(q "$(OUT "$P")" 'r.run.outcome')" = "completed" ] && ok "build with every story DONE → completed" \
  || bad "all-DONE build gave $(q "$(OUT "$P")" 'r.run.outcome')"

P=$(mkproj review-run)
marker "$P" review deliberate "42" 'null' '[]'
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'String(r.run.outcome)+" "+r.degraded.includes("pr_comments")')
[ "$got" = "null true" ] && ok "review outcome is null + pr_comments until the review section reads the PR" \
  || bad "review outcome: $got"

# =================================================================== plan

echo "plan section"
P=$(mkproj plan-epic)
marker "$P" plan deliberate "docs/briefs/fixture.md" '"backlog/EPIC-7.md"' '[]'
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" '[r.plan.epics,r.plan.stories,r.plan.tasks].join(" ")')
[ "$got" = "1 3 0" ] && ok "epic file: epics=1 stories=3 tasks=0 (prose mentions ignored)" || bad "epic counts: $got"
got=$(q "$(OUT "$P")" 'JSON.stringify(r.plan.arch_handoffs)')
want='{"contract":1,"data":0,"lifecycle":1,"dependency":0,"security":0,"cost":0,"process":0,"other":3}'
[ "$got" = "$want" ] && ok "arch_handoffs by category; untagged, stale-tag and table-only → other" \
  || bad "arch_handoffs: $got"

P=$(mkproj plan-by-artifacts)
marker "$P" plan deliberate "./docs/briefs/fixture.md --verbose" 'null' '[]'
report --project "$P" >/dev/null
[ "$(q "$(OUT "$P")" 'r.plan.stories')" = "3" ] && ok "plan run finds its backlog file via the - Artifacts: line" \
  || bad "artifacts resolution failed: $(q "$(OUT "$P")" 'JSON.stringify(r.plan)')"

P=$(mkproj plan-fast)
marker "$P" plan fast "docs/briefs/x.md" '"backlog/FAST-3.md"' '[]'
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" '[r.plan.epics,r.plan.stories,r.plan.tasks,Object.values(r.plan.arch_handoffs).reduce((a,b)=>a+b)].join(" ")')
[ "$got" = "0 0 3 0" ] && ok "fast file: tasks=3, no handoffs (one-way tags are not handoffs)" || bad "fast counts: $got"

P=$(mkproj build-plan-time)
marker "$P" build deliberate "EPIC-7" 'null' '["ARCH-1","ARCH-2"]'
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" '[r.plan.arch_handoffs.contract,r.plan.arch_handoffs.lifecycle,r.plan.arch_handoffs.other].join(" ")')
[ "$got" = "1 1 0" ] && ok "build run counts only handoffs in arch_snapshot as plan-time" || bad "plan-time handoffs: $got"

# ================================================================== build

echo "build section"
FB="$F/build"
# mkbuild <name> — a project holding the build fixture epic and its pair sessions.
mkbuild() {
  local p; p=$(mkproj "$1")
  cp "$FB/EPIC-8.md" "$p/backlog/"
  cp -R "$FB/pair" "$p/backlog/"
  printf '%s' "$p"
}
# commit <project> <subject> — an empty commit, isolated from the host's git config.
commit() {
  git -C "$1" -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c core.hooksPath=/dev/null \
    commit -q --allow-empty -m "$2"
}

P=$(mkbuild build-stories)
marker "$P" build deliberate "EPIC-8" 'null' '["ARCH-1"]'
report --project "$P" >/dev/null
node "$R" validate "$(OUT "$P")" >/dev/null 2>&1 && ok "build report validates" || bad "build report is invalid"
got=$(q "$(OUT "$P")" 'JSON.stringify(r.build.stories)')
want='[{"mode":"SOLO","alternations":0},{"mode":"PAIR","alternations":7},{"mode":"SOLO","alternations":0},{"mode":"PAIR","alternations":2}]'
[ "$got" = "$want" ] && ok "touched stories in backlog order; untouched TODO stories absent, not zeroed" \
  || bad "build.stories: $got"
got=$(q "$(OUT "$P")" 'r.build.stories[1].alternations+" "+r.build.stories[3].alternations')
[ "$got" = "7 2" ] && ok "PAIR alternations equal session.json's alternation exactly" || bad "alternations: $got"
got=$(q "$(OUT "$P")" 'r.build.stories.filter(s=>s.mode==="SOLO").every(s=>Object.hasOwn(s,"alternations")&&s.alternations===0)')
[ "$got" = "true" ] && ok "SOLO stories read alternations 0, never an omitted field" || bad "SOLO alternations omitted"
grep -q 'STORY-8' "$(OUT "$P")" && bad "story IDs leaked into the report" || ok "build.stories carries no story IDs"
got=$(q "$(OUT "$P")" 'JSON.stringify(r.build.arch_blocks)')
want='{"contract":0,"data":1,"lifecycle":0,"dependency":0,"security":0,"cost":0,"process":0,"other":3}'
[ "$got" = "$want" ] && ok "arch_blocks: mid-build handoffs by category; untagged, stale and table-only → other" \
  || bad "arch_blocks: $got"
got=$(q "$(OUT "$P")" 'String(r.build.gate_runs)+" "+r.build.gate_failures+" "+r.degraded.includes("gate_history")')
[ "$got" = "null null true" ] && ok "gate_runs/gate_failures null + gate_history (no recorder exists)" || bad "gates: $got"

P=$(mkbuild build-plan-run)
marker "$P" plan deliberate "x" '"backlog/EPIC-8.md"' '[]'
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'Object.values(r.build.arch_blocks).reduce((a,b)=>a+b)+" "+Object.values(r.plan.arch_handoffs).reduce((a,b)=>a+b)')
[ "$got" = "0 5" ] && ok "a plan run counts handoffs once, in plan, never again in arch_blocks" || bad "plan-run blocks/handoffs: $got"

P=$(mkbuild build-no-marker)
node "$R" report --project "$P" --backlog "$P/backlog/EPIC-8.md" --out "$TMP/build-nomarker.json" --now "$NOW" >/dev/null 2>&1
got=$(q "$TMP/build-nomarker.json" 'String(r.build.arch_blocks)+" "+r.degraded.filter(d=>d==="run_state").length+" "+r.build.stories.length')
[ "$got" = "null 1 4" ] && ok "no marker → arch_blocks null, run_state named once, stories still derived" \
  || bad "no-marker build: $got"

P=$(mkbuild build-git-tag)
marker "$P" build deliberate "EPIC-8" 'null' '["ARCH-1"]'
git init -q "$P" && commit "$P" "feat(x): fourth [STORY-8-4]" && commit "$P" "feat(x): not ours [STORY-8-40]"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'r.build.stories.map(s=>s.mode+s.alternations).join(" ")')
[ "$got" = "SOLO0 PAIR7 SOLO0 SOLO0 PAIR2" ] && ok "a [STORY-ID] commit tag marks a TODO story touched (exact tag only)" \
  || bad "git-tagged stories: $got"

P=$(mkproj build-fast)
marker "$P" build fast "FAST-3" 'null' '[]'
git init -q "$P" && commit "$P" "feat(x): second task [T3-2]"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'JSON.stringify(r.build.stories)')
[ "$got" = '[{"mode":"FAST","alternations":0}]' ] && ok "FAST task touched by its commit tag → mode FAST" || bad "fast stories: $got"

P=$(mkbuild build-bad-session)
marker "$P" build deliberate "EPIC-8" 'null' '["ARCH-1"]'
echo 'not json' > "$P/backlog/pair/STORY-8-2/session.json"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'r.build.stories[1].mode+" "+r.build.stories[1].alternations+" "+r.degraded.includes("pair_sessions")')
[ "$got" = "PAIR null true" ] && ok "unreadable session.json → PAIR, alternations null + pair_sessions" || bad "bad session: $got"

got=$(node --input-type=module -e '
  import { buildBuild, loadContext } from "'"$R"'"
  const ctx = loadContext({ project: process.argv[1], now: new Date("'"$NOW"'") })
  const run = (prComments) => buildBuild({ ...ctx, prComments })
  const none = run(null), absent = run(undefined)
  const counted = run([
    "## Review — round 1\n- F1: x",
    "## Response — round 1\n- F1: FIXED",
    "## Review — round 2",
    "## Response — round 2\n- F2: DISPUTED",
    "## Response — round 2\n(re-posted)",
    "a quote: ## Response — round 9 is not a heading",
  ])
  process.stdout.write([
    none.section.revise_rounds, none.degraded.includes("pr_comments"),
    absent.section.revise_rounds, counted.section.revise_rounds, counted.degraded.includes("pr_comments"),
  ].map(String).join(" "))
' "$P")
[ "$got" = "null true null 2 false" ] \
  && ok "revise_rounds = distinct Response rounds; prComments null → null + pr_comments" || bad "revise_rounds: $got"

# ================================================================= review

echo "review section"
RF="$F/review"
export FAKE_GH_ARGS="$TMP/gh-args" FAKE_GH_OUT="$RF/gh-view.json"
review_report() { RUN_REPORT_GH="$RF/fake-gh" report "$@"; }

P=$(mkproj review-file)
marker "$P" review deliberate "42" 'null' '[]'
review_report --project "$P" --pr-comments "$RF/comments.json" >/dev/null
node "$R" validate "$(OUT "$P")" >/dev/null 2>&1 && ok "review report validates" || bad "review report is invalid"
[ "$(q "$(OUT "$P")" 'r.review.rounds')" = "2" ] && ok "two round comments → rounds 2" \
  || bad "rounds=$(q "$(OUT "$P")" 'r.review.rounds')"
got=$(q "$(OUT "$P")" 'r.review.findings.map(f=>[f.round,f.category,f.severity].join(":")).join(" ")')
[ "$got" = "1:correctness:BLOCKER 1:other:MINOR 1:other:MAJOR 2:clarity:MINOR" ] \
  && ok "one {round,category,severity} per finding; untagged/unknown tag → other; rulings and unknown severity skipped" \
  || bad "findings: $got"
[ "$(q "$(OUT "$P")" 'r.review.verdict')" = "COMMENT" ] && ok "verdict is the latest round's GitHub state (COMMENT fallback)" \
  || bad "verdict=$(q "$(OUT "$P")" 'r.review.verdict')"
grep -q 'SECRET-FINDING-TEXT\|src/secret\|1111111' "$(OUT "$P")" && bad "finding text or sha leaked into the report" \
  || ok "finding text never reaches the report"
[ "$(q "$(OUT "$P")" 'r.run.outcome')" = "completed" ] && ok "review run with a round comment → completed" \
  || bad "review outcome=$(q "$(OUT "$P")" 'r.run.outcome')"

P=$(mkproj review-gh)
marker "$P" review deliberate "#42 --fable" 'null' '[]'
rm -f "$FAKE_GH_ARGS"
review_report --project "$P" >/dev/null
[ "$(cat "$FAKE_GH_ARGS" 2>/dev/null)" = "pr view 42 --json comments,reviews" ] && ok "review run asks gh for the target PR" \
  || bad "gh args: $(cat "$FAKE_GH_ARGS" 2>/dev/null)"
got=$(q "$(OUT "$P")" '[r.review.rounds,r.review.verdict,r.review.findings.length].join(" ")')
[ "$got" = "2 APPROVE 1" ] && ok "gh comments and reviews merge oldest-first; issue-comment round → its verdict line" \
  || bad "gh review: $got"

P=$(mkproj review-gh-build)
marker "$P" build deliberate "EPIC-7" 'null' '[]'
rm -f "$FAKE_GH_ARGS"
review_report --project "$P" >/dev/null
[ "$(cat "$FAKE_GH_ARGS" 2>/dev/null)" = "pr view --json comments,reviews" ] && ok "build run asks gh for the current branch's PR" \
  || bad "gh args: $(cat "$FAKE_GH_ARGS" 2>/dev/null)"

P=$(mkproj review-gh-fails)
marker "$P" build deliberate "EPIC-7" 'null' '[]'
RUN_REPORT_GH="$TMP/no-such-gh" report --project "$P" >/dev/null; rc=$?
got=$(q "$(OUT "$P")" '[r.review.rounds,r.review.verdict,r.review.findings].map(String).join(" ")+" "+r.degraded.includes("pr_comments")')
[ "$rc" -eq 0 ] && [ "$got" = "null null null true" ] && ok "gh unavailable → review fields null + pr_comments, exit 0" \
  || bad "gh unavailable: rc=$rc $got"

P=$(mkproj review-none)
marker "$P" review deliberate "42" 'null' '[]'
echo '[]' > "$TMP/empty-comments.json"
review_report --project "$P" --pr-comments "$TMP/empty-comments.json" >/dev/null
got=$(q "$(OUT "$P")" 'JSON.stringify(r.review)+" "+r.run.outcome')
[ "$got" = '{"rounds":0,"verdict":"NONE","findings":[]} aborted' ] && ok "PR with no review → rounds 0, verdict NONE, not omitted" \
  || bad "no review: $got"

P=$(mkproj review-plan)
marker "$P" plan deliberate "x" '"backlog/EPIC-7.md"' '[]'
rm -f "$FAKE_GH_ARGS"
review_report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'JSON.stringify(r.review)')
[ "$got" = '{"rounds":0,"verdict":"NONE","findings":[]}' ] && [ ! -f "$FAKE_GH_ARGS" ] \
  && ok "plan run: review measured as none, gh never called" || bad "plan review: $got"

P=$(mkproj review-bad-file)
marker "$P" review deliberate "42" 'null' '[]'
echo '{"not":"an array"}' > "$TMP/bad-comments.json"
review_report --project "$P" --pr-comments "$TMP/bad-comments.json" >/dev/null
got=$(q "$(OUT "$P")" 'String(r.review.rounds)+" "+String(r.run.outcome)+" "+r.degraded.includes("pr_comments")')
[ "$got" = "null null true" ] && ok "unreadable --pr-comments → null + pr_comments" || bad "bad comments file: $got"

# ============================================================ stubs

echo "stub sections"
P=$(mkproj stubs)
marker "$P" plan deliberate "x" '"backlog/EPIC-7.md"' '[]'
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" '["gate_history","pr_comments","debt_ledger"].every(d=>r.degraded.includes(d))&&r.build.gate_runs===null&&r.debt.rows_logged===null')
[ "$got" = "true" ] && ok "stub sections are null with their inputs named" || bad "stub sections not degraded correctly"

# =================================================================== debt

echo "debt section"
D="$F/debt"

P=$(mkproj debt-new-entries)
marker "$P" build deliberate "EPIC-7" 'null' '[]'
mkdir -p "$P/docs"
cp "$D/ledger.md" "$P/docs/TOOLING-DEBT.md"
node -e 'const fs=require("fs"),p=process.argv[1],m=JSON.parse(fs.readFileSync(p));m.debt_snapshot=1;fs.writeFileSync(p,JSON.stringify(m))' \
  "$P/.agentic-sdlc/run-state.json"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" '[r.debt.rows_logged,JSON.stringify(r.debt.by_risk),JSON.stringify(r.debt.by_category)].join(" ")')
want='4 {"LOW":1,"MEDIUM":1,"HIGH":1} {"missing_test":1,"hardcoded_value":1,"stubbed_integration":0,"deferred_migration":0,"robustness":0,"observability":0,"other":2}'
[ "$got" = "$want" ] && ok "4 new entries since snapshot=1: by_risk counts the enum, stale Risk excluded; by_category via toCategory" \
  || bad "debt diff: $got"

P=$(mkproj debt-no-new-entries)
marker "$P" build deliberate "EPIC-7" 'null' '[]'
mkdir -p "$P/docs"
cp "$D/ledger.md" "$P/docs/TOOLING-DEBT.md"
node -e 'const fs=require("fs"),p=process.argv[1],m=JSON.parse(fs.readFileSync(p));m.debt_snapshot=5;fs.writeFileSync(p,JSON.stringify(m))' \
  "$P/.agentic-sdlc/run-state.json"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" '[r.debt.rows_logged,JSON.stringify(r.debt.by_risk),r.degraded.includes("debt_ledger")].join(" ")')
[ "$got" = '0 {"LOW":0,"MEDIUM":0,"HIGH":0} false' ] && ok "a run that logs no debt reads rows_logged=0, not omitted (AC 3)" \
  || bad "no-new-debt: $got"

P=$(mkproj debt-missing-ledger)
marker "$P" build deliberate "EPIC-7" 'null' '[]'
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" '[String(r.debt.rows_logged),String(r.debt.by_risk),String(r.debt.by_category),r.degraded.includes("debt_ledger")].join(" ")')
[ "$got" = "null null null true" ] && ok "no ledger file → debt fields null + debt_ledger" || bad "missing ledger: $got"

P=$(mkproj debt-no-section)
marker "$P" build deliberate "EPIC-7" 'null' '[]'
mkdir -p "$P/docs"
cp "$D/ledger-no-section.md" "$P/docs/TOOLING-DEBT.md"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'String(r.debt.rows_logged)+" "+r.degraded.includes("debt_ledger")')
[ "$got" = "null true" ] && ok "ledger without a \"Logged by agents\" heading → degraded debt_ledger, same as missing" \
  || bad "no-section ledger: $got"

P=$(mkproj debt-rewritten-ledger)
marker "$P" build deliberate "EPIC-7" 'null' '[]'
mkdir -p "$P/docs"
cp "$D/ledger.md" "$P/docs/TOOLING-DEBT.md"
node -e 'const fs=require("fs"),p=process.argv[1],m=JSON.parse(fs.readFileSync(p));m.debt_snapshot=9;fs.writeFileSync(p,JSON.stringify(m))' \
  "$P/.agentic-sdlc/run-state.json"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'String(r.debt.rows_logged)+" "+r.degraded.includes("debt_ledger")')
[ "$got" = "null true" ] && ok "current ### count < snapshot (ledger rewritten) → degraded debt_ledger, never negative" \
  || bad "rewritten ledger: $got"

P=$(mkproj debt-null-snapshot)
marker "$P" build deliberate "EPIC-7" 'null' '[]'
mkdir -p "$P/docs"
cp "$D/ledger.md" "$P/docs/TOOLING-DEBT.md"
node -e 'const fs=require("fs"),p=process.argv[1],m=JSON.parse(fs.readFileSync(p));m.debt_snapshot=null;fs.writeFileSync(p,JSON.stringify(m))' \
  "$P/.agentic-sdlc/run-state.json"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'String(r.debt.rows_logged)+" "+r.degraded.includes("run_state")')
[ "$got" = "null true" ] && ok "marker debt_snapshot null → can't diff → degraded run_state" || bad "null snapshot: $got"

# =================================================================== cost

echo "cost section"
P=$(mkproj cost)
marker "$P" plan deliberate "x" '"backlog/EPIC-7.md"' '[]'
cp "$F/meter-record.json" "$P/.agentic-sdlc/meter/a.json"
report --project "$P" >/dev/null
got=$(node -e '
  const fs=require("fs"),r=JSON.parse(fs.readFileSync(process.argv[1])),m=JSON.parse(fs.readFileSync(process.argv[2]))
  process.stdout.write(String(JSON.stringify(r.cost)===JSON.stringify({schema:m.schema,totals:m.totals,derived:m.derived})))
' "$(OUT "$P")" "$F/meter-record.json")
[ "$got" = "true" ] && ok "cost == meter record's schema/totals/derived, verbatim" || bad "cost differs from the meter record"
grep -q 'secret-branch\|by_agent\|a1b2c3\|claude-opus' "$(OUT "$P")" && bad "meter free-string fields leaked into the report" \
  || ok "label/by_agent/by_model/spawns are never embedded"

P=$(mkproj cost-newest)
marker "$P" plan deliberate "x" '"backlog/EPIC-7.md"' '[]'
node -e 'const m=require(process.argv[1]);m.totals.output=1;require("fs").writeFileSync(process.argv[2],JSON.stringify(m))' \
  "$F/meter-record.json" "$P/.agentic-sdlc/meter/older.json"
touch -t 202101010000 "$P/.agentic-sdlc/meter/older.json"
cp "$F/meter-record.json" "$P/.agentic-sdlc/meter/newer.json"
report --project "$P" >/dev/null
[ "$(q "$(OUT "$P")" 'r.cost.totals.output')" = "9000" ] && ok "the newest meter record wins" || bad "picked an older meter record"

P=$(mkproj cost-stale)
marker "$P" plan deliberate "x" '"backlog/EPIC-7.md"' '[]'
cp "$F/meter-record.json" "$P/.agentic-sdlc/meter/old.json"
touch -t 201901010000 "$P/.agentic-sdlc/meter/old.json"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'String(r.cost)+" "+r.degraded.includes("meter_record")')
[ "$got" = "null true" ] && ok "a record older than the run's start is not this run's cost" || bad "stale record: $got"

P=$(mkproj cost-stringy)
marker "$P" plan deliberate "x" '"backlog/EPIC-7.md"' '[]'
cp "$F/meter-stringy.json" "$P/.agentic-sdlc/meter/"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'String(r.cost)+" "+r.degraded.includes("meter_record")')
[ "$got" = "null true" ] && ok "a meter record with a string value is refused, not embedded" || bad "stringy record: $got"

P=$(mkproj cost-flag)
report --project "$P" --backlog "$P/backlog/EPIC-7.md" --meter "$F/meter-record.json" --out "$TMP/flag.json" >/dev/null
[ "$(q "$TMP/flag.json" 'r.cost.totals.usd+" "+r.plan.stories')" = "0.37425 3" ] \
  && ok "--backlog and --meter name the inputs explicitly" || bad "explicit inputs ignored"

# ================================================== degraded inputs (AC 3)

echo "degraded inputs"
P=$(mkproj no-meter)
marker "$P" plan deliberate "x" '"backlog/EPIC-7.md"' '[]'
report --project "$P" >/dev/null; rc=$?
got=$(q "$(OUT "$P")" 'String(r.cost)+" "+JSON.stringify(r.degraded.filter(d=>d==="meter_record"))')
[ "$rc" -eq 0 ] && [ "$got" = 'null ["meter_record"]' ] && ok "no meter record → cost null + meter_record, exit 0" \
  || bad "no meter record: rc=$rc $got"

P=$(mkproj unreadable-backlog)
mkdir "$P/backlog/EPIC-9.md"
marker "$P" plan deliberate "x" '"backlog/EPIC-9.md"' '[]'
report --project "$P" >/dev/null; rc=$?
got=$(q "$(OUT "$P")" '[r.plan.epics,r.plan.stories,r.plan.tasks,r.plan.arch_handoffs,r.run.outcome].map(String).join(" ")+" "+r.degraded.includes("backlog_file")')
[ "$rc" -eq 0 ] && [ "$got" = "null null null null null true" ] \
  && ok "unreadable backlog → plan fields null (not 0) + backlog_file" || bad "unreadable backlog: rc=$rc $got"

P=$(mkproj missing-backlog)
marker "$P" build deliberate "EPIC-404" 'null' '[]'
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'String(r.plan.stories)+" "+r.degraded.includes("backlog_file")')
[ "$got" = "null true" ] && ok "missing backlog file → null + backlog_file" || bad "missing backlog: $got"

P=$(mkproj every-degraded)
marker "$P" plan deliberate "x" '"backlog/EPIC-9.md"' '[]'
report --project "$P" >/dev/null
got=$(node --input-type=module -e '
  import { DEGRADED_INPUT } from "'"$ROOT"'/plugins/agentic-sdlc/scripts/run-report-categories.mjs"
  const r = JSON.parse((await import("node:fs")).readFileSync(process.argv[1], "utf8"))
  process.stdout.write(String(r.degraded.length > 0 && r.degraded.every((d) => DEGRADED_INPUT.includes(d))))
' "$(OUT "$P")")
[ "$got" = "true" ] && ok "every degraded entry is a degraded_input token, never prose" || bad "degraded has non-vocabulary entries"

P=$(mkproj no-marker)
node "$R" report --project "$P" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ ! -d "$P/.agentic-sdlc/runs" ] && ok "no marker → nothing written, exit 0" || bad "no marker: rc=$rc"
node "$R" report --project "$P" --out "$TMP/nomarker.json" >/dev/null 2>&1
got=$(q "$TMP/nomarker.json" '[r.run.run_id,r.run.command,r.run.wall_clock_s].map(String).join(" ")+" "+r.degraded.includes("run_state")')
[ "$got" = "null null null true" ] && ok "no marker + --out → run fields null + run_state" || bad "no marker --out: $got"

P=$(mkproj bad-marker)
echo '{"run_id":"'"$RUN_ID"'","command":"plan","target":"x","started_at":"2020-01-01T00:00:00Z","sessions":1,"wall_clock_s_prior":0,"arch_snapshot":[],"debt_snapshot":0,"backlog":null}' \
  > "$P/.agentic-sdlc/run-state.json"
report --project "$P" >/dev/null
got=$(q "$(OUT "$P")" 'String(r.run.lane)+" "+r.run.command+" "+r.degraded.includes("run_state")')
[ "$got" = "null plan true" ] && ok "incomplete marker → that field null + run_state, rest kept" || bad "incomplete marker: $got"

mkdir -p "$TMP/bare/scripts"
cp "$ROOT/plugins/agentic-sdlc/scripts/run-report.mjs" "$ROOT/plugins/agentic-sdlc/scripts/run-report-categories.mjs" "$TMP/bare/scripts/"
P=$(mkproj no-plugin-json)
marker "$P" plan deliberate "x" '"backlog/EPIC-7.md"' '[]'
node "$TMP/bare/scripts/run-report.mjs" report --project "$P" --now "$NOW" >/dev/null 2>&1
got=$(q "$(OUT "$P")" 'String(r.run.plugin_version)+" "+r.degraded.includes("plugin_version")')
[ "$got" = "null true" ] && ok "unreadable plugin.json → plugin_version null + plugin_version" || bad "plugin_version: $got"

# =================================================== schema bounds (AC 4)

echo "schema"
got=$(node --input-type=module -e '
  import { REPORT_SCHEMA, PATTERNS, validate } from "'"$R"'"
  const fs = await import("node:fs")
  const base = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  const fails = []
  const LEAF = new Set(["const", "enum", "number", "pattern", "countMap", "numericRecord"])
  const patterns = []
  // Walk the declarative schema: every leaf must be a bounded type.
  const walk = (spec, path) => {
    if (spec.type === "object") return Object.entries(spec.fields).forEach(([k, s]) => walk(s, `${path}.${k}`))
    if (spec.type === "array") return walk(spec.items, `${path}[]`)
    if (!LEAF.has(spec.type)) fails.push(`${path} has unbounded type ${spec.type}`)
    if (spec.type === "pattern") patterns.push(path)
  }
  walk(REPORT_SCHEMA, "$")
  if (patterns.join() !== "$.run.run_id,$.run.plugin_version,$.run.ended_at") fails.push(`patterns: ${patterns}`)
  if (Object.keys(PATTERNS).length !== 3) fails.push("more than three patterns exported")
  if (validate(base).length) fails.push(`base invalid: ${validate(base)}`)
  // Stuff a long string into every field of the run, plan and cost sections.
  const LONG = "src/secret/" + "x".repeat(10000)
  const clone = () => JSON.parse(JSON.stringify(base))
  for (const sec of ["run", "plan", "cost"]) {
    for (const k of Object.keys(base[sec])) {
      const r = clone(); r[sec][k] = LONG
      if (!validate(r).length) fails.push(`${sec}.${k} accepted a long string`)
    }
  }
  const tries = {
    "count-map key": (r) => { r.plan.arch_handoffs[LONG] = 1 },
    "count-map value": (r) => { r.plan.arch_handoffs.other = LONG },
    "totals value": (r) => { r.cost.totals.input = LONG },
    "totals key": (r) => { r.cost.totals[LONG] = 1 },
    "derived nested string": (r) => { r.cost.derived.x = { y: LONG } },
    "unknown run field": (r) => { r.run.branch = "x" },
    "unknown top field": (r) => { r.note = 1 },
    "missing section": (r) => { delete r.plan },
    "degraded prose": (r) => { r.degraded.push("meter record missing") },
    "null with empty degraded": (r) => { r.degraded = []; },
  }
  for (const [name, mutate] of Object.entries(tries)) {
    const r = clone(); mutate(r)
    if (!validate(r).length) fails.push(`accepted: ${name}`)
  }
  process.stdout.write(fails.length ? fails.join("\n") : "ok")
' "$TMP/flag.json")
[ "$got" = "ok" ] && ok "every schema leaf is bounded; long strings, unknown fields and prose are rejected" \
  || bad "schema bounds: $got"

printf '{"schema":1}\n' > "$TMP/partial.json"
node "$R" validate "$TMP/partial.json" >/dev/null 2>&1 && bad "validate accepted a report missing sections" \
  || ok "validate CLI rejects a report missing sections (exit non-zero)"

# ===== leak-proof (STORY-1-7): schema-driven, not fixture-driven ==========
#
# AC1/2 ask for coverage of the schema's full field list, not of whatever a
# fixture happens to populate — build/review/debt are stubs today and gain
# real fields in later stories. leak/synthesize-and-mutate.mjs walks
# REPORT_SCHEMA itself, synthesizes one minimal valid report, and mutates
# every leaf it finds (plus countMap/numericRecord keys and values, and a
# pattern-anchoring check); a field added to the schema without a bounded
# type is caught here even before any fixture exercises it.

echo "leak-proofing (schema-driven)"
LEAK_OUT=$(node "$F/leak/synthesize-and-mutate.mjs" "$R" "$ROOT/plugins/agentic-sdlc/scripts/run-report-categories.mjs" 2>&1)
if [ "$LEAK_OUT" = "ok" ]; then
  ok "every schema leaf (incl. nested object/array/countMap/numericRecord) rejects a stuffed string; pattern fields reject an anchored substring; unknown fields rejected; enum/countMap vocab names resolve"
else
  bad "leak-proofing failed:"
  printf '%s\n' "$LEAK_OUT" >&2
fi

[ "$fail" -eq 0 ] && printf '\nrun-report: all invariants hold\n' || { printf '\nrun-report: FAILED\n' >&2; exit 1; }
