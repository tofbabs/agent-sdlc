#!/usr/bin/env node
//
// mode-select-fields.mjs — the one place every selection-field name, enum and
// evidence rule lives.
//
// WHY ONE MODULE
//
// EPIC-2 STORY-2-1: the planner writes selection fields (risk class, one-way
// doors touched, existing-pattern flag, modules crossed, review-bounced,
// risk kind) and `mode-select.mjs` (STORY-2-3+) reads them to score a lane and
// a pairing mode. Both sides used to agree on this only by convention — the
// same failure run-report-categories.mjs exists to prevent for run reports.
// This module is that fix for selection fields: FIELDS is the frozen spec,
// validate() is the only gate a value passes through, and parse/format own
// the one-line backlog syntax so no second parser ever grows up beside it.
//
// SAME SHAPE FOR A STORY AND A FAST TASK (AC4): FIELDS has no "which lane"
// branch — a FAST task's `- select:` line uses the identical field set.
//
// EVIDENCE IS NOT OPTIONAL (AC2, AC3): every field value carries exactly one
// citation (`brief:L<n>`, `brief:L<n>-L<m>`, or `AC<n>`), so a selection can
// always be traced back to the line that justified it. validate() rejects a
// value with zero or more than one citation — "freestanding" is not a valid
// state, not a lenient one.
//
// Zero dependencies, Node 22 (the repo floor).

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Risk-class enum: the brief's named floor classes, plus "none" for a
// story/task that touches no floor. Floor *scoring* (what each class costs)
// is STORY-2-3's rubric, not this module's concern — this is vocabulary only.
const RISK_CLASS = Object.freeze(['none', 'money', 'auth', 'destructive_data'])

// risk_kind splits a non-"none" risk_class into a code change or a data
// change — the brief's existing data_risk/code_risk distinction, carried
// here as a field of its own so a reader never has to infer it from prose.
const RISK_KIND = Object.freeze(['code', 'data'])

const BOOLEAN_YES_NO = Object.freeze(['yes', 'no'])

// The pairing modes a story can dispatch under. Kept beside the field enums so
// the scorer and the recorder read one vocabulary; CLOSED.mode in
// run-report-categories.mjs is the run-report lane vocabulary and does not
// carry SOLO_OPUS, so it cannot be used for dispatch choices.
export const DISPATCH_MODES = Object.freeze(['SOLO', 'SOLO_OPUS', 'PAIR'])

// FIELDS is the frozen spec every reader (planner, mode-select.mjs, this
// module's own validate/parse/format) must import rather than re-declare.
// `kind` drives both validation and the one-line codec below.
export const FIELDS = Object.freeze({
  risk_class: Object.freeze({ kind: 'enum', values: RISK_CLASS }),
  one_way_doors: Object.freeze({ kind: 'count' }),
  existing_pattern: Object.freeze({ kind: 'bool' }),
  modules_crossed: Object.freeze({ kind: 'count' }),
  review_bounced: Object.freeze({ kind: 'bool' }),
  risk_kind: Object.freeze({ kind: 'enum', values: RISK_KIND }),
})

export const FIELD_NAMES = Object.freeze(Object.keys(FIELDS))

// Evidence must be exactly one citation of one of these shapes. Anchored and
// exclusive (no alternation leaking a second citation past the regex).
const EVIDENCE_PATTERN = /^(brief:L\d+(-L\d+)?|AC\d+)$/

function isCitation(value) {
  return typeof value === 'string' && EVIDENCE_PATTERN.test(value)
}

// A field value's raw (unvalidated) form, before kind-specific checks.
function isWellFormedCount(raw) {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
}

// validate(fields) — the only gate a selection-field object passes through.
// Returns a list of human-readable errors; empty means valid. Checks, per
// field: present, right shape for its kind, and exactly one evidence
// citation matching EVIDENCE_PATTERN (AC3: no citation is rejected, same as
// a malformed one — there is no "trust me" state).
export function validate(fields) {
  const errors = []
  if (fields == null || typeof fields !== 'object') {
    return ['fields must be an object']
  }

  for (const name of FIELD_NAMES) {
    const spec = FIELDS[name]
    const entry = fields[name]

    if (entry === undefined) {
      errors.push(`${name}: missing`)
      continue
    }
    if (typeof entry !== 'object' || entry === null || !('value' in entry)) {
      errors.push(`${name}: must be { value, evidence }`)
      continue
    }

    const { value, evidence } = entry

    if (spec.kind === 'enum' && !spec.values.includes(value)) {
      errors.push(`${name}: value "${value}" is not one of ${spec.values.join('|')}`)
    } else if (spec.kind === 'count' && !isWellFormedCount(value)) {
      errors.push(`${name}: value must be a non-negative integer, got "${value}"`)
    } else if (spec.kind === 'bool' && typeof value !== 'boolean') {
      errors.push(`${name}: value must be a boolean, got "${value}"`)
    }

    if (evidence === undefined || evidence === null) {
      errors.push(`${name}: missing evidence citation`)
    } else if (Array.isArray(evidence)) {
      errors.push(`${name}: evidence must be exactly one citation, got ${evidence.length}`)
    } else if (!isCitation(evidence)) {
      errors.push(`${name}: evidence "${evidence}" does not match brief:L<n>[-L<m>] or AC<n>`)
    }
  }

  return errors
}

