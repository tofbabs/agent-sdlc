#!/usr/bin/env node
//
// mode-select.mjs — turns a story's selection fields into a score on the
// versioned ARCH-2 rubric. Weights and bands live in mode-select-rubric.json so
// a retune is a one-file data diff; nothing here hardcodes a threshold.
//
// Input is the object parse() returns from mode-select-fields.mjs, so the field
// names and their shape come from that module's FIELDS spec, never re-declared.
//
// Zero dependencies, Node 22 (the repo floor).

import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from './mode-select-fields.mjs'
import { CLOSED } from './run-report-categories.mjs'

const RUBRIC = JSON.parse(
  readFileSync(new URL('./mode-select-rubric.json', import.meta.url), 'utf8'),
)

// A count falls in the first band whose [min, max] covers it; max null is open.
function bandPoints(bands, count) {
  const band = bands.find(
    (b) => count >= b.min && (b.max === null || count <= b.max),
  )
  return band.points
}

// Floors are hardcoded, never in the rubric JSON: a retune must not be able to
// remove one. They run before any score because a floor is a fact about the
// change, not a judgement the score gets to weigh.
const FLOOR_RISK_CLASSES = ['money', 'auth', 'destructive_data']

function firingFloor(fields) {
  if (fields.one_way_doors.value > 0) return 'one_way_door'
  if (fields.review_bounced.value === true) return 'review_bounced'
  if (FLOOR_RISK_CLASSES.includes(fields.risk_class.value)) return 'risk_class'
  return null
}

// Every return names the rubric it was scored on and a one-line reason, so a
// logged decision records why, not just what.
export function decideStory(fields, rubricData = RUBRIC) {
  const rubric = rubricData.version
  const floor = firingFloor(fields)
  if (floor !== null) {
    return {
      rubric,
      score: null,
      mode: 'PAIR',
      borderline: false,
      floor,
      fallback: false,
      reason: `hard floor ${floor} forces PAIR`,
    }
  }

  let score = bandPoints(rubricData.modules_crossed, fields.modules_crossed.value)
  if (fields.existing_pattern.value === false) {
    score += rubricData.no_existing_pattern
  }
  const { solo_at_or_below, pair_at_or_above } = rubricData.thresholds
  if (score <= solo_at_or_below) {
    // Data risk is not scored; it only moves an unsupervised SOLO onto Opus.
    const mode = fields.risk_kind.value === 'data' ? 'SOLO_OPUS' : 'SOLO'
    return {
      rubric,
      score,
      mode,
      borderline: false,
      floor: null,
      fallback: false,
      reason: `score ${score} at or below ${solo_at_or_below} is ${mode}`,
    }
  }
  if (score >= pair_at_or_above) {
    return {
      rubric,
      score,
      mode: 'PAIR',
      borderline: false,
      floor: null,
      fallback: false,
      reason: `score ${score} at or above ${pair_at_or_above} is PAIR`,
    }
  }
  // The gap between the bands resolves to the safer mode and is flagged.
  return {
    rubric,
    score,
    mode: 'PAIR',
    borderline: true,
    floor: null,
    fallback: false,
    reason: `score ${score} in the gap resolves to PAIR, flagged borderline`,
  }
}

// A lane is advisory: one floor anywhere, or two stories that need a pair, is
// enough to take the whole epic off the fast lane.
export function decideLane(stories, rubricData = RUBRIC) {
  // Zero `- select:` lines is an old-format backlog (reference/selection-fields.md's
  // documented fallback), not "no risk found" — inferring fast here would be
  // exactly the silent guess that fallback exists to rule out.
  if (stories.length === 0) {
    return {
      rubric: null,
      lane: null,
      floors: [],
      pair_count: 0,
      fallback: true,
      reason: 'no `- select:` lines found; nothing to recommend, falls back to the prose risk: rule',
    }
  }

  const decisions = stories.map((s) => decideStory(s, rubricData))
  const floors = decisions.filter((d) => d.floor !== null).map((d) => d.floor)
  const pair_count = decisions.filter((d) => d.mode === 'PAIR').length
  const lane = floors.length > 0 || pair_count >= 2 ? 'deliberate' : 'fast'
  const reason =
    lane === 'deliberate'
      ? floors.length > 0
        ? `floor ${floors.join(', ')} fired, lane is deliberate`
        : `${pair_count} stories are PAIR, lane is deliberate`
      : `no floor fired and ${pair_count} PAIR stories, lane is fast`
  return {
    rubric: rubricData.version,
    lane,
    floors,
    pair_count,
    fallback: false,
    reason,
  }
}

