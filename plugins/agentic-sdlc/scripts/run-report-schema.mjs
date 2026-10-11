// run-report-schema.mjs — the report schema and its validator, shared by the
// client (run-report.mjs) and the ingest Worker so the two cannot disagree on
// what a valid report is. Kept free of node: imports so it bundles for the edge.
//
// Zero dependencies, Node 22 (the repo floor).

import { OUTCOME_MEASURES, PATTERNS, isMember } from './run-report-categories.mjs'

export { PATTERNS }

// numericRecord keys come from meter.mjs, not a vocabulary, so they are bounded
// by shape instead: short snake_case cannot carry a path, branch or sentence.
const NUMERIC_KEY = /^[a-z][a-z0-9_]{0,63}$/
const NUMERIC_RECORD_MAX_KEYS = 64
const NUMERIC_RECORD_MAX_DEPTH = 4

// Every spec is nullable unless wrapped in required(): ADR 0001's null means
// "input missing, named in degraded", and that applies to every field.
export const T = Object.freeze({
  const: (value) => ({ type: 'const', value }),
  enum: (vocab) => ({ type: 'enum', vocab }),
  number: (opts = {}) => ({ type: 'number', ...opts }),
  pattern: (name) => ({ type: 'pattern', name }),
  object: (fields) => ({ type: 'object', fields }),
  array: (items) => ({ type: 'array', items }),
  countMap: (vocab) => ({ type: 'countMap', vocab }),
  numericRecord: () => ({ type: 'numericRecord' }),
  bool: () => ({ type: 'bool' }),
})
const required = (spec) => ({ ...spec, nullable: false })
const count = () => T.number({ int: true, min: 0 })

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v)
  return Object.freeze(o)
}

// One lane/floor/score/override/correction decision (ADR 0002). Tokens and
// numbers only: the subject that feeds decision_id never reaches the report.
// rubric/floor/score/alternative are omittable: a floor decision has no score and
// most have no alternative, and an explicit null would demand a degraded entry
// for a gap that is not one. Absent means omitted, so a present null is rejected
// outright rather than excused by some unrelated degraded entry.
const omittable = (spec) => ({ ...spec, optional: true, nullable: false })

const decisionElement = () =>
  T.object({
    decision_id: required(T.pattern('decision_id')),
    layer: required(T.enum('decision_layer')),
    rubric: omittable(T.number({ int: true, min: 1 })),
    floor: omittable(T.enum('decision_floor')),
    score: omittable(T.number({ int: true, min: 0 })),
    choice: required(T.enum('decision_choice')),
    alternative: omittable(T.enum('decision_choice')),
    overridden: required(T.bool()),
    fallback: required(T.bool()),
    // Present once the outcome window closed the decision; an open or orphaned
    // one has no verdict, and a null would demand a degraded entry.
    verdict: omittable(T.enum('decision_verdict')),
    verdict_rubric: omittable(T.number({ int: true, min: 1 })),
    // Corrections only: what fired them, so exported corrections stay comparable.
    trigger: omittable(T.enum('correction_trigger')),
  })

// A verdict this run settled, possibly on an earlier run's decision: that run's
// report is already written, so the settling run is the only place it can surface.
const settlementElement = () =>
  T.object({
    decision_id: required(T.pattern('decision_id')),
    verdict: required(T.enum('decision_verdict')),
    verdict_rubric: required(T.number({ int: true, min: 1 })),
  })

// An event this run appended to a decision, possibly an earlier run's. The
// measures are a closed key list, so the element stays tokens and integers.
const outcomeEventElement = () =>
  T.object({
    decision_id: required(T.pattern('decision_id')),
    event: required(T.enum('outcome_event')),
    ...Object.fromEntries(OUTCOME_MEASURES.map((k) => [k, omittable(count())])),
  })

export const REPORT_SCHEMA = deepFreeze(
  required(
    T.object({
      schema: required(T.const(1)),
      run: required(
        T.object({
          run_id: T.pattern('uuid_v4'),
          plugin_version: T.pattern('semver'),
          command: T.enum('command'),
          lane: T.enum('lane'),
          outcome: T.enum('outcome'),
          ended_at: T.pattern('iso_utc_seconds'),
          wall_clock_s: T.number({ int: true, min: 0 }),
          sessions: T.number({ int: true, min: 1 }),
        }),
      ),
      plan: required(
        T.object({
          epics: count(),
          stories: count(),
          tasks: count(),
          arch_handoffs: T.countMap('arch_category'),
        }),
      ),
      build: required(
        T.object({
          stories: T.array(required(T.object({ mode: required(T.enum('mode')), alternations: count() }))),
          arch_blocks: T.countMap('arch_category'),
          revise_rounds: count(),
          gate_runs: count(),
          gate_failures: count(),
        }),
      ),
      review: required(
        T.object({
          rounds: count(),
          verdict: T.enum('verdict'),
          findings: T.array(
            required(
              T.object({
                round: required(T.number({ int: true, min: 1 })),
                category: required(T.enum('finding_category')),
                severity: required(T.enum('severity')),
              }),
            ),
          ),
        }),
      ),
      debt: required(
        T.object({
          rows_logged: count(),
          by_risk: T.countMap('risk'),
          by_category: T.countMap('debt_category'),
        }),
      ),
      cost: T.object({
        schema: required(T.number({ int: true, min: 1 })),
        totals: required(T.numericRecord()),
        derived: required(T.numericRecord()),
      }),
      degraded: required(T.array(required(T.enum('degraded_input')))),
      // Omittable, not nullable: a run that makes no decisions leaves the key out
      // entirely, and a null would be an unnamed gap the degraded rule rejects.
      decisions: { ...T.array(required(decisionElement())), optional: true, nullable: false },
      outcome_events: { ...T.array(required(outcomeEventElement())), optional: true, nullable: false },
      settlements: { ...T.array(required(settlementElement())), optional: true, nullable: false },
    }),
  ),
)

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
// Report-supplied keys reach stderr in violation paths; cap them so a stuffed key
// cannot turn the error message into the leak.
const keyLabel = (k) => JSON.stringify(String(k).slice(0, 40))

