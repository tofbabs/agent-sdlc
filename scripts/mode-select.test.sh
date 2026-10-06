#!/usr/bin/env bash
#
# mode-select.test.sh — the decision mode-select.mjs must make: a versioned
# rubric score (ARCH-2 v1), hard floors that no score can override (AC1), a
# borderline band that resolves to the safer option (AC3), identical output for
# identical input (AC2), and thresholds that retune as a one-file data diff
# (AC4). Decisions are built on the STORY-2-1 field schema, imported, never
# re-hardcoded.
#
# Node one-liners from bash — this repo's existing *.test.sh style (see
# mode-select-fields.test.sh), no extra test runner.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MS="$ROOT/plugins/agentic-sdlc/scripts/mode-select.mjs"
MSF="$ROOT/plugins/agentic-sdlc/scripts/mode-select-fields.mjs"

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }

# 1. ARCH-2 rubric v1 score: modules_crossed ≤1→0, =2→+2, ≥3→+3; no existing
#    pattern→+2. No floor fires (risk none, zero doors, not bounced, code kind),
#    so the pure score is observable on its own.
node --input-type=module -e "
  import { parse } from '$MSF'
  import { decideStory } from '$MS'
  const cases = [
    ['yes', '1', 0],
    ['yes', '2', 2],
    ['yes', '3', 3],
    ['yes', '5', 3],
    ['no',  '1', 2],
    ['no',  '2', 4],
    ['no',  '3', 5],
  ]
  for (const [ep, mc, want] of cases) {
    const line = '- select: risk_class=none@AC1 one_way_doors=0@AC1 existing_pattern=' + ep + '@AC1 modules_crossed=' + mc + '@AC1 review_bounced=no@AC1 risk_kind=code@AC1'
    const got = decideStory(parse(line)).score
    if (got !== want) { console.error('mc=' + mc + ' ep=' + ep + ' want ' + want + ' got ' + got); process.exit(1) }
  }
" && ok "rubric v1 scores modules_crossed and existing_pattern per ARCH-2" \
  || bad "rubric v1 score is wrong"

# 2. Score→mode thresholds (ARCH-2 v1): ≥4 PAIR, ≤2 SOLO, =3 is the borderline
#    band that resolves to the safer option (PAIR) and is flagged. No floor
#    fires, so the mode comes purely from the score. Thresholds are rubric data,
#    not a literal in the script (AC4 retunes them without code).
node --input-type=module -e "
  import { parse } from '$MSF'
  import { decideStory } from '$MS'
  const cases = [
    ['yes', '1', 'SOLO', false],
    ['yes', '2', 'SOLO', false],
    ['yes', '3', 'PAIR', true],
    ['no',  '2', 'PAIR', false],
    ['no',  '3', 'PAIR', false],
  ]
  for (const [ep, mc, mode, borderline] of cases) {
    const line = '- select: risk_class=none@AC1 one_way_doors=0@AC1 existing_pattern=' + ep + '@AC1 modules_crossed=' + mc + '@AC1 review_bounced=no@AC1 risk_kind=code@AC1'
    const got = decideStory(parse(line))
    if (got.mode !== mode) { console.error('mc=' + mc + ' ep=' + ep + ' want mode ' + mode + ' got ' + got.mode); process.exit(1) }
    if (got.borderline !== borderline) { console.error('mc=' + mc + ' ep=' + ep + ' want borderline ' + borderline + ' got ' + got.borderline); process.exit(1) }
  }
" && ok "score→mode thresholds with borderline =3 resolving to PAIR (safer)" \
  || bad "score→mode thresholds or borderline band wrong"

# 3. risk_kind=data does not score (ARCH-2 v1): it routes a SOLO result to
#    SOLO-on-Opus, leaving the score untouched. A PAIR or borderline result is
#    already supervised, so data risk changes nothing there. No floor fires.
node --input-type=module -e "
  import { parse } from '$MSF'
  import { decideStory } from '$MS'
  const cases = [
    ['yes', '1', 'data', 'SOLO_OPUS', 0],
    ['yes', '2', 'data', 'SOLO_OPUS', 2],
    ['yes', '1', 'code', 'SOLO',      0],
    ['yes', '3', 'data', 'PAIR',      3],
    ['no',  '3', 'data', 'PAIR',      5],
  ]
  for (const [ep, mc, rk, mode, score] of cases) {
    const line = '- select: risk_class=none@AC1 one_way_doors=0@AC1 existing_pattern=' + ep + '@AC1 modules_crossed=' + mc + '@AC1 review_bounced=no@AC1 risk_kind=' + rk + '@AC1'
    const got = decideStory(parse(line))
    if (got.mode !== mode) { console.error('mc=' + mc + ' ep=' + ep + ' rk=' + rk + ' want mode ' + mode + ' got ' + got.mode); process.exit(1) }
    if (got.score !== score) { console.error('mc=' + mc + ' ep=' + ep + ' rk=' + rk + ' want score ' + score + ' got ' + got.score); process.exit(1) }
  }
