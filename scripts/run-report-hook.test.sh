#!/usr/bin/env bash
#
# run-report-hook.test.sh — the invariants run-report.sh (the hook, not
# run-report.mjs — see run-report.test.sh for that) exists to guarantee:
#
#   * UserPromptSubmit writes ABSOLUTELY NOTHING to stdout on any path — that
#     event's stdout is injected straight into the model's context, so a leak
#     here is not cosmetic, it is the model reading noise as if it typed it;
#   * SessionEnd returns in well under its 1.5s shared budget, because the
#     report build it kicks off is spawned DETACHED, never awaited;
#   * node missing degrades exactly like meter.sh: exit 0, nothing written,
#     empty stdout;
#   * a run that spans two sessions under the same command+target rebuilds the
#     SAME run file with sessions incremented — one run, one file;
#   * a different command finalizes the old run's report before starting a new
#     run_id — ARCH-4's "amended by full rebuild" extended to the hook boundary;
#   * run-report.mjs is resolved in the documented order (override, cache
#     highest version, marketplace clone), the analogue of meter.test.sh's
#     section 8.
#
# Bash, because the plugin repo has no test runner (see pair-log.test.sh). Run
# with /bin/bash explicitly: macOS ships bash 3.2, and `set -u` aborts on
# "${arr[@]}" over an empty array — this script and the hook under test both
# avoid arrays rather than rely on the fixed form everywhere.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/templates/hooks/run-report.sh"
RR="$ROOT/plugins/agentic-sdlc/scripts/run-report.mjs"
# The physical path, not the (on macOS) symlinked one mktemp hands back:
# node's ESM loader resolves import.meta.url through realpath, so a stub
# script's self-reported path would otherwise never byte-match $TMP/xxx.
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

# q <file> <js-expression-on-r> — print one value from a JSON file.
q() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }

# project <name> — a fresh project directory for one case.
project() { local p="$TMP/$1"; mkdir -p "$p"; printf '%s' "$p"; }

# run_hook <event-json> [env…] — feed a payload to the hook under /bin/bash,
# capturing stdout and the elapsed wall time in milliseconds.
HOOK_STDOUT=""
HOOK_MS=0
run_hook() {
  local payload="$1"; shift
  local start end
  start=$(date +%s%N)
  HOOK_STDOUT="$(printf '%s' "$payload" | env "$@" /bin/bash "$HOOK")"
  end=$(date +%s%N)
  HOOK_MS=$(( (end - start) / 1000000 ))
}

# marker_json <project> <event> <session> [prompt] — the payload body.
payload() {
  local event="$1" project="$2" session="$3" prompt="${4:-}"
  node -e '
    const [event, project, session, prompt] = process.argv.slice(1)
    const o = { hook_event_name: event, cwd: project, session_id: session }
    if (prompt !== undefined && prompt !== "") o.prompt = prompt
    process.stdout.write(JSON.stringify(o))
  ' "$event" "$project" "$session" "$prompt"
}

# wait_for <file> — poll up to 5s for a path to exist (the detached SessionEnd
# spawn writes asynchronously).
wait_for() {
  for _ in $(seq 1 50); do
    [ -e "$1" ] && return 0
    sleep 0.1
  done
  return 1
}

# ============================================================== UserPromptSubmit

echo "UserPromptSubmit"

P=$(project non-pipeline)
run_hook "$(payload UserPromptSubmit "$P" s1 'how do I use git rebase')" RUN_REPORT_MJS="$RR"
[ -z "$HOOK_STDOUT" ] && ok "non-pipeline prompt: stdout empty" || bad "non-pipeline prompt wrote stdout: '$HOOK_STDOUT'"
[ ! -e "$P/.agentic-sdlc" ] && ok "non-pipeline prompt: no marker written" || bad "non-pipeline prompt wrote .agentic-sdlc"

P=$(project pipeline-build)
run_hook "$(payload UserPromptSubmit "$P" s1 '/agentic-sdlc:build EPIC-7')" RUN_REPORT_MJS="$RR"
[ -z "$HOOK_STDOUT" ] && ok "pipeline prompt: stdout empty" || bad "pipeline prompt wrote stdout: '$HOOK_STDOUT'"
M="$P/.agentic-sdlc/run-state.json"
[ -f "$M" ] && ok "pipeline prompt: marker written" || bad "pipeline prompt: no marker at $M"
got=$(q "$M" '[r.command,r.target,r.sessions].join(" ")')
[ "$got" = "build EPIC-7 1" ] && ok "marker fields match the prompt" || bad "marker fields: $got"

for cmd in plan review; do
  P=$(project "pipeline-$cmd")
  run_hook "$(payload UserPromptSubmit "$P" s1 "/agentic-sdlc:$cmd x")" RUN_REPORT_MJS="$RR"
  [ -z "$HOOK_STDOUT" ] && [ -f "$P/.agentic-sdlc/run-state.json" ] \
    && ok "/agentic-sdlc:$cmd recognized, stdout still empty" || bad "/agentic-sdlc:$cmd not recognized"
