#!/usr/bin/env bash
#
# mode-select-fields.test.sh — the invariants mode-select-fields.mjs exists to
# guarantee: one enum source (AC1), evidence mandatory on every field (AC2),
# a missing citation rejected (AC3), and one shape for a story or a FAST task
# (AC4, implicit — the module has no lane branch at all).
#
# Node, invoked from bash one-liners — this repo's existing *.test.sh style
# (see pair-log.test.sh), no extra test runner.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MSF="$ROOT/plugins/agentic-sdlc/scripts/mode-select-fields.mjs"

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }

# 1. Running the module directly prints the FIELDS spec as JSON, and that
#    spec is the only place risk_class's enum values live (AC1).
out=$(node "$MSF" 2>&1)
if echo "$out" | node -e "
  const spec = JSON.parse(require('fs').readFileSync(0, 'utf8'))
  const values = spec.risk_class && spec.risk_class.values
  if (!Array.isArray(values) || !values.includes('money') || !values.includes('none')) process.exit(1)
" ; then
  ok "running the module directly prints the FIELDS spec with risk_class enum values"
else
  bad "module did not print a usable FIELDS spec as JSON"
fi

VALID_LINE='- select: risk_class=none@AC1 one_way_doors=0@brief:L40 existing_pattern=yes@AC2 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@brief:L12'

# 2. A well-formed line round-trips: parse then format gives back the same line.
node --input-type=module -e "
  import { parse, format } from '$MSF'
  const line = '$VALID_LINE'
  const fields = parse(line)
  const out = format(fields)
  if (out !== line) { console.error('round trip mismatch:', out); process.exit(1) }
" 2>err.txt && ok "parse → format round-trips the compact line exactly" \
  || { bad "round trip failed: $(cat err.txt)"; }

# 3. validate() accepts a fully evidenced, well-typed field set.
node --input-type=module -e "
  import { validate } from '$MSF'
  const errors = validate({
    risk_class: { value: 'money', evidence: 'AC1' },
    one_way_doors: { value: 0, evidence: 'brief:L10' },
    existing_pattern: { value: true, evidence: 'AC2' },
    modules_crossed: { value: 2, evidence: 'brief:L5-L9' },
    review_bounced: { value: false, evidence: 'AC3' },
    risk_kind: { value: 'money' === 'none' ? 'code' : 'code', evidence: 'AC1' },
  })
  if (errors.length !== 0) { console.error(errors); process.exit(1) }
" 2>err.txt && ok "validate() accepts a fully evidenced field set" \
  || { bad "valid field set rejected: $(cat err.txt)"; }

# 4. AC3 — a field value with no evidence citation is rejected.
node --input-type=module -e "
  import { validate } from '$MSF'
  const errors = validate({
    risk_class: { value: 'none' },
    one_way_doors: { value: 0, evidence: 'brief:L40' },
    existing_pattern: { value: true, evidence: 'AC2' },
    modules_crossed: { value: 1, evidence: 'AC1' },
    review_bounced: { value: false, evidence: 'AC1' },
    risk_kind: { value: 'code', evidence: 'brief:L12' },
  })
  if (!errors.some(e => e.includes('risk_class') && e.includes('evidence'))) process.exit(1)
" && ok "a field value with no evidence citation is rejected" \
  || bad "missing-evidence field was not rejected"

# 5. A malformed citation (not brief:L<n> or AC<n>) is rejected, and a doubled
#    citation (more than one) is rejected too — "freestanding" or "two" both fail.
node --input-type=module -e "
  import { validate } from '$MSF'
  const bad1 = validate({
    risk_class: { value: 'none', evidence: 'because I said so' },
    one_way_doors: { value: 0, evidence: 'brief:L40' },
    existing_pattern: { value: true, evidence: 'AC2' },
    modules_crossed: { value: 1, evidence: 'AC1' },
    review_bounced: { value: false, evidence: 'AC1' },
    risk_kind: { value: 'code', evidence: 'brief:L12' },
  })
  const bad2 = validate({
    risk_class: { value: 'none', evidence: ['AC1', 'AC2'] },
    one_way_doors: { value: 0, evidence: 'brief:L40' },
    existing_pattern: { value: true, evidence: 'AC2' },
    modules_crossed: { value: 1, evidence: 'AC1' },
    review_bounced: { value: false, evidence: 'AC1' },
    risk_kind: { value: 'code', evidence: 'brief:L12' },
  })
  if (bad1.length === 0 || bad2.length === 0) process.exit(1)
" && ok "a malformed or multiple-citation evidence value is rejected" \
  || bad "malformed/multiple evidence was accepted"

# 6. AC4 — the schema has no lane branch: the same FIELDS/validate/parse apply
#    whether the line came from an EPIC story or a FAST task backlog file.
node --input-type=module -e "
  import { parse, FIELDS } from '$MSF'
  const epicLine = '$VALID_LINE'
  const fastLine = '$VALID_LINE'.replace('risk_class=none', 'risk_class=money')
  parse(epicLine)
  parse(fastLine)
  if (Object.keys(FIELDS).length !== 6) process.exit(1)
" && ok "the same schema and parser apply to an EPIC story line and a FAST task line" \
  || bad "schema diverged between an EPIC-shaped and FAST-shaped line"

# 7. An unknown field, a duplicate field, or a bad enum value in a line is
#    refused at parse time rather than silently dropped (AC1's "never a
#    second hardcoded value" implies parse must not invent a fallback either).
node --input-type=module -e "
  import { parse } from '$MSF'
  let threw = 0
  try { parse('- select: risk_class=not_a_value@AC1 one_way_doors=0@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@AC1') } catch { threw++ }
  try { parse('- select: bogus_field=1@AC1') } catch { threw++ }
  if (threw !== 2) process.exit(1)
" && ok "an unknown field or an out-of-enum value is refused at parse time" \
  || bad "parse accepted an unknown field or bad enum value"

# 8. findSelectLine() tells "no select line" (STORY-2-2's AC4 fallback) apart
#    from "a select line present but malformed" — the first returns null, the
#    second returns the line for parse() to then reject.
node --input-type=module -e "
  import { findSelectLine, parse } from '$MSF'
  const noLine = findSelectLine('### STORY-9-1: title\n\n- status: TODO\n- risk: none\n')
  if (noLine !== null) process.exit(1)
  const malformed = findSelectLine('### STORY-9-2: title\n\n- select: bogus_field=1@AC1\n')
  if (malformed === null) process.exit(1)
  let threw = false
  try { parse(malformed) } catch { threw = true }
  if (!threw) process.exit(1)
" && ok "findSelectLine() distinguishes an absent select line from a malformed one" \
  || bad "findSelectLine() did not distinguish absent from malformed"

rm -f err.txt

[ "$fail" -eq 0 ] || { printf '\nmode-select-fields tests failed\n' >&2; exit 1; }
printf '\nmode-select-fields tests passed\n'
