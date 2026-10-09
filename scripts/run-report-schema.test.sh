#!/usr/bin/env bash
#
# run-report-schema.test.sh — the schema module is shared with the ingest
# Worker, so it must stay pure: a node: import would break the Worker bundle,
# and a second copy of the walk would let client and edge disagree.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$ROOT/plugins/agentic-sdlc/scripts"
FIX="$ROOT/scripts/fixtures/ingest/valid-report.json"

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

[ -f "$S/run-report-schema.mjs" ] || { bad "run-report-schema.mjs exists"; exit 1; }

for f in run-report-schema.mjs run-report-categories.mjs; do
  if grep -Eq "(from|import)[ (]*['\"]node:" "$S/$f"; then
    bad "$f has no static node: import"
  else
    ok "$f has no static node: import"
  fi
done

res=$(node --input-type=module - "$S" "$FIX" <<'JS' 2>&1
import { readFileSync } from 'node:fs'
const [dir, fix] = process.argv.slice(2)
const schema = await import(`${dir}/run-report-schema.mjs`)
const rr = await import(`${dir}/run-report.mjs`)
const report = JSON.parse(readFileSync(fix, 'utf8'))
const errs = []
if (typeof schema.validate !== 'function' || !schema.REPORT_SCHEMA) errs.push('schema exports validate and REPORT_SCHEMA')
else {
  if (schema.validate(report).length) errs.push('fixture validates clean: ' + schema.validate(report).join('; '))
  const bad = (m) => { const r = structuredClone(report); m(r); return schema.validate(r).length > 0 }
  if (!bad((r) => { r.schema = 2 })) errs.push('unknown schema version rejected')
  if (!bad((r) => { r.run.command = 'nope' })) errs.push('unknown enum rejected')
  if (!bad((r) => { r.extra = 1 })) errs.push('unknown field rejected')
  if (!bad((r) => { r.run.run_id = 'x'.repeat(5000) })) errs.push('unbounded string rejected')
}
if (rr.validate !== schema.validate) errs.push('run-report.mjs reuses the shared validate')
if (rr.REPORT_SCHEMA !== schema.REPORT_SCHEMA) errs.push('run-report.mjs reuses the shared REPORT_SCHEMA')
console.log(JSON.stringify(errs))
JS
)
if [ "$res" = "[]" ]; then ok "schema module validates and run-report.mjs shares it"; else bad "schema module: $res"; fi

if node "$S/run-report-categories.mjs" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8")).command' >/dev/null 2>&1; then
  ok "categories CLI still prints the vocabulary"
else
  bad "categories CLI still prints the vocabulary"
fi

exit $fail
