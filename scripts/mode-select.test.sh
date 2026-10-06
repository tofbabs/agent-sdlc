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

# 12. Per-story resolution (STORY-2-5 AC1): `story --file <backlog> --id <ID>`
#     finds that story's block (`### <ID>:` up to the next `### `/`## `), scores
#     the block's own `- select:` line, and prints the decideStory + recordChoice
#     JSON. Scoping is the wiring under test: two blocks with different decisions
#     must each resolve to their own, not to whichever select line comes first.
#     `--chosen SOLO_OPUS` is accepted — the mode vocabulary is DISPATCH_MODES
#     (which includes SOLO_OPUS), not CLOSED.mode (which does not). An unknown
#     --id refuses non-zero rather than scoring the wrong block.
node --input-type=module -e "
  import { execFileSync } from 'node:child_process'
  import { writeFileSync, mkdtempSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  const run = (args) => {
    try { return { code: 0, stdout: execFileSync('node', ['$MS', ...args], { encoding: 'utf8' }) } }
    catch (e) { return { code: e.status ?? 1, stdout: e.stdout ?? '' } }
  }
  const dir = mkdtempSync(join(tmpdir(), 'ms-story-'))
  const file = join(dir, 'EPIC-9.md')
  writeFileSync(file, [
    '# EPIC-9: test',
    '',
    '## Stories',
    '',
    '### STORY-A: a solo one',
    '- select: risk_class=none@AC1 one_way_doors=0@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@AC1',
    '',
    '### STORY-B: a floored one',
    '- select: risk_class=none@AC1 one_way_doors=1@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@AC1',
    '',
  ].join('\n'))

  // STORY-A scores SOLO (score 0, no floor); the default choice rides the recommendation.
  const a = run(['story', '--file', file, '--id', 'STORY-A'])
  if (a.code !== 0) { console.error('story --file --id must exit 0, got ' + a.code + ': ' + a.stdout); process.exit(1) }
  const aj = JSON.parse(a.stdout)
  if (aj.mode !== 'SOLO' || aj.floor !== null || aj.score !== 0 || aj.rubric === undefined || aj.fallback !== false) {
    console.error('STORY-A must resolve to its own SOLO decision: ' + a.stdout); process.exit(1)
  }
  if (aj.choice !== 'SOLO' || aj.alternative !== null || aj.overridden !== false) {
    console.error('STORY-A default choice must ride the recommendation: ' + a.stdout); process.exit(1)
  }

  // STORY-B scores PAIR via the one_way_door floor — proves the call scopes to
  // the named block, not to the first select line in the file.
  const b = run(['story', '--file', file, '--id', 'STORY-B'])
  if (b.code !== 0) { console.error('STORY-B must exit 0, got ' + b.code + ': ' + b.stdout); process.exit(1) }
  const bj = JSON.parse(b.stdout)
  if (bj.mode !== 'PAIR' || bj.floor !== 'one_way_door') {
    console.error('STORY-B must resolve to its own floored PAIR decision, not STORY-A: ' + b.stdout); process.exit(1)
  }

  // --chosen SOLO_OPUS is accepted and overrides: the mode vocabulary is
  // DISPATCH_MODES, which carries SOLO_OPUS (CLOSED.mode does not).
  const opus = run(['story', '--file', file, '--id', 'STORY-A', '--chosen', 'SOLO_OPUS'])
  if (opus.code !== 0) { console.error('--chosen SOLO_OPUS must be accepted (DISPATCH_MODES), got ' + opus.code + ': ' + opus.stdout); process.exit(1) }
  const oj = JSON.parse(opus.stdout)
  if (oj.choice !== 'SOLO_OPUS' || oj.alternative !== 'SOLO' || oj.overridden !== true) {
    console.error('--chosen SOLO_OPUS must record choice SOLO_OPUS over recommended SOLO: ' + opus.stdout); process.exit(1)
  }

  // An unknown --id refuses non-zero rather than scoring the wrong block.
  const missing = run(['story', '--file', file, '--id', 'STORY-ZZZ'])
  if (missing.code === 0) { console.error('an unknown --id must refuse non-zero, got: ' + missing.stdout); process.exit(1) }
" && ok "story --file --id resolves the named block; --chosen SOLO_OPUS accepted (AC1)" \
  || bad "per-story resolution or SOLO_OPUS vocabulary wrong"

# 13. Per-story fallback (STORY-2-5 AC2): a story block with no `- select:` line
#     is an old-format backlog — `story --file --id` must NOT throw and must NOT
#     borrow a neighbouring story's select line. It returns fallback: true,
#     mode: null, rubric: null and a reason naming the missing select line, so
#     /build knows to apply the prose risk: rule. A block that DOES carry a
#     select line still scores normally (fallback: false). A malformed select
#     line never falls back silently — it refuses non-zero (the "no line" and
#     "bad line" cases must stay distinguishable). Block scoping is under test:
#     STORY-OLD sits immediately before STORY-NEW with only a `### ` heading
#     between them, so a decision for STORY-OLD may not reach STORY-NEW's line.
node --input-type=module -e "
  import { execFileSync } from 'node:child_process'
  import { writeFileSync, mkdtempSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  const run = (args) => {
    try { return { code: 0, stdout: execFileSync('node', ['$MS', ...args], { encoding: 'utf8' }) } }
    catch (e) { return { code: e.status ?? 1, stdout: e.stdout ?? '' } }
  }
  const dir = mkdtempSync(join(tmpdir(), 'ms-fallback-'))
  const file = join(dir, 'EPIC-9.md')
  writeFileSync(file, [
    '# EPIC-9: test',
    '',
    '## Stories',
    '',
    '### STORY-OLD: old format, no select fields',
    'Just prose describing the work, the way the planner wrote it before STORY-2-1.',
    '',
    '### STORY-NEW: has a select line',
    '- select: risk_class=none@AC1 one_way_doors=0@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@AC1',
    '',
    '### STORY-BAD: malformed select line',
    '- select: risk_class=banana@AC1 one_way_doors=0@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@AC1',
    '',
  ].join('\n'))

  // No select line in the block → fallback, never a throw, never the neighbour's line.
  const old = run(['story', '--file', file, '--id', 'STORY-OLD'])
  if (old.code !== 0) { console.error('a block with no select line must fall back (exit 0), got ' + old.code + ': ' + old.stdout); process.exit(1) }
  const oj = JSON.parse(old.stdout)
  if (oj.fallback !== true || oj.mode !== null || oj.rubric !== null) {
    console.error('no select line must return fallback: true, mode: null, rubric: null: ' + old.stdout); process.exit(1)
  }
  if (typeof oj.reason !== 'string' || !oj.reason.includes('no select line')) {
    console.error('fallback reason must name the missing select line: ' + old.stdout); process.exit(1)
  }

  // The neighbour with a real select line still scores — proves scoping stopped
  // at the next '### ' heading rather than bleeding STORY-OLD into STORY-NEW.
  const fresh = run(['story', '--file', file, '--id', 'STORY-NEW'])
  if (fresh.code !== 0) { console.error('STORY-NEW must still score, got ' + fresh.code + ': ' + fresh.stdout); process.exit(1) }
  const fj = JSON.parse(fresh.stdout)
  if (fj.fallback !== false || fj.mode !== 'SOLO') {
    console.error('STORY-NEW must score its own SOLO decision, not fall back: ' + fresh.stdout); process.exit(1)
  }

  // A malformed select line refuses non-zero — never a silent fallback.
  const bad = run(['story', '--file', file, '--id', 'STORY-BAD'])
  if (bad.code === 0) { console.error('a malformed select line must refuse non-zero, not fall back: ' + bad.stdout); process.exit(1) }
" && ok "story --file --id falls back on a missing select line, refuses on a malformed one (AC2)" \
  || bad "per-story fallback / malformed refusal wrong"

# 14. Per-story recording into the block (STORY-2-5 AC2/AC3): `--record` writes
#     idempotent decision lines INTO the named story's own block (same shape as
#     2-4's header lines), never into a neighbour. A scored story with the
#     default choice writes one `- mode:` line naming choice/recommended/rubric/
#     reason and no override; a `--chosen` that disagrees adds one `- override:
#     mode` line and updates the single mode line in place, and an agreeing
#     re-run drops the stale override. A fallback block records the `fallback (no
#     select line)` variant when `--chosen` supplies the prose-rule mode, but
#     `--record` with a fallback and no `--chosen` refuses non-zero — an
#     unrecorded guess is never written. Without `--record` the call is read-only.
node --input-type=module -e "
  import { execFileSync } from 'node:child_process'
  import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  const run = (args) => {
    try { return { code: 0, stdout: execFileSync('node', ['$MS', ...args], { encoding: 'utf8' }) } }
    catch (e) { return { code: e.status ?? 1, stdout: e.stdout ?? '' } }
  }
  const dir = mkdtempSync(join(tmpdir(), 'ms-srec-'))
  const file = join(dir, 'EPIC-9.md')
  const seed = () => writeFileSync(file, [
    '# EPIC-9: test',
    '',
    '## Stories',
    '',
    '### STORY-P: a floored one',
    '- status: TODO',
    '- select: risk_class=money@AC1 one_way_doors=0@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@AC1',
    '',
    '### STORY-Q: another with a select line',
    '- status: TODO',
    '- select: risk_class=none@AC1 one_way_doors=0@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@AC1',
    '',
    '### STORY-OLD: old format, no select fields',
    '- status: TODO',
    'Just prose describing the work.',
    '',
  ].join('\n'))
  const modeLines = (c) => c.match(/^- mode: .*\$/gm) ?? []
  const overrideLines = (c) => c.match(/^- override: mode .*\$/gm) ?? []
  const blockP = (c) => c.slice(c.indexOf('### STORY-P:'), c.indexOf('### STORY-Q:'))
  const blockQ = (c) => c.slice(c.indexOf('### STORY-Q:'), c.indexOf('### STORY-OLD:'))
  const blockOld = (c) => c.slice(c.indexOf('### STORY-OLD:'))

  // Without --record the call is read-only: it prints JSON and writes nothing.
  seed()
  const before = readFileSync(file, 'utf8')
  run(['story', '--file', file, '--id', 'STORY-P'])
  if (readFileSync(file, 'utf8') !== before) { console.error('story without --record must not mutate the backlog'); process.exit(1) }

  // Default choice on a scored (floored) story: exactly one mode line, in
  // STORY-P's own block, naming choice/recommended/rubric/reason; no override.
  const rec = run(['story', '--file', file, '--id', 'STORY-P', '--record'])
  if (rec.code !== 0) { console.error('story --record must exit 0, got ' + rec.code + ': ' + rec.stdout); process.exit(1) }
  let c = readFileSync(file, 'utf8')
  if (modeLines(c).length !== 1) { console.error('record must write exactly one mode line, got ' + JSON.stringify(modeLines(c))); process.exit(1) }
  const pLine = modeLines(blockP(c))[0] || ''
  if (!pLine.includes('PAIR') || !pLine.includes('recommended PAIR') || !pLine.includes('rubric 1') || !pLine.includes('hard floor risk_class')) {
    console.error('mode line must name choice, recommended mode, rubric and reason: ' + pLine); process.exit(1)
  }
  if (modeLines(blockQ(c)).length !== 0) { console.error('recording STORY-P must not touch STORY-Q block: ' + c); process.exit(1) }
  if (overrideLines(c).length !== 0) { console.error('a default (agreeing) choice must write no override line: ' + c); process.exit(1) }

  // Idempotent: re-running with the same (default) choice does not change the file.
  const after = readFileSync(file, 'utf8')
  run(['story', '--file', file, '--id', 'STORY-P', '--record'])
  if (readFileSync(file, 'utf8') !== after) { console.error('re-running --record with the same choice must be a no-op write'); process.exit(1) }

  // Override: --chosen SOLO against recommended PAIR adds exactly one override
  // line and updates the single mode line's choice in place.
  run(['story', '--file', file, '--id', 'STORY-P', '--chosen', 'SOLO', '--record'])
  c = readFileSync(file, 'utf8')
  const pOv = modeLines(blockP(c))
  if (pOv.length !== 1 || !pOv[0].includes('SOLO') || !pOv[0].includes('recommended PAIR')) {
    console.error('override must update the single mode line to the chosen mode: ' + c); process.exit(1)
  }
  const ov = overrideLines(blockP(c))
  if (ov.length !== 1 || !ov[0].includes('recommended=PAIR') || !ov[0].includes('chosen=SOLO')) {
    console.error('a disagreeing --chosen must write exactly one override line with both values: ' + c); process.exit(1)
  }

  // Agreeing re-run drops the stale override line, mode line stays singular.
  run(['story', '--file', file, '--id', 'STORY-P', '--chosen', 'PAIR', '--record'])
  c = readFileSync(file, 'utf8')
  if (overrideLines(c).length !== 0) { console.error('an agreeing re-run must drop the stale override line: ' + c); process.exit(1) }
  if (modeLines(blockP(c)).length !== 1) { console.error('agreement must still carry exactly one mode line'); process.exit(1) }

  // Fallback block with --chosen records the fallback variant into STORY-OLD.
  run(['story', '--file', file, '--id', 'STORY-OLD', '--chosen', 'PAIR', '--record'])
  c = readFileSync(file, 'utf8')
  const oldLines = modeLines(blockOld(c))
  if (oldLines.length !== 1 || !oldLines[0].includes('fallback (no select line)') || !oldLines[0].includes('prose risk: rule') || !oldLines[0].includes('PAIR')) {
    console.error('a fallback block must record the fallback variant naming the chosen mode: ' + c); process.exit(1)
  }

  // --record on a fallback block with NO --chosen refuses non-zero and writes nothing.
  seed()
  const refusal = run(['story', '--file', file, '--id', 'STORY-OLD', '--record'])
  if (refusal.code === 0) { console.error('--record on a fallback with no --chosen must refuse non-zero'); process.exit(1) }
  if (modeLines(readFileSync(file, 'utf8')).length !== 0) { console.error('a refused fallback record must not write any mode line'); process.exit(1) }
" && ok "story --record writes idempotent mode/override lines into the block; fallback needs --chosen (AC2/AC3)" \
  || bad "per-story recording wrong"

# 15. build.md wires the call, the rubric prose lives in reference/ (STORY-2-5
#     AC4): the MODE SELECTION section becomes one `mode-select.mjs story` call
#     plus a short stub, and on `fallback: true` cats the prose rule. The
#     floor/score rubric prose (the SOLO / SOLO-on-Opus / PAIR distinctions and
#     the "no risk: line → infer; when unsure, pair" fallback, plus how to read
#     the script output) moves VERBATIM into NEW reference/mode-selection.md and
#     is NOT left duplicated in build.md — a copy here is exactly the drift the
#     repo's "no copies" rule exists to prevent. build.md keeps the "--fast
#     skips this" sentence and stays at or below its 16928-byte ratchet cap, and
#     the TOOLING-DEBT row this story resolves (CLOSED.mode lacks SOLO_OPUS) is
#     removed.
BUILD="$ROOT/plugins/agentic-sdlc/commands/build.md"
REF="$ROOT/plugins/agentic-sdlc/reference/mode-selection.md"
DEBT="$ROOT/docs/TOOLING-DEBT.md"
ac4=0
[ -f "$REF" ] || { echo "reference/mode-selection.md must exist (the prose moves here)" >&2; ac4=1; }
if [ -f "$REF" ]; then
  grep -qF 'sourcing, seeding' "$REF" || { echo "reference must carry the SOLO-on-Opus data-risk prose verbatim" >&2; ac4=1; }
  grep -qF 'reviewing wiring steps' "$REF" || { echo "reference must carry the PAIR rubric prose verbatim" >&2; ac4=1; }
  grep -qF 'when genuinely unsure, pair' "$REF" || { echo "reference must carry the no-risk-line fallback rule verbatim" >&2; ac4=1; }
  grep -qF 'fallback' "$REF" || { echo "reference must explain how to read the script output (the fallback field)" >&2; ac4=1; }
fi
# The call and its fallback branch now live in build.md's MODE SELECTION.
grep -qF 'mode-select.mjs story' "$BUILD" || { echo "build.md MODE SELECTION must call mode-select.mjs story" >&2; ac4=1; }
grep -qe '--record' "$BUILD" || { echo "build.md must call the per-story recording path (--record)" >&2; ac4=1; }
grep -qF 'reference/mode-selection.md' "$BUILD" || { echo "build.md must cat reference/mode-selection.md on fallback: true" >&2; ac4=1; }
grep -qF 'every task is SOLO' "$BUILD" || { echo "build.md must keep the '--fast skips this: every task is SOLO' sentence" >&2; ac4=1; }
# The rubric prose moved — it must not be duplicated back in build.md.
grep -qF 'sourcing, seeding' "$BUILD" && { echo "build.md must not duplicate the moved rubric prose (it belongs in reference/)" >&2; ac4=1; }
grep -qF 'reviewing wiring steps' "$BUILD" && { echo "build.md must not duplicate the moved PAIR rubric prose" >&2; ac4=1; }
# The boot-path ratchet: build.md ends at or below its cap (it is expected to shrink).
bytes=$(wc -c < "$BUILD")
[ "$bytes" -le 16928 ] || { echo "build.md is $bytes bytes, over its 16928 cap" >&2; ac4=1; }
# The debt this story resolves is gone.
grep -qF 'validates against CLOSED.mode' "$DEBT" && { echo "the resolved TOOLING-DEBT row (CLOSED.mode lacks SOLO_OPUS) must be removed" >&2; ac4=1; }
[ "$ac4" -eq 0 ] && ok "build.md calls mode-select; rubric prose lives verbatim in reference/, not duplicated (AC4)" \
  || bad "build.md wiring / reference move / debt removal wrong"

# 16. Decision records (STORY-2-8 AC1/AC2/AC3): `--record` writes the decision
#     into the shared store (floor, score, override, lane), idempotently, keyed
#     on the run_id from --run-id or the main worktree's marker. With no run_id
#     it never invents one: the backlog line is still written, the record is
#     skipped, stderr says so, and the call still exits 0. Floor and score lines
#     show their reason inline. Temp git repos only, never the real .git.
node --input-type=module -e "
  import { spawnSync, execFileSync } from 'node:child_process'
  import { writeFileSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  const RUN = '3f2b8c1e-9a4d-4e7f-8b21-6c5d4e3f2a10'
  const fail = (m) => { console.error(m); process.exit(1) }
  const run = (cwd, args) => spawnSync('node', ['$MS', ...args], { cwd, encoding: 'utf8' })
  const repo = mkdtempSync(join(tmpdir(), 'ms-dec-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const file = join(repo, 'EPIC-9.md')
  writeFileSync(file, [
    '# EPIC-9: t', '- Artifacts: x', '- Lane: fast', '', '### STORY-P: floored', '- status: TODO',
    '- select: risk_class=money@AC1 one_way_doors=0@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@AC1', '',
    '### STORY-Q: scored', '- status: TODO',
    '- select: risk_class=none@AC1 one_way_doors=0@AC1 existing_pattern=yes@AC1 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=data@AC1', '',
  ].join('\n'))
  const store = join(repo, '.git', 'agentic-sdlc', 'decisions')
  const records = () => existsSync(store) ? readdirSync(store).map((f) => JSON.parse(readFileSync(join(store, f), 'utf8'))) : []

  // No run_id anywhere: backlog line written, record skipped, stderr says so, exit 0.
  let r = run(repo, ['story', '--file', file, '--id', 'STORY-P', '--record'])
  if (r.status !== 0) fail('no run_id must not fail the call: ' + r.stderr)
  if (!/no run_id/.test(r.stderr)) fail('no run_id must be said on stderr, got: ' + r.stderr)
  if (records().length !== 0) fail('no run_id: nothing may be recorded')
  if (!/^- mode: PAIR — recommended PAIR .*hard floor risk_class forces PAIR/m.test(readFileSync(file, 'utf8'))) fail('floor line must carry its reason inline')

  // --run-id: a floor decision, then a score decision with an override.
  r = run(repo, ['story', '--file', file, '--id', 'STORY-P', '--record', '--run-id', RUN])
  if (r.status !== 0) fail('floor record failed: ' + r.stderr)
  r = run(repo, ['story', '--file', file, '--id', 'STORY-Q', '--record', '--run-id', RUN, '--chosen', 'PAIR'])
  if (r.status !== 0) fail('score record failed: ' + r.stderr)
  const by = (layer, subject) => records().find((x) => x.layer === layer && x.subject === subject)
  const fl = by('floor', 'STORY-P')
  if (!fl || fl.floor !== 'money' || fl.choice !== 'PAIR' || fl.rubric !== 1 || fl.run_id !== RUN) fail('floor record wrong: ' + JSON.stringify(fl))
  if (!fl.inputs || fl.inputs.risk_class !== 'money') fail('record must carry the input enums')
  if (!/^[0-9a-f]{16}\$/.test(fl.decision_id)) fail('decision_id must be 16 hex')
  const sc = by('score', 'STORY-Q')
  if (!sc || sc.choice !== 'SOLO_OPUS' || sc.score !== 0 || sc.floor !== null) fail('score record wrong (exact SOLO_OPUS token kept): ' + JSON.stringify(sc))
  const ov = by('override', 'STORY-Q')
  if (!ov || ov.choice !== 'PAIR' || ov.alternative !== 'SOLO_OPUS' || ov.overridden !== true) fail('override record wrong: ' + JSON.stringify(ov))
  if (!/^- mode: PAIR — recommended SOLO_OPUS .*score 0 at or below 2/m.test(readFileSync(file, 'utf8'))) fail('score line must carry its reason inline')

  // AC2: reaching the same decision points again adds nothing and keeps the same IDs.
  const before = records().map((x) => x.decision_id).sort().join()
  run(repo, ['story', '--file', file, '--id', 'STORY-P', '--record', '--run-id', RUN])
  run(repo, ['story', '--file', file, '--id', 'STORY-Q', '--record', '--run-id', RUN, '--chosen', 'PAIR'])
  if (records().map((x) => x.decision_id).sort().join() !== before) fail('a repeated decision must reuse the stored record, no duplicate')

  // Lane: marker in the main worktree supplies the run_id; override is its own record.
  mkdirSync(join(repo, '.agentic-sdlc'), { recursive: true })
  writeFileSync(join(repo, '.agentic-sdlc', 'run-state.json'), JSON.stringify({ run_id: RUN }))
  r = run(repo, ['record', '--file', file, '--chosen', 'fast'])
  if (r.status !== 0) fail('lane record failed: ' + r.stderr)
  const lane = by('lane', 'lane')
  if (!lane || lane.choice !== 'deliberate' || lane.rubric !== 1) fail('lane record wrong: ' + JSON.stringify(lane))
  const lov = by('override', 'lane')
  if (!lov || lov.choice !== 'fast' || lov.alternative !== 'deliberate') fail('lane override record wrong: ' + JSON.stringify(lov))
  if (!/^- Lane: fast — recommended deliberate .*floor risk_class.*lane is deliberate/m.test(readFileSync(file, 'utf8'))) fail('lane line must carry its reason inline')

  // A bad --run-id is skipped, not invented.
  const n = records().length
  r = run(repo, ['story', '--file', file, '--id', 'STORY-Q', '--record', '--run-id', 'nope', '--chosen', 'SOLO'])
  if (r.status !== 0 || records().length !== n) fail('a malformed --run-id must skip the record without failing')
" && ok "--record writes floor/score/override/lane decisions idempotently; no run_id skips with a stderr note (AC1/AC2/AC3)" \
  || bad "decision recording via mode-select --record is wrong"

# 17. The usage string lists every accepted form, including the per-story --record.
node --input-type=module -e "
  import { spawnSync } from 'node:child_process'
  const r = spawnSync('node', ['$MS', 'bogus'], { encoding: 'utf8' })
  for (const frag of ['story --file', '--id', '--record', '--run-id', 'record --file']) {
    if (!r.stderr.includes(frag)) { console.error('usage must mention ' + frag); process.exit(1) }
  }
" && ok "usage string lists the --file/--id/--record forms" || bad "usage string is stale"

[ "$fail" -eq 0 ] || { printf '\nmode-select tests failed\n' >&2; exit 1; }
printf '\nmode-select tests passed\n'