function formatValue(name, value) {
  const spec = FIELDS[name]
  if (spec.kind === 'bool') return value ? 'yes' : 'no'
  return String(value)
}

function parseValue(name, raw) {
  const spec = FIELDS[name]
  if (spec.kind === 'bool') {
    if (!BOOLEAN_YES_NO.includes(raw)) return undefined
    return raw === 'yes'
  }
  if (spec.kind === 'count') {
    if (!/^\d+$/.test(raw)) return undefined
    return Number.parseInt(raw, 10)
  }
  return raw // enum: validate() checks membership
}

// format(fields) → the one compact `- select: ...` line the planner writes.
// Field order is FIELD_NAMES — fixed, so a round trip never reorders.
export function format(fields) {
  const errors = validate(fields)
  if (errors.length > 0) {
    throw new Error(`mode-select-fields: cannot format invalid fields: ${errors.join('; ')}`)
  }
  const parts = FIELD_NAMES.map((name) => {
    const { value, evidence } = fields[name]
    return `${name}=${formatValue(name, value)}@${evidence}`
  })
  return `- select: ${parts.join(' ')}`
}

// parse(line) → fields object, or throws with every parse error it finds.
// Deliberately strict: a short backlog line with a typo should fail loudly
// at plan time, not silently drop a field that mode-select.mjs then treats
// as absent.
export function parse(line) {
  const body = line.trim().replace(/^-\s*select:\s*/, '')
  if (body === line.trim()) {
    throw new Error('mode-select-fields: line does not start with "- select:"')
  }

  const tokens = body.split(/\s+/).filter(Boolean)
  const seen = new Map()
  const errors = []

  for (const token of tokens) {
    const match = token.match(/^([a-z_]+)=([^@]*)@(.+)$/)
    if (!match) {
      errors.push(`malformed token "${token}"`)
      continue
    }
    const [, name, rawValue, evidence] = match
    if (!FIELD_NAMES.includes(name)) {
      errors.push(`unknown field "${name}"`)
      continue
    }
    if (seen.has(name)) {
      errors.push(`duplicate field "${name}"`)
      continue
    }
    const value = parseValue(name, rawValue)
    if (value === undefined) {
      errors.push(`${name}: cannot parse value "${rawValue}"`)
      continue
    }
    seen.set(name, { value, evidence })
  }

  for (const name of FIELD_NAMES) {
    if (!seen.has(name)) errors.push(`${name}: missing from line`)
  }

  if (errors.length > 0) {
    throw new Error(`mode-select-fields: parse failed: ${errors.join('; ')}`)
  }

  const fields = Object.fromEntries(seen)
  const validationErrors = validate(fields)
  if (validationErrors.length > 0) {
    throw new Error(`mode-select-fields: parsed line is invalid: ${validationErrors.join('; ')}`)
  }
  return fields
}

// findSelectLine(block) — locates the "- select: ..." line inside a story's
// or FAST task's raw text, if one exists. Lets a caller (mode-select.mjs,
// /build) tell "no select line" (returns null — AC4's documented fallback to
// the prose `risk:` rule) apart from "a select line that fails to parse"
// (returns the line; parse() then throws) — a prose-risk: fallback must not
// conflate the two.
export function findSelectLine(block) {
  if (typeof block !== 'string') return null
  const match = block.match(/^-\s*select:.*$/m)
  return match ? match[0] : null
}

export default FIELDS

// Compared by realpath: import.meta.url is already resolved, so a symlinked
// invocation (a plugin cache link) would otherwise never match argv[1].
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
})()
if (isMain) {
  process.stdout.write(`${JSON.stringify(FIELDS, null, 2)}\n`)
}