// recordChoice — generic over a lane decision or a story/mode decision (STORY-2-5
// reuses it unchanged): the human's chosen token always wins, the recommendation
// only ever rides along as `alternative` when the two disagree. Vocabulary is
// passed in, never guessed, so a mode call and a lane call each check against their
// own closed set (run-report-categories.mjs CLOSED.lane / CLOSED.mode).
//
// `chosen` omitted means the human took the recommendation as given: `choice`
// defaults to it and is never re-validated (a fallback/unscored recommendation —
// e.g. SOLO_OPUS, outside CLOSED.mode — must still pass through untouched).
export function recordChoice(recommendation, chosen, vocabulary) {
  const hasChosen = chosen !== undefined && chosen !== null
  if (hasChosen && !vocabulary.includes(chosen)) {
    throw new Error(`mode-select.mjs: chosen "${chosen}" is not one of ${vocabulary.join('|')}`)
  }
  const overridden = hasChosen && recommendation !== null && chosen !== recommendation
  return {
    choice: hasChosen ? chosen : recommendation,
    alternative: overridden ? recommendation : null,
    overridden,
  }
}

function readSelectLines(backlogPath) {
  return readFileSync(backlogPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^- select:/.test(line))
    .map((line) => parse(line))
}

function parseFlags(args) {
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i]
  }
  return flags
}

// The header-block line this story's AC1/AC2 describe. Matched and replaced by
// regex, never appended blindly, so a second `record` call updates the existing
// line instead of growing the file (AC2's "recorded" must stay singular).
const LANE_LINE_RE = /^- Lane:.*$/m
const OVERRIDE_LANE_LINE_RE = /^- Override: lane .*$/m
const ARTIFACTS_LINE_RE = /^- Artifacts:.*$/m

function laneLine(result, chosen) {
  if (result.fallback) {
    return `- Lane: ${chosen} — no recommendation (fallback): ${result.reason}`
  }
  return `- Lane: ${chosen} — recommended ${result.lane} (rubric ${result.rubric}): ${result.reason}`
}

function overrideLine(result, chosen) {
  return `- Override: lane recommended=${result.lane} chosen=${chosen}`
}

// Replaces an existing header line in place; inserts after `anchorRe`'s line
// the first time; removes it when `line` is null (AC3: no override line when
// the human agreed with the recommendation).
function upsertHeaderLine(content, lineRe, line, anchorRe = ARTIFACTS_LINE_RE) {
  if (line === null) {
    return lineRe.test(content) ? content.replace(new RegExp(`\\n?${lineRe.source}`, 'm'), '') : content
  }
  if (lineRe.test(content)) return content.replace(lineRe, line)
  const anchor = anchorRe.exec(content)
  if (!anchor) {
    throw new Error(`mode-select.mjs: record found no "${anchorRe.source}" header line to anchor on`)
  }
  const at = anchor.index + anchor[0].length
  return `${content.slice(0, at)}\n${line}${content.slice(at)}`
}

// record — the one call plan.md and fast-mode.md carry (STORY-2-4 "a call, not
// inline policy"): computes the lane recommendation, applies the human's chosen
// lane, and writes both into the backlog header idempotently. Re-running with the
// same `--chosen` is a no-op write; a different `--chosen` updates the lines in
// place rather than appending a second pair.
function record(backlogPath, chosen) {
  const result = decideLane(readSelectLines(backlogPath))
  const { choice, alternative, overridden } = recordChoice(result.lane, chosen, CLOSED.lane)
  const content = readFileSync(backlogPath, 'utf8')
  let next = upsertHeaderLine(content, LANE_LINE_RE, laneLine(result, choice))
  next = upsertHeaderLine(
    next,
    OVERRIDE_LANE_LINE_RE,
    overridden ? overrideLine(result, choice) : null,
    LANE_LINE_RE,
  )
  if (next !== content) writeFileSync(backlogPath, next)
  return { ...result, choice, alternative, overridden }
}

// Argument-shape errors throw, so a bad invocation exits non-zero with no output.
function runCli(argv) {
  const [command, ...rest] = argv
  const flags = parseFlags(rest)

  if (command === 'story' && flags.line !== undefined) {
    const result = decideStory(parse(flags.line))
    return { ...result, ...recordChoice(result.mode, flags.chosen, CLOSED.mode) }
  }
  if (command === 'lane' && flags.file !== undefined) {
    const result = decideLane(readSelectLines(flags.file))
    return { ...result, ...recordChoice(result.lane, flags.chosen, CLOSED.lane) }
  }
  if (command === 'record' && flags.file !== undefined && flags.chosen !== undefined) {
    return record(flags.file, flags.chosen)
  }
  throw new Error(
    'usage: mode-select.mjs story --line <select> [--chosen <mode>] | ' +
      'lane --file <backlog> [--chosen <lane>] | record --file <backlog> --chosen <lane>',
  )
}

// Compared by realpath, as in mode-select-fields.mjs, so a plugin-cache symlink still runs.
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
})()
if (isMain) {
  process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)), null, 2)}\n`)
}
