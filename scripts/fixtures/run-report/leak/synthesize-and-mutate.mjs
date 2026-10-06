#!/usr/bin/env node
//
// synthesize-and-mutate.mjs — STORY-1-7 schema leak-proofing.
//
// WHY A SYNTHESIZED REPORT, NOT A FIXTURE
//
// AC1/AC2 ask for coverage of every leaf the SCHEMA declares, not of
// whatever a hand-written fixture happens to populate. build/review/debt are
// stubs today (every field null) and gain real fields in later stories; a
// fixture-driven mutation test would silently stop covering them the moment
// someone forgot to extend it by hand. Walking REPORT_SCHEMA and synthesizing
// one minimal, fully-populated valid report — including exactly one element
// for every array — gets every leaf for free, now and after those stories
// land, with no second place to remember to update.
//
// This script never imports run-report.mjs's VALUE, only its exported
// schema/validator — it asserts the schema is leak-proof, it does not decide
// what the schema should contain (that is run-report.mjs's own call, and a
// finding against it is reported, not patched here).
//
// Prints "ok" and exits 0 if every check holds; otherwise prints one failure
// per line to stdout and exits 1.
//
// Usage: node synthesize-and-mutate.mjs <run-report.mjs> <run-report-categories.mjs>

import { pathToFileURL } from 'node:url'

const [runReportPath, categoriesPath] = process.argv.slice(2)
if (!runReportPath || !categoriesPath) {
  process.stdout.write('usage: synthesize-and-mutate.mjs <run-report.mjs> <run-report-categories.mjs>\n')
  process.exit(2)
}

const { REPORT_SCHEMA, PATTERNS, validate } = await import(pathToFileURL(runReportPath).href)
const categories = await import(pathToFileURL(categoriesPath).href)
const { isMember } = categories
const ALL = categories.default

const fails = []

// isMember throws on an unknown vocabulary name (run-report-categories.mjs's
// own loud-failure contract) — delegate to it rather than re-listing OPEN/
// CLOSED here, or this test would drift from the vocabulary module exactly
// the way ADR 0001 forbids.
function vocabExists(name) {
  try {
    isMember(name, '__probe__')
    return true
  } catch {
    return false
  }
}

const patternSample = (name) =>
  ({ uuid_v4: '3f2b8c1e-9a4d-4e7f-8b21-6c5d4e3f2a10', semver: '1.2.3', iso_utc_seconds: '2020-01-01T00:00:00Z', decision_id: '0123456789abcdef' })[name]

// A minimal valid value for one schema node. Doubles as the "every spec is
// one of the bounded types" assertion (AC1): a spec type or vocab name this
// function does not recognise is pushed to `fails` instead of thrown, so one
// unrecognised leaf does not hide every other failure in the same run.
function synth(spec) {
  switch (spec.type) {
    case 'const':
      return spec.value
    case 'enum': {
      if (!vocabExists(spec.vocab)) {
        fails.push(`enum vocab "${spec.vocab}" is not in run-report-categories.mjs`)
        return null
      }
      return ALL[spec.vocab][0]
    }
    case 'number':
      return spec.min !== undefined ? spec.min : 0
    case 'bool':
      return false
    case 'pattern':
      return patternSample(spec.name)
    case 'object': {
      const o = {}
      for (const [k, sub] of Object.entries(spec.fields)) o[k] = synth(sub)
      return o
    }
    case 'array':
      return [synth(spec.items)]
    case 'countMap': {
      if (!vocabExists(spec.vocab)) {
        fails.push(`countMap vocab "${spec.vocab}" is not in run-report-categories.mjs`)
        return {}
      }
      return { [ALL[spec.vocab][0]]: 0 }
    }
    case 'numericRecord':
      return { sample_metric: 0 }
    default:
      // The exact failure AC1 asks for: a field added to the schema with a
      // type the validator (and this test) does not know is not a closed
      // enum/number/pattern/nested object or array — it is unbounded by
      // default, and must fail loudly rather than validate silently.
      fails.push(`unknown spec type "${spec.type}" — not one of const/enum/number/pattern/object/array/countMap/numericRecord`)
      return null
  }
}

// One entry per mutable leaf: `keys` locates it inside the synthesized
// report (array leaves always index 0, since every array was synthesized
// with exactly one element), `label` is for failure messages.
function collectLeaves(spec, keys, label, out) {
  switch (spec.type) {
    case 'object':
      for (const [k, sub] of Object.entries(spec.fields)) collectLeaves(sub, [...keys, k], `${label}.${k}`, out)
      return
    case 'array':
      collectLeaves(spec.items, [...keys, 0], `${label}[0]`, out)
      return
    case 'const':
    case 'enum':
    case 'number':
    case 'bool':
    case 'pattern':
    case 'countMap':
    case 'numericRecord':
      out.push({ keys, label, spec })
      return
    default:
      return // already recorded by synth()
  }
}

