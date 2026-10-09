#!/usr/bin/env bash
#
# run-report-export-hook.test.sh — how run-report.sh wires report upload into the
# session lifecycle. export.mjs and export-identity.mjs are TRACING STUBS here:
# the hook's contract is which of them it invokes, in what order, detached, and
# — for opted-out or unanswered projects — that it never reaches them at all.
# The real upload is covered by export*.test.sh.
#
# Run under /bin/bash (3.2 on macOS), like the hook itself.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/templates/hooks/run-report.sh"
REAL="$ROOT/plugins/agentic-sdlc/scripts"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

now_ms() { node -e "process.stdout.write(String(Date.now()))"; }
q() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }

# The hook resolves siblings from run-report.mjs's directory, so the stub scripts
# dir symlinks every real script except the two it replaces with tracers.
SCRIPTS="$TMP/scripts"
mkdir -p "$SCRIPTS"
for f in "$REAL"/*.mjs; do
  case "$(basename "$f")" in export.mjs|export-identity.mjs) ;; *) ln -s "$f" "$SCRIPTS/$(basename "$f")" ;; esac
done
# Each tracer appends "<script> <argv…> | cwd=<cwd> | file-exists=<0|1>" to $TRACE,
# then sleeps $STUB_SLEEP seconds so a blocking hook is observable as wall time.
for s in export export-identity; do
  cat > "$SCRIPTS/$s.mjs" <<'EOF'
import { appendFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
const target = args.find((a) => a.endsWith('.json'))
const exists = target ? (existsSync(target) ? 1 : 0) : '-'
appendFileSync(process.env.TRACE, `${basename(fileURLToPath(import.meta.url))} ${args.join(' ')} | cwd=${process.cwd()} | file-exists=${exists}\n`)
await new Promise((r) => setTimeout(r, Number(process.env.STUB_SLEEP || 0) * 1000))
EOF
done
RR="$SCRIPTS/run-report.mjs"
TRACE="$TMP/trace"

# project <name> <share: true|false|unanswered> — a git project with consent set.
project() {
  local p="$TMP/$1"
  mkdir -p "$p"
  git -C "$p" init -q
  case "$2" in
    true|false) mkdir -p "$p/.claude"; printf '{"telemetry":{"share":%s}}' "$2" > "$p/.claude/agentic-sdlc.json" ;;
  esac
  printf '%s' "$p"
}

payload() {
  node -e '
    const [event, project, session, prompt] = process.argv.slice(1)
    const o = { hook_event_name: event, cwd: project, session_id: session }
    if (prompt) o.prompt = prompt
    process.stdout.write(JSON.stringify(o))
  ' "$1" "$2" "$3" "${4:-}"
}

HOOK_STDOUT=""
HOOK_MS=0
run_hook() {
  local body="$1"; shift
  local start end
  start=$(now_ms)
  HOOK_STDOUT="$(printf '%s' "$body" | env RUN_REPORT_MJS="$RR" TRACE="$TRACE" "$@" /bin/bash "$HOOK")"
  end=$(now_ms)
  HOOK_MS=$(( end - start ))
}

wait_for_lines() { # <file> <n>
  for _ in $(seq 1 80); do
    [ "$(wc -l < "$1" 2>/dev/null | tr -d ' ')" -ge "$2" ] 2>/dev/null && return 0
    sleep 0.1
  done
  return 1
}

# ======================================================= SessionEnd, share=true

echo "SessionEnd, opted in"

P=$(project opted-in true)
: > "$TRACE"
run_hook "$(payload UserPromptSubmit "$P" s1 '/agentic-sdlc:build EPIC-7')" STUB_SLEEP=0
RID=$(q "$P/.agentic-sdlc/run-state.json" 'r.run_id')
: > "$TRACE"
run_hook "$(payload SessionEnd "$P" s1)" STUB_SLEEP=4
[ -z "$HOOK_STDOUT" ] && ok "stdout empty" || bad "SessionEnd wrote stdout: '$HOOK_STDOUT'"
[ "$HOOK_MS" -lt 1500 ] && ok "returns within the shared budget while the chain still runs (${HOOK_MS}ms)" \
  || bad "hook blocked ${HOOK_MS}ms on the upload chain"
wait_for_lines "$TRACE" 2 && ok "chain ran both steps" || bad "chain did not reach enqueue and flush: $(cat "$TRACE" 2>/dev/null)"
REPORT="$P/.agentic-sdlc/runs/$RID.json"
first="$(sed -n 1p "$TRACE" 2>/dev/null)"
second="$(sed -n 2p "$TRACE" 2>/dev/null)"
[ "$first" = "export.mjs enqueue $REPORT | cwd=$P | file-exists=1" ] \
  && ok "enqueue gets this run's report, already written, from the project cwd" || bad "first step: '$first'"
case "$second" in
  "export.mjs flush --jitter-ms 10000 | cwd=$P"*) ok "flush follows with a 10s jitter" ;;
  *) bad "second step: '$second'" ;;
esac

# ================================== SessionEnd, share=false / unanswered

REC="$ROOT/scripts/connection-recorder.mjs"
PORTFILE="$TMP/port"; CONNFILE="$TMP/conns"
node "$REC" "$PORTFILE" "$CONNFILE" &
REC_PID=$!
trap 'kill "$REC_PID" 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in $(seq 1 50); do [ -s "$PORTFILE" ] && break; sleep 0.1; done
URL="http://127.0.0.1:$(cat "$PORTFILE")"

# end_session <project> — a run that finishes, with the report awaited so "nothing
# traced" means the chain was never entered rather than not yet reached.
end_session() {
  : > "$TRACE"
  run_hook "$(payload UserPromptSubmit "$1" s1 '/agentic-sdlc:build EPIC-7')" STUB_SLEEP=0 AGENTIC_SDLC_EXPORT_URL="$URL"
  local rid; rid=$(q "$1/.agentic-sdlc/run-state.json" 'r.run_id')
  run_hook "$(payload SessionEnd "$1" s1)" STUB_SLEEP=0 AGENTIC_SDLC_EXPORT_URL="$URL"
  for _ in $(seq 1 80); do [ -s "$1/.agentic-sdlc/runs/$rid.json" ] && break; sleep 0.1; done
  sleep 1
}

echo "SessionEnd, opted out with a stored token"
P=$(project revoking false)
GC="$(git -C "$P" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$GC/agentic-sdlc/export"; printf '{"token":"t"}' > "$GC/agentic-sdlc/export/token.json"
end_session "$P"
[ "$(cat "$TRACE")" = "export-identity.mjs revoke | cwd=$P | file-exists=-" ] \
  && ok "revoke runs once, and nothing is enqueued or flushed" || bad "trace: '$(cat "$TRACE")'"

echo "SessionEnd, opted out without a token"
P=$(project declined false)
end_session "$P"
[ ! -s "$TRACE" ] && ok "no upload script is invoked" || bad "trace: '$(cat "$TRACE")'"
[ ! -s "$CONNFILE" ] && ok "zero connections" || bad "connections: $(wc -l < "$CONNFILE")"

echo "SessionEnd, unanswered"
P=$(project unasked unanswered)
GC="$(git -C "$P" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$GC/agentic-sdlc/export"; printf '{"token":"t"}' > "$GC/agentic-sdlc/export/token.json"
end_session "$P"
[ ! -s "$TRACE" ] && ok "no upload script is invoked, even with a token present" || bad "trace: '$(cat "$TRACE")'"
[ ! -s "$CONNFILE" ] && ok "zero connections" || bad "connections: $(wc -l < "$CONNFILE")"

# ===================================================== SessionStart, share=true

# gc_export <project> — the per-clone export dir the hook pre-checks.
gc_export() { printf "%s/agentic-sdlc/export" "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)"; }

echo "SessionStart, opted in with a queued report"
P=$(project start-queued true)
mkdir -p "$(gc_export "$P")/queue"; printf "{}" > "$(gc_export "$P")/queue/r1.json"
: > "$TRACE"
run_hook "$(payload SessionStart "$P" s1)" STUB_SLEEP=4 AGENTIC_SDLC_EXPORT_URL="$URL"
[ -z "$HOOK_STDOUT" ] && ok "stdout empty" || bad "SessionStart wrote stdout: '$HOOK_STDOUT'"
[ "$HOOK_MS" -lt 1500 ] && ok "returns within the shared budget while flush still runs (${HOOK_MS}ms)" \
  || bad "SessionStart blocked ${HOOK_MS}ms on flush"
wait_for_lines "$TRACE" 1 && ok "flush ran" || bad "flush never ran"
case "$(cat "$TRACE")" in
  "export.mjs flush --jitter-ms 60000 | cwd=$P"*) ok "flush uses a 60s jitter and nothing is enqueued" ;;
  *) bad "trace: '$(cat "$TRACE")'" ;;
esac

echo "SessionStart, opted in with nothing queued and no token"
P=$(project start-idle true)
: > "$TRACE"
run_hook "$(payload SessionStart "$P" s1)" STUB_SLEEP=0 AGENTIC_SDLC_EXPORT_URL="$URL"
sleep 1
[ -z "$HOOK_STDOUT" ] && [ ! -s "$TRACE" ] && ok "pre-check exits before any export script" || bad "trace: '$(cat "$TRACE")'"

echo "SessionStart, opted out with a stored token"
P=$(project start-revoke false)
mkdir -p "$(gc_export "$P")"; printf '{"token":"t"}' > "$(gc_export "$P")/token.json"
: > "$TRACE"
run_hook "$(payload SessionStart "$P" s1)" STUB_SLEEP=0 AGENTIC_SDLC_EXPORT_URL="$URL"
wait_for_lines "$TRACE" 1 || true
sleep 1
[ -z "$HOOK_STDOUT" ] && ok "stdout empty" || bad "SessionStart wrote stdout: '$HOOK_STDOUT'"
[ "$(cat "$TRACE")" = "export-identity.mjs revoke | cwd=$P | file-exists=-" ] \
  && ok "revoke runs once, nothing is flushed" || bad "trace: '$(cat "$TRACE")'"

echo "SessionStart, opted out with a queue but no token"
P=$(project start-declined false)
mkdir -p "$(gc_export "$P")/queue"; printf "{}" > "$(gc_export "$P")/queue/r1.json"
: > "$TRACE"; : > "$CONNFILE"
run_hook "$(payload SessionStart "$P" s1)" STUB_SLEEP=0 AGENTIC_SDLC_EXPORT_URL="$URL"
sleep 1
[ ! -s "$TRACE" ] && [ ! -s "$CONNFILE" ] && ok "no script reached, zero connections" || bad "trace: '$(cat "$TRACE")'"

echo "SessionStart, unanswered with a queue and a token"
P=$(project start-unasked unanswered)
mkdir -p "$(gc_export "$P")/queue"; printf "{}" > "$(gc_export "$P")/queue/r1.json"
printf '{"token":"t"}' > "$(gc_export "$P")/token.json"
: > "$TRACE"; : > "$CONNFILE"
run_hook "$(payload SessionStart "$P" s1)" STUB_SLEEP=0 AGENTIC_SDLC_EXPORT_URL="$URL"
sleep 1
[ ! -s "$TRACE" ] && [ ! -s "$CONNFILE" ] && ok "no script reached, zero connections" || bad "trace: '$(cat "$TRACE")'"
[ -f "$(gc_export "$P")/queue/r1.json" ] && ok "queue left untouched" || bad "queue was modified"

# ============================================ SessionStart registration

echo "SessionStart registration"
for f in "$ROOT/templates/hooks/settings.hooks.json" "$ROOT/.claude/settings.json"; do
  n=$(node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    const cmds = (s.hooks.SessionStart || []).flatMap((e) => e.hooks.map((h) => h.command))
    process.stdout.write(String(cmds.filter((c) => c.includes("run-report.sh")).length))
  ' "$f")
  [ "$n" = "1" ] && ok "$(basename "$f") registers run-report.sh on SessionStart" || bad "$(basename "$f"): $n SessionStart run-report.sh entries"
done
grep -q 'RUN_REPORT_MJS=.*run-report.mjs.*templates/hooks/run-report.sh' <(node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  process.stdout.write(s.hooks.SessionStart.map((e) => e.hooks[0].command).join("\n"))' "$ROOT/.claude/settings.json") \
  && ok "this repo runs the template in place with RUN_REPORT_MJS" || bad "repo SessionStart entry lacks the in-place command form"
node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).$comment; process.exit(/SessionStart[^.]*run-report/.test(c)||/UserPromptSubmit\/SessionEnd\/SessionStart/.test(c)?0:1)' "$ROOT/templates/hooks/settings.hooks.json" \
  && ok "\$comment describes the SessionStart run-report role" || bad "\$comment does not mention run-report on SessionStart"

[ "$fail" -eq 0 ] || { printf '\nrun-report export hook tests failed\n' >&2; exit 1; }
printf '\nrun-report export hook tests passed\n'
