#!/usr/bin/env node
// Re-validates every stored report against the shipped schema, so the store's
// own checks are never the only line of defence.
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validate } from '../plugins/agentic-sdlc/scripts/run-report-schema.mjs'

export const REASONS = ['unreadable', 'oversize', 'not_json', 'envelope_invalid', 'report_invalid', 'superseded', 'run_id_conflict']
const MAX_BYTES = 20 * 1024
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const ENVELOPE_KEYS = ['envelope', 'source', 'source_first_seen', 'received_at', 'report']
// Anchored and fixed-width so a hostile timestamp cannot carry a payload.
const ISO_SECONDS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// A bare schema-1 report is the local-mode shape: no envelope to check.
const unwrap = (doc, mtime) => {
  if (isObj(doc) && doc.schema === 1 && !('envelope' in doc)) {
    return { report: doc, source: 'local', received_at: mtime.toISOString().slice(0, 19) + 'Z' }
  }
  const ok = isObj(doc) && doc.envelope === 1 &&
    Object.keys(doc).every((k) => ENVELOPE_KEYS.includes(k)) &&
    ENVELOPE_KEYS.every((k) => k in doc) &&
    typeof doc.source === 'string' && /^[0-9a-f]{32}$/.test(doc.source) &&
    typeof doc.source_first_seen === 'string' && ISO_SECONDS.test(doc.source_first_seen) &&
    typeof doc.received_at === 'string' && ISO_SECONDS.test(doc.received_at) &&
    isObj(doc.report)
  return ok ? { report: doc.report, source: doc.source, received_at: doc.received_at } : null
}

const classify = (path) => {
  let size, mtime
  try { ({ size, mtime } = statSync(path)) } catch { return { reason: 'unreadable' } }
  // Size is judged before reading so a hostile file is never loaded.
  if (size > MAX_BYTES) return { reason: 'oversize' }
  let text
  try { text = readFileSync(path, 'utf8') } catch { return { reason: 'unreadable' } }
  let doc
  try { doc = JSON.parse(text) } catch { return { reason: 'not_json' } }
  const wrapped = unwrap(doc, mtime)
  if (!wrapped) return { reason: 'envelope_invalid' }
  if (validate(wrapped.report).length > 0) return { reason: 'report_invalid' }
  return wrapped
}

export function scan(dir, { now = new Date() } = {}) {
  const cutoff = now.getTime() - WINDOW_MS
  let skipped = 0
  const names = readdirSync(dir).sort()
  const rejected = Object.fromEntries(REASONS.map((r) => [r, 0]))
  // Dedupe only sees valid reports, or a poisoned copy could evict a good one.
  const byRun = new Map()
  for (const name of names) {
    const res = classify(join(dir, name))
    if (res.reason) { rejected[res.reason]++; continue }
    // Windowing precedes grouping so a stale copy can neither supersede nor be counted superseded.
    if (Date.parse(res.received_at) < cutoff) { skipped++; continue }
    // Local-mode reports have no source to disagree with, so they dedupe among themselves.
    const id = (res.source === 'local' ? 'local:' : 'remote:') + res.report.run.run_id
    if (!byRun.has(id)) byRun.set(id, [])
    byRun.get(id).push({ name, ...res })
  }
  let accepted = 0
  for (const copies of byRun.values()) {
    if (new Set(copies.map((c) => c.source)).size > 1) {
      rejected.run_id_conflict += copies.length
      continue
    }
    accepted++
    rejected.superseded += copies.length - 1
  }
  return { files: names.length, accepted, rejected, skipped_window: skipped }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  // Last occurrence wins so a caller can override an earlier flag.
  const flag = (n) => { const i = args.lastIndexOf(n); return i < 0 ? undefined : args[i + 1] }
  const source = flag('--source') ?? ''
  const nowArg = flag('--now')
  const now = nowArg === undefined ? new Date() : new Date(nowArg)
  if (Number.isNaN(now.getTime())) {
    console.error('signal-scan: --now must be an ISO timestamp')
    process.exit(2)
  }
  if (!source.startsWith('dir:')) {
    console.error('usage: signal-scan.mjs --source dir:<path> [--now <iso>]')
    process.exit(2)
  }
  console.log(JSON.stringify(scan(source.slice(4), { now })))
}