function getAt(obj, keys) {
  return keys.reduce((o, k) => o[k], obj)
}
function setAt(obj, keys, value) {
  const parent = keys.slice(0, -1).reduce((o, k) => o[k], obj)
  parent[keys.at(-1)] = value
  return obj
}
const clone = (o) => JSON.parse(JSON.stringify(o))

const base = synth(REPORT_SCHEMA)
const baseViolations = validate(base)
if (baseViolations.length) {
  fails.push(`synthesized base report is not itself valid: ${baseViolations.join('; ')}`)
}

// ADR-0002 amends ADR-0001's "exactly three patterns": decision_id is the
// fourth, at the two paths that carry the join key.
const leaves = []
collectLeaves(REPORT_SCHEMA, [], '$', leaves)
const patternPaths = leaves.filter((l) => l.spec.type === 'pattern').map((l) => l.label).sort()
const wantPatternPaths = ['$.decisions[0].decision_id', '$.outcome_events[0].decision_id', '$.run.ended_at', '$.run.plugin_version', '$.run.run_id'].sort()
if (JSON.stringify(patternPaths) !== JSON.stringify(wantPatternPaths)) {
  fails.push(`pattern leaves are ${JSON.stringify(patternPaths)}, want exactly ${JSON.stringify(wantPatternPaths)} (ADR 0002)`)
}
if (Object.keys(PATTERNS).length !== 4) fails.push(`PATTERNS exports ${Object.keys(PATTERNS).length} patterns, want exactly 4`)

const LONG = 'A'.repeat(4096)
const PATH_LIKE = `/etc/passwd/${'A'.repeat(4096)}`
const CODE_LIKE = `() => { return 1; };${';'.repeat(4096)}`
const STRINGS = [LONG, PATH_LIKE, CODE_LIKE]

function expectRejected(mutate, description) {
  const r = clone(base)
  mutate(r)
  if (!validate(r).length) fails.push(`accepted: ${description}`)
}

for (const leaf of leaves) {
  const { keys, label, spec } = leaf
  if (spec.type === 'countMap') {
    const obj = getAt(base, keys)
    const existingKey = Object.keys(obj)[0]
    for (const s of STRINGS) {
      expectRejected((r) => (getAt(r, keys)[existingKey] = s), `${label}[${existingKey}] (countMap value) = stuffed string`)
    }
    for (const s of STRINGS) {
      expectRejected((r) => (getAt(r, keys)[s] = 0), `${label}[stuffed key] (countMap key) = 0`)
    }
    continue
  }
  if (spec.type === 'numericRecord') {
    const obj = getAt(base, keys)
    const existingKey = Object.keys(obj)[0]
    for (const s of STRINGS) {
      expectRejected((r) => (getAt(r, keys)[existingKey] = s), `${label}.${existingKey} (numericRecord value) = stuffed string`)
      expectRejected((r) => (getAt(r, keys)[s] = 0), `${label}[stuffed key] (numericRecord key) = 0`)
      expectRejected((r) => (getAt(r, keys)[existingKey] = { nested: s }), `${label}.${existingKey}.nested (numericRecord nested value) = stuffed string`)
    }
    continue
  }
  // const / enum / number / pattern: scalar leaves.
  for (const s of STRINGS) {
    expectRejected((r) => setAt(r, keys, s), `${label} = stuffed string`)
  }
  if (spec.type === 'pattern') {
    // Anchoring check: a long string that CONTAINS a valid match must still
    // be rejected — a non-anchored or substring-matching regex would leak a
    // free string wrapped around a valid-looking token.
    const anchored = `noise-${patternSample(spec.name)}-${'A'.repeat(4096)}`
    expectRejected((r) => setAt(r, keys, anchored), `${label} = long string containing a valid ${spec.name} match as a substring`)
  }
}

// AC2: an extra unknown field, top-level and nested, must be rejected.
expectRejected((r) => (r.unexpected_top_level_field = 'x'), 'unknown top-level field')
expectRejected((r) => (r.run.unexpected_nested_field = 'x'), 'unknown nested field (run.*)')

process.stdout.write(fails.length ? `${fails.join('\n')}\n` : 'ok\n')
process.exit(fails.length ? 1 : 0)