// Values that are null by the meter's own semantics (e.g. cost_usd_reported) are
// measurements, so a numericRecord's nulls do not demand a degraded entry.
export function checkNumericRecord(value, path, out, depth = 0) {
  if (!isPlainObject(value)) return out.push(`${path}: must be an object of numbers`)
  if (depth >= NUMERIC_RECORD_MAX_DEPTH) return out.push(`${path}: nested too deep`)
  const keys = Object.keys(value)
  if (keys.length > NUMERIC_RECORD_MAX_KEYS) out.push(`${path}: more than ${NUMERIC_RECORD_MAX_KEYS} keys`)
  for (const k of keys) {
    const p = `${path}[${keyLabel(k)}]`
    if (!NUMERIC_KEY.test(k)) {
      out.push(`${p}: key is not short snake_case`)
      continue
    }
    const v = value[k]
    if (v === null) continue
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`${p}: must be finite`)
    } else if (isPlainObject(v)) {
      checkNumericRecord(v, p, out, depth + 1)
    } else {
      out.push(`${p}: must be a number or null`)
    }
  }
}

function walk(spec, value, path, out, state) {
  if (value === null) {
    if (spec.nullable === false) out.push(`${path}: must not be null`)
    else state.nulls++
    return
  }
  switch (spec.type) {
    case 'const':
      if (value !== spec.value) out.push(`${path}: must be ${JSON.stringify(spec.value)}`)
      return
    case 'enum':
      if (typeof value !== 'string' || !isMember(spec.vocab, value)) out.push(`${path}: not a ${spec.vocab} member`)
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return out.push(`${path}: must be a finite number`)
      if (spec.int && !Number.isInteger(value)) out.push(`${path}: must be an integer`)
      if (spec.min !== undefined && value < spec.min) out.push(`${path}: must be ≥ ${spec.min}`)
      return
    case 'bool':
      if (typeof value !== 'boolean') out.push(`${path}: must be a boolean`)
      return
    case 'pattern':
      if (typeof value !== 'string' || !PATTERNS[spec.name].test(value)) out.push(`${path}: does not match ${spec.name}`)
      return
    case 'object':
      if (!isPlainObject(value)) return out.push(`${path}: must be an object`)
      for (const k of Object.keys(value)) {
        if (!Object.hasOwn(spec.fields, k)) out.push(`${path}[${keyLabel(k)}]: unknown field`)
      }
      for (const [k, sub] of Object.entries(spec.fields)) {
        if (!Object.hasOwn(value, k)) {
          if (!sub.optional) out.push(`${path}.${k}: missing`)
        }
        else walk(sub, value[k], `${path}.${k}`, out, state)
      }
      return
    case 'array':
      if (!Array.isArray(value)) return out.push(`${path}: must be an array`)
      value.forEach((item, i) => walk(spec.items, item, `${path}[${i}]`, out, state))
      return
    case 'countMap':
      if (!isPlainObject(value)) return out.push(`${path}: must be an object`)
      for (const [k, v] of Object.entries(value)) {
        const p = `${path}[${keyLabel(k)}]`
        if (!isMember(spec.vocab, k)) out.push(`${p}: key is not a ${spec.vocab} member`)
        if (!Number.isInteger(v) || v < 0) out.push(`${p}: must be a non-negative integer`)
      }
      return
    case 'numericRecord':
      checkNumericRecord(value, path, out)
      return
    default:
      out.push(`${path}: schema has unknown type ${JSON.stringify(spec.type)}`)
  }
}

// Returns a list of violations; empty means valid. Beyond shape it enforces the
// no-silent-gaps rule: a null anywhere needs a named input in `degraded`.
export function validate(report) {
  const out = []
  const state = { nulls: 0 }
  walk(REPORT_SCHEMA, report, '$', out, state)
  if (isPlainObject(report) && Array.isArray(report.degraded)) {
    if (new Set(report.degraded).size !== report.degraded.length) out.push('$.degraded: duplicate entries')
    if (state.nulls > 0 && report.degraded.length === 0) out.push('$: null field(s) with nothing named in degraded')
  }
  return out
}
