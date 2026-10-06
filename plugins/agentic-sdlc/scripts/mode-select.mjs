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

import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from './mode-select-fields.mjs'

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
    reason: `score ${score} in the gap resolves to PAIR, flagged borderline`,
  }
}

// A lane is advisory: one floor anywhere, or two stories that need a pair, is
// enough to take the whole epic off the fast lane.
export function decideLane(stories, rubricData = RUBRIC) {
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
    reason,
  }
}

// Argument-shape errors throw, so a bad invocation exits non-zero with no output.
function runCli(argv) {
  const [command, flag, value] = argv
  if (command === 'story' && flag === '--line' && value !== undefined) {
    return decideStory(parse(value))
  }
  if (command === 'lane' && flag === '--file' && value !== undefined) {
    const stories = readFileSync(value, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^- select:/.test(line))
      .map((line) => parse(line))
    return decideLane(stories)
  }
  throw new Error('usage: mode-select.mjs story --line <select> | lane --file <backlog>')
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