done

# A prompt that merely CONTAINS one of the slash commands, but does not start
# with it, is not a pipeline run — the prefix check is anchored, not a substring test.
P=$(project embedded-not-prefix)
run_hook "$(payload UserPromptSubmit "$P" s1 'please run /agentic-sdlc:build EPIC-7 for me')" RUN_REPORT_MJS="$RR"
[ -z "$HOOK_STDOUT" ] && [ ! -e "$P/.agentic-sdlc" ] \
  && ok "embedded (non-prefix) mention of a pipeline command is ignored" || bad "embedded mention wrongly recognized"

# ===================================================================== SessionEnd

echo "SessionEnd"

P=$(project no-marker-sessionend)
run_hook "$(payload SessionEnd "$P" s1)" RUN_REPORT_MJS="$RR"
[ -z "$HOOK_STDOUT" ] && [ "$HOOK_MS" -lt 1500 ] && [ ! -e "$P/.agentic-sdlc" ] \
  && ok "SessionEnd with no marker: stdout empty, fast (${HOOK_MS}ms), nothing written" \
  || bad "SessionEnd no-marker: stdout='$HOOK_STDOUT' ms=$HOOK_MS"

P=$(project sessionend-report)
run_hook "$(payload UserPromptSubmit "$P" s1 '/agentic-sdlc:build EPIC-7')" RUN_REPORT_MJS="$RR"
RID=$(q "$P/.agentic-sdlc/run-state.json" 'r.run_id')
run_hook "$(payload SessionEnd "$P" s1)" RUN_REPORT_MJS="$RR"
[ -z "$HOOK_STDOUT" ] && ok "SessionEnd: stdout empty" || bad "SessionEnd wrote stdout: '$HOOK_STDOUT'"
[ "$HOOK_MS" -lt 1500 ] && ok "SessionEnd returns well under its 1.5s shared budget (${HOOK_MS}ms)" \
  || bad "SessionEnd took ${HOOK_MS}ms — not detached"
OUT="$P/.agentic-sdlc/runs/$RID.json"
wait_for "$OUT" && ok "detached spawn eventually writes the run report" || bad "no report appeared within 5s at $OUT"
node "$RR" validate "$OUT" >/dev/null 2>&1 && ok "the written report validates" || bad "written report is invalid"

# =============================================================== multi-session

echo "multi-session continuation"

P=$(project two-sessions)
run_hook "$(payload UserPromptSubmit "$P" sess-A '/agentic-sdlc:build EPIC-7')" RUN_REPORT_MJS="$RR"
RID=$(q "$P/.agentic-sdlc/run-state.json" 'r.run_id')
run_hook "$(payload SessionEnd "$P" sess-A)" RUN_REPORT_MJS="$RR"
wait_for "$P/.agentic-sdlc/runs/$RID.json"
run_hook "$(payload UserPromptSubmit "$P" sess-B '/agentic-sdlc:build EPIC-7')" RUN_REPORT_MJS="$RR"
RID2=$(q "$P/.agentic-sdlc/run-state.json" 'r.run_id')
[ "$RID" = "$RID2" ] && ok "same command+target, new session → same run_id" || bad "run_id changed: $RID -> $RID2"
run_hook "$(payload SessionEnd "$P" sess-B)" RUN_REPORT_MJS="$RR"
wait_for "$P/.agentic-sdlc/runs/$RID2.json" && \
  for _ in $(seq 1 50); do [ "$(q "$P/.agentic-sdlc/runs/$RID2.json" 'r.run.sessions')" = "2" ] && break; sleep 0.1; done
got=$(q "$P/.agentic-sdlc/runs/$RID2.json" 'r.run.sessions')
[ "$got" = "2" ] && ok "second session's report: run.sessions incremented to 2, one file" || bad "sessions after 2nd session: $got"
got=$(ls "$P/.agentic-sdlc/runs" | wc -l | tr -d ' ')
[ "$got" = "1" ] && ok "exactly one run file across both sessions" || bad "runs dir has $got files, want 1"

echo "command change finalizes the old run"

P=$(project command-change)
run_hook "$(payload UserPromptSubmit "$P" sess-A '/agentic-sdlc:build EPIC-7')" RUN_REPORT_MJS="$RR"
OLD_RID=$(q "$P/.agentic-sdlc/run-state.json" 'r.run_id')
run_hook "$(payload UserPromptSubmit "$P" sess-B '/agentic-sdlc:review 42')" RUN_REPORT_MJS="$RR"
NEW_RID=$(q "$P/.agentic-sdlc/run-state.json" 'r.run_id')
[ "$NEW_RID" != "$OLD_RID" ] && ok "a different command gets a fresh run_id" || bad "run_id did not change on command switch"
[ -f "$P/.agentic-sdlc/runs/$OLD_RID.json" ] && ok "the superseded run's report was written at the command boundary" \
  || bad "no report for superseded run $OLD_RID"