" && ok "risk_kind=data lifts a SOLO result to SOLO_OPUS, score unchanged" \
  || bad "data-risk SOLO_OPUS routing wrong"

# 4. Hard floors (AC1): a one-way door, a review bounce, or a money/auth/
#    destructive_data risk class forces PAIR and names its floor token, no matter
#    what the score would be. Each case here scores SOLO on its own (mc=1,
#    pattern=yes → 0), so a PAIR result can only come from the floor. A floor also
#    beats the data-risk SOLO_OPUS routing. When no floor fires the token is null
#    and the score stands. Floor firing reports score null — the score never
#    decided it.
node --input-type=module -e "
  import { parse } from '$MSF'
  import { decideStory } from '$MS'
  const cases = [
    ['1', 'no',  'none',             'code', 'PAIR', 'one_way_door',  null],
    ['0', 'yes', 'none',             'code', 'PAIR', 'review_bounced', null],
    ['0', 'no',  'money',            'code', 'PAIR', 'risk_class',     null],
    ['0', 'no',  'auth',             'code', 'PAIR', 'risk_class',     null],
    ['0', 'no',  'destructive_data', 'code', 'PAIR', 'risk_class',     null],
    ['1', 'no',  'none',             'data', 'PAIR', 'one_way_door',  null],
    ['0', 'no',  'none',             'code', 'SOLO', null,             0],
  ]
  for (const [owd, rb, rc, rk, mode, floor, score] of cases) {
    const line = '- select: risk_class=' + rc + '@AC1 one_way_doors=' + owd + '@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=' + rb + '@AC1 risk_kind=' + rk + '@AC1'
    const got = decideStory(parse(line))
    if (got.mode !== mode) { console.error('owd=' + owd + ' rb=' + rb + ' rc=' + rc + ' want mode ' + mode + ' got ' + got.mode); process.exit(1) }
    if (got.floor !== floor) { console.error('owd=' + owd + ' rb=' + rb + ' rc=' + rc + ' want floor ' + floor + ' got ' + got.floor); process.exit(1) }
    if (got.score !== score) { console.error('owd=' + owd + ' rb=' + rb + ' rc=' + rc + ' want score ' + score + ' got ' + got.score); process.exit(1) }
  }
" && ok "hard floors force PAIR with a floor token, overriding any score (AC1)" \
  || bad "floor override or floor token wrong"

# 5. Output contract: every story return carries the rubric version (read from
#    the data file, so a retune that bumps the version is reflected without a
#    code change) and a one-line reason that names the firing floor token or the
#    score — so a consumer can log why, not just what. Covers a floor, a SOLO, a
#    borderline PAIR, a scored PAIR and the data-risk route.
node --input-type=module -e "
  import { readFileSync } from 'node:fs'
  import { parse } from '$MSF'
  import { decideStory } from '$MS'
  const RUBRIC = JSON.parse(readFileSync('$ROOT/plugins/agentic-sdlc/scripts/mode-select-rubric.json', 'utf8'))
  const mk = (o) => '- select: risk_class=' + (o.rc||'none') + '@AC1 one_way_doors=' + (o.owd||'0') + '@AC1 existing_pattern=' + (o.ep||'yes') + '@AC1 modules_crossed=' + (o.mc||'1') + '@AC1 review_bounced=' + (o.rb||'no') + '@AC1 risk_kind=' + (o.rk||'code') + '@AC1'
  const samples = [ {}, {mc:'3'}, {mc:'2',ep:'no'}, {rk:'data'}, {owd:'1'} ]
  for (const s of samples) {
    const got = decideStory(parse(mk(s)))
    if (got.rubric !== RUBRIC.version) { console.error('want rubric ' + RUBRIC.version + ' got ' + got.rubric + ' for ' + JSON.stringify(s)); process.exit(1) }
    if (typeof got.reason !== 'string' || got.reason.length === 0) { console.error('reason not a non-empty string for ' + JSON.stringify(s)); process.exit(1) }
  }
  const floored = decideStory(parse(mk({owd:'1'})))
  if (!floored.reason.includes('one_way_door')) { console.error('floor reason must name the floor token, got: ' + floored.reason); process.exit(1) }
  const scored = decideStory(parse(mk({mc:'3'})))
  if (!scored.reason.includes('3')) { console.error('scored reason must name the score, got: ' + scored.reason); process.exit(1) }
" && ok "every return carries the rubric version and a reason naming floor or score" \
  || bad "output contract (rubric version / reason) wrong"

# 6. Retune is a one-file data diff (AC4) and the decision is reproducible
#    (AC2). decideStory takes the rubric as data (defaulting to the file), so a
#    maintainer who shifts a threshold in the rubric — here modelled as a rubric
#    object of the same shape — moves the decision with no code change: a story
#    that scored into the borderline PAIR band resolves to SOLO once the SOLO
#    ceiling is raised to cover it, and nothing in the script changed. The
#    reported rubric version comes from that same data, and identical fields on
#    the identical rubric return the identical decision every time.
node --input-type=module -e "
  import { readFileSync } from 'node:fs'
  import { parse } from '$MSF'
  import { decideStory } from '$MS'
  const RUBRIC = JSON.parse(readFileSync('$ROOT/plugins/agentic-sdlc/scripts/mode-select-rubric.json', 'utf8'))
  const line = '- select: risk_class=none@AC1 one_way_doors=0@AC1 existing_pattern=yes@AC1 modules_crossed=3@AC1 review_bounced=no@AC1 risk_kind=code@AC1'
  const base = decideStory(parse(line))
  if (base.mode !== 'PAIR' || base.borderline !== true || base.score !== 3) { console.error('baseline want borderline PAIR score 3, got ' + JSON.stringify(base)); process.exit(1) }
  const retuned = { ...RUBRIC, thresholds: { ...RUBRIC.thresholds, solo_at_or_below: 3 } }
  const shifted = decideStory(parse(line), retuned)
  if (shifted.mode !== 'SOLO' || shifted.borderline !== false) { console.error('retuned SOLO ceiling must shift the decision to SOLO, got ' + JSON.stringify(shifted)); process.exit(1) }
  const bumped = decideStory(parse(line), { ...RUBRIC, version: 2 })
  if (bumped.rubric !== 2) { console.error('reported rubric must come from the data, want 2 got ' + bumped.rubric); process.exit(1) }
  const a = JSON.stringify(decideStory(parse(line)))
  const b = JSON.stringify(decideStory(parse(line)))
  if (a !== b) { console.error('identical fields and rubric must return the identical decision, got ' + a + ' vs ' + b); process.exit(1) }
" && ok "rubric is injectable data: a threshold retune shifts the decision, reruns are identical" \
  || bad "rubric injection / determinism wrong"