[ "$(q "$P/.agentic-sdlc/run-state.json" 'r.command')" = "review" ] \
  && ok "new marker reflects the new command" || bad "marker still shows the old command"

# ======================================================= every path exits 0

echo "exit code"

for payload_args in "UserPromptSubmit s1 'hello'" "UserPromptSubmit s1 '/agentic-sdlc:build EPIC-7'" "SessionEnd s1 ''" "RandomEvent s1 ''"; do
  eval "set -- $payload_args"
  P=$(project "exit0-$1-$RANDOM")
  printf '%s' "$(payload "$1" "$P" "$2" "$3")" | RUN_REPORT_MJS="$RR" /bin/bash "$HOOK" >/dev/null 2>&1
  rc=$?
  [ "$rc" -eq 0 ] && ok "$1 exits 0" || bad "$1 exited $rc"
done

# ================================================================== degrade

echo "degrade: node missing"

BIN="$TMP/minimal-bin"
mkdir -p "$BIN"
for b in bash sh cat mktemp printf rm ls sort tail cut head sleep date env dirname basename; do
  p=$(command -v "$b" 2>/dev/null) && ln -sf "$p" "$BIN/$b"
done
P=$(project node-missing)
# The payload must be fully built BEFORE the pipe starts: the hook exits
# before ever reading stdin on this path (no node → no `input="$(cat)"`), so
# building it as the pipe's own first stage would race the hook's early exit
# against node's startup time and intermittently die to SIGPIPE.
json="$(payload UserPromptSubmit "$P" s1 '/agentic-sdlc:build EPIC-7')"
out=$(printf '%s' "$json" | PATH="$BIN" /bin/bash "$HOOK")
rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$P/.agentic-sdlc" ] \
  && ok "node missing: exit 0, empty stdout, nothing written" || bad "node-missing degrade: rc=$rc out='$out'"

# ========================================================== resolution order
#
# Mirrors meter.test.sh's section 8: a miss here is silent in production (the
# hook exits 0 and runs nothing), so pin the order. A stub run-report.mjs
# writes its own path; the test reads which one the hook ran.

echo "resolution order (RUN_REPORT_MJS, cache, marketplace)"

stub() { mkdir -p "$(dirname "$1")"; echo 'import{writeFileSync}from"fs";import{fileURLToPath}from"url";writeFileSync(process.env.MARK,fileURLToPath(import.meta.url))' > "$1"; }
H="$TMP/home"
P=$(project resolution)
run_resolve() {
  rm -f "$TMP/ran"
  printf '%s' "$(payload UserPromptSubmit "$P" "sess-$RANDOM" '/agentic-sdlc:build EPIC-7')" \
    | env -u CLAUDE_CONFIG_DIR "$@" HOME="$H" MARK="$TMP/ran" /bin/bash "$HOOK" 2>/dev/null
  cat "$TMP/ran" 2>/dev/null || true
}
stub "$H/.claude/plugins/marketplaces/sanimara/plugins/agentic-sdlc/scripts/run-report.mjs"
got=$(run_resolve -u RUN_REPORT_MJS)
[ "$got" = "$H/.claude/plugins/marketplaces/sanimara/plugins/agentic-sdlc/scripts/run-report.mjs" ] \
  && ok "falls back to the marketplace clone" || bad "marketplace fallback ran: '$got'"
stub "$H/.claude/plugins/cache/sanimara/agentic-sdlc/0.1.9/scripts/run-report.mjs"
stub "$H/.claude/plugins/cache/sanimara/agentic-sdlc/0.1.10/scripts/run-report.mjs"
got=$(run_resolve -u RUN_REPORT_MJS)
[ "$got" = "$H/.claude/plugins/cache/sanimara/agentic-sdlc/0.1.10/scripts/run-report.mjs" ] \
  && ok "picks the highest cached version (0.1.10 over 0.1.9)" || bad "cache resolution ran: '$got'"
stub "$TMP/override/run-report.mjs"
got=$(run_resolve RUN_REPORT_MJS="$TMP/override/run-report.mjs")
[ "$got" = "$TMP/override/run-report.mjs" ] && ok "RUN_REPORT_MJS overrides the installed copy" || bad "override ran: '$got'"
HE="$TMP/home-empty"
mkdir -p "$HE"
rm -f "$TMP/ran"
printf '%s' "$(payload UserPromptSubmit "$P" "sess-$RANDOM" '/agentic-sdlc:build EPIC-7')" \
  | env -u CLAUDE_CONFIG_DIR -u RUN_REPORT_MJS HOME="$HE" MARK="$TMP/ran" /bin/bash "$HOOK" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && [ ! -f "$TMP/ran" ] && ok "no run-report.mjs anywhere: exit 0, nothing run" || bad "unresolved rc=$rc"

[ "$fail" -eq 0 ] || { printf '\nrun-report hook tests failed\n' >&2; exit 1; }
printf '\nrun-report hook tests passed\n'