# 7. Lane recommendation over a set (ARCH-2, advisory): deliberate when any floor
#    fires on any story OR ≥2 stories end up PAIR; else fast. The lane reports the
#    rubric version (from the injected data, so a retune/version bump rides AC4),
#    the list of floor tokens that fired across the set, the count of PAIR stories,
#    and a one-line reason. A lone scored PAIR stays fast; a single floor forces
#    deliberate whatever the rest score; identical input returns identical output.
node --input-type=module -e "
  import { readFileSync } from 'node:fs'
  import { parse } from '$MSF'
  import { decideLane } from '$MS'
  const RUBRIC = JSON.parse(readFileSync('$ROOT/plugins/agentic-sdlc/scripts/mode-select-rubric.json', 'utf8'))
  const mk = (o) => parse('- select: risk_class=' + (o.rc||'none') + '@AC1 one_way_doors=' + (o.owd||'0') + '@AC1 existing_pattern=' + (o.ep||'yes') + '@AC1 modules_crossed=' + (o.mc||'1') + '@AC1 review_bounced=' + (o.rb||'no') + '@AC1 risk_kind=' + (o.rk||'code') + '@AC1')
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  // All SOLO → fast, no floors, no PAIR.
  const allSolo = decideLane([mk({}), mk({})])
  if (allSolo.lane !== 'fast') { console.error('all-SOLO set must be fast, got ' + allSolo.lane); process.exit(1) }
  if (!eq(allSolo.floors, [])) { console.error('all-SOLO set must have no floors, got ' + JSON.stringify(allSolo.floors)); process.exit(1) }
  if (allSolo.pair_count !== 0) { console.error('all-SOLO set pair_count must be 0, got ' + allSolo.pair_count); process.exit(1) }

  // A single scored PAIR among SOLOs stays fast (needs ≥2 PAIR).
  const onePair = decideLane([mk({mc:'3',ep:'no'}), mk({})])
  if (onePair.lane !== 'fast') { console.error('one scored PAIR must stay fast, got ' + onePair.lane); process.exit(1) }
  if (onePair.pair_count !== 1) { console.error('one scored PAIR pair_count must be 1, got ' + onePair.pair_count); process.exit(1) }

  // Two scored PAIR → deliberate.
  const twoPair = decideLane([mk({mc:'3',ep:'no'}), mk({mc:'3',ep:'no'})])
  if (twoPair.lane !== 'deliberate') { console.error('two scored PAIR must be deliberate, got ' + twoPair.lane); process.exit(1) }
  if (twoPair.pair_count !== 2) { console.error('two scored PAIR pair_count must be 2, got ' + twoPair.pair_count); process.exit(1) }

  // A single floor forces deliberate whatever the rest score; the floor token is
  // reported, and that floored story counts as a PAIR.
  const floored = decideLane([mk({owd:'1'}), mk({})])
  if (floored.lane !== 'deliberate') { console.error('a firing floor must force deliberate, got ' + floored.lane); process.exit(1) }
  if (!eq(floored.floors, ['one_way_door'])) { console.error('floors must list the fired token, got ' + JSON.stringify(floored.floors)); process.exit(1) }
  if (floored.pair_count !== 1) { console.error('floored story counts as PAIR, pair_count must be 1, got ' + floored.pair_count); process.exit(1) }

  // Version from the data, reason a non-empty string, and reproducible.
  if (floored.rubric !== RUBRIC.version) { console.error('lane rubric must come from the data, want ' + RUBRIC.version + ' got ' + floored.rubric); process.exit(1) }
  if (typeof floored.reason !== 'string' || floored.reason.length === 0) { console.error('lane reason must be a non-empty string'); process.exit(1) }
  const bumped = decideLane([mk({})], { ...RUBRIC, version: 2 })
  if (bumped.rubric !== 2) { console.error('lane must report the injected rubric version, want 2 got ' + bumped.rubric); process.exit(1) }
  const a = JSON.stringify(decideLane([mk({mc:'3',ep:'no'}), mk({owd:'1'})]))
  const b = JSON.stringify(decideLane([mk({mc:'3',ep:'no'}), mk({owd:'1'})]))
  if (a !== b) { console.error('identical sets must return identical lanes, got ' + a + ' vs ' + b); process.exit(1) }
" && ok "lane: deliberate on any floor or ≥2 PAIR, else fast; version and reason reported" \
  || bad "lane recommendation wrong"

# 8. CLI (the output contract, on stdout): `story --line '<select>'` prints the
#    decideStory JSON and exits 0; `lane --file <backlog>` reads every '- select:'
#    line in the file (ignoring prose and headings), runs decideLane and prints
#    its JSON. Invalid input refuses non-zero by reusing the field schema's
#    strict parse — a bad enum or a missing file must fail loudly, never guess.
#    The pure exports stay importable; the CLI is a thin shell over them.
node --input-type=module -e "
  import { execFileSync } from 'node:child_process'
  import { writeFileSync, mkdtempSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  const run = (args) => {
    try {
      return { code: 0, stdout: execFileSync('node', ['$MS', ...args], { encoding: 'utf8' }) }
    } catch (e) {
      return { code: e.status ?? 1, stdout: e.stdout ?? '' }
    }
  }
  const mk = (o) => '- select: risk_class=' + (o.rc||'none') + '@AC1 one_way_doors=' + (o.owd||'0') + '@AC1 existing_pattern=' + (o.ep||'yes') + '@AC1 modules_crossed=' + (o.mc||'1') + '@AC1 review_bounced=' + (o.rb||'no') + '@AC1 risk_kind=' + (o.rk||'code') + '@AC1'

  // story --line: the decideStory contract as JSON, exit 0.
  const story = run(['story', '--line', mk({mc:'3',ep:'no'})])
  if (story.code !== 0) { console.error('story CLI must exit 0, got ' + story.code); process.exit(1) }
  const sj = JSON.parse(story.stdout)
  if (sj.mode !== 'PAIR' || sj.score !== 5 || sj.floor !== null || sj.rubric === undefined) { console.error('story CLI JSON wrong: ' + story.stdout); process.exit(1) }

  // lane --file: every '- select:' line read, prose ignored, decideLane printed.
  const dir = mkdtempSync(join(tmpdir(), 'ms-'))
  const file = join(dir, 'backlog.md')
  writeFileSync(file, ['# epic heading', mk({owd:'1'}), 'a prose line that is not a select', mk({}), ''].join('\n'))
  const lane = run(['lane', '--file', file])
  if (lane.code !== 0) { console.error('lane CLI must exit 0, got ' + lane.code); process.exit(1) }
  const lj = JSON.parse(lane.stdout)
  if (lj.lane !== 'deliberate' || lj.pair_count !== 1 || JSON.stringify(lj.floors) !== JSON.stringify(['one_way_door']) || lj.rubric === undefined) { console.error('lane CLI JSON wrong: ' + lane.stdout); process.exit(1) }

  // A malformed select value refuses non-zero (strict parse, never a guess).
  const badLine = run(['story', '--line', mk({rc:'banana'})])
  if (badLine.code === 0) { console.error('malformed select line must refuse non-zero'); process.exit(1) }

  // A missing lane file refuses non-zero rather than emitting an empty lane.
  const noFile = run(['lane', '--file', join(dir, 'does-not-exist.md')])
  if (noFile.code === 0) { console.error('missing lane file must refuse non-zero'); process.exit(1) }
" && ok "CLI: story/lane emit the JSON contract on stdout; bad input refuses non-zero" \
  || bad "CLI story/lane or refusal wrong"

# 9. Override recording (STORY-2-4 AC1/AC2/AC3): `--chosen` disagreeing with the
#    recommendation returns both values and `overridden: true`; agreeing returns
#    `overridden: false` and `alternative: null`; omitting `--chosen` defaults
#    `choice` to the recommendation untouched. Generic over lane and mode tokens
#    (recordChoice takes the vocabulary as data, STORY-2-5 reuses it for modes).
node --input-type=module -e "
  import { parse } from '$MSF'
  import { decideLane, recordChoice } from '$MS'
  const mk = (o) => parse('- select: risk_class=' + (o.rc||'none') + '@AC1 one_way_doors=' + (o.owd||'0') + '@AC1 existing_pattern=' + (o.ep||'yes') + '@AC1 modules_crossed=' + (o.mc||'1') + '@AC1 review_bounced=' + (o.rb||'no') + '@AC1 risk_kind=' + (o.rk||'code') + '@AC1')

  // Disagreement: both values visible, overridden true (AC2).
  const rec = decideLane([mk({owd:'1'})])  // recommends deliberate
  if (rec.lane !== 'deliberate') { console.error('setup: expected recommendation deliberate, got ' + rec.lane); process.exit(1) }
  const disagree = recordChoice(rec.lane, 'fast', ['deliberate', 'fast'])
  if (disagree.choice !== 'fast' || disagree.alternative !== 'deliberate' || disagree.overridden !== true) {
    console.error('disagreement must record both values: ' + JSON.stringify(disagree)); process.exit(1)
  }

  // Agreement: no override, alternative null (AC3).
  const agree = recordChoice(rec.lane, 'deliberate', ['deliberate', 'fast'])
  if (agree.choice !== 'deliberate' || agree.alternative !== null || agree.overridden !== false) {
    console.error('agreement must not record an override: ' + JSON.stringify(agree)); process.exit(1)
  }

  // Omitted --chosen defaults to the recommendation, untouched by vocabulary.
  const defaulted = recordChoice('SOLO_OPUS', undefined, ['SOLO', 'PAIR', 'FAST'])
  if (defaulted.choice !== 'SOLO_OPUS' || defaulted.overridden !== false || defaulted.alternative !== null) {
    console.error('omitted chosen must default to the recommendation untouched: ' + JSON.stringify(defaulted)); process.exit(1)
  }

  // A chosen token outside the vocabulary refuses, never a guess.
  let threw = false
  try { recordChoice('deliberate', 'bogus', ['deliberate', 'fast']) } catch { threw = true }
  if (!threw) { console.error('a chosen token outside the vocabulary must throw'); process.exit(1) }
" && ok "recordChoice: disagreement records both values, agreement records neither (AC2/AC3)" \
  || bad "recordChoice override contract wrong"

# 10. Zero-select-lines fallback (AC4 of selection-fields.md, surfaced here): an
#     old-format backlog with no '- select:' line must not silently recommend
#     fast — decideLane returns fallback: true, lane: null, and a reason, and a
#     normal decision carries fallback: false alongside it.
node --input-type=module -e "
  import { decideLane } from '$MS'
  const empty = decideLane([])
  if (empty.fallback !== true) { console.error('zero select lines must set fallback: true, got ' + JSON.stringify(empty)); process.exit(1) }
  if (empty.lane !== null) { console.error('zero select lines must not recommend a lane, got ' + empty.lane); process.exit(1) }
  if (typeof empty.reason !== 'string' || empty.reason.length === 0) { console.error('fallback must still carry a reason'); process.exit(1) }
" && ok "decideLane([]) falls back rather than inferring fast (AC4)" \
  || bad "zero-select-lines fallback wrong"

# 11. CLI `record` (STORY-2-4 AC1/AC2/AC3): writes a deterministic '- Lane:' line
#     into the backlog header, adds an '- Override:' line only when --chosen
#     disagrees with the recommendation, and a re-run with the same --chosen does
#     not duplicate either line.
node --input-type=module -e "
  import { execFileSync } from 'node:child_process'
  import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  const run = (args) => {
    try { return { code: 0, stdout: execFileSync('node', ['$MS', ...args], { encoding: 'utf8' }) } }
    catch (e) { return { code: e.status ?? 1, stdout: e.stdout ?? '' } }
  }
  const dir = mkdtempSync(join(tmpdir(), 'ms-record-'))
  const file = join(dir, 'EPIC-9.md')
  const header = [
    '# EPIC-9: test',
    '',
    '- Outcome: x',
    '- Status: TODO',
    '- Artifacts: none',
    '',
    '## Stories',
    '',
    '- select: risk_class=money@AC1 one_way_doors=0@AC1 existing_pattern=no@AC1 modules_crossed=3@AC1 review_bounced=no@AC1 risk_kind=code@AC1',
    '',
  ].join('\n')
  writeFileSync(file, header)

  // Disagreement: --chosen fast against a deliberate recommendation (risk_class=money floor).
  const first = run(['record', '--file', file, '--chosen', 'fast'])
  if (first.code !== 0) { console.error('record must exit 0, got ' + first.code + ': ' + first.stdout); process.exit(1) }
  let content = readFileSync(file, 'utf8')
  const laneLines = content.match(/^- Lane:.*$/gm) ?? []
  const overrideLines = content.match(/^- Override: lane .*$/gm) ?? []
  if (laneLines.length !== 1 || !laneLines[0].includes('fast') || !laneLines[0].includes('recommended deliberate')) {
    console.error('record must write exactly one Lane line naming chosen and recommended: ' + content); process.exit(1)
  }
  if (overrideLines.length !== 1 || !overrideLines[0].includes('recommended=deliberate') || !overrideLines[0].includes('chosen=fast')) {
    console.error('record must write exactly one Override line with both values: ' + content); process.exit(1)
  }

  // Re-run with the same --chosen: idempotent, no duplicate lines.
  run(['record', '--file', file, '--chosen', 'fast'])
  const rerun = readFileSync(file, 'utf8')
  if (rerun !== content) { console.error('re-running record with the same --chosen must not change the file'); process.exit(1) }

  // Agreement: --chosen deliberate matches the recommendation — override removed.
  run(['record', '--file', file, '--chosen', 'deliberate'])
  content = readFileSync(file, 'utf8')
  if ((content.match(/^- Lane:.*$/gm) ?? []).length !== 1) { console.error('agreement must still carry exactly one Lane line'); process.exit(1) }
  if ((content.match(/^- Override: lane .*$/gm) ?? []).length !== 0) { console.error('agreement must carry no Override line (AC3): ' + content); process.exit(1) }
" && ok "CLI record: writes Lane/Override lines idempotently, drops Override on agreement" \
  || bad "CLI record wrong"

[ "$fail" -eq 0 ] || { printf '\nmode-select tests failed\n' >&2; exit 1; }
printf '\nmode-select tests passed\n'
