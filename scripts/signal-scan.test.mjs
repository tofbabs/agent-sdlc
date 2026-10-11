// Drives the CLI over temp dirs so the summary a human reads is what is pinned.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const SCAN = new URL('./signal-scan.mjs', import.meta.url).pathname
const report = JSON.parse(readFileSync(new URL('./fixtures/signal/report.json', import.meta.url), 'utf8'))
const NOW = '2026-10-09T12:00:00Z'
const REASONS = ['unreadable', 'oversize', 'not_json', 'envelope_invalid', 'report_invalid', 'superseded', 'run_id_conflict']

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name} ${detail}`); failed = 1 }
}

const envelope = (r = report, over = {}) => ({
  envelope: 1,
  source: 'a'.repeat(32),
  source_first_seen: '2026-09-01T00:00:00Z',
  received_at: '2026-10-07T10:00:00Z',
  report: r,
  ...over,
})
const withDir = (files, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'signal-scan-'))
  try {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body))
    }
    return fn(dir)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const run = (dir, extra = []) =>
  execFileSync('node', [SCAN, '--source', `dir:${dir}`, '--now', NOW, ...extra], { encoding: 'utf8' })
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

// --- every file lands in exactly one bucket ---------------------------------
{
  const bad = structuredClone(report)
  bad.run.command = 'not-a-command'
  const files = {
    'a-envelope.json': envelope(),
    'b-bare.json': report,
    'c-garbage.json': '{nope',
    'd-huge.json': ' '.repeat(21 * 1024),
    'e-bad-envelope.json': envelope(report, { envelope: 2 }),
    'f-bad-report.json': envelope(bad),
  }
  withDir(files, (dir) => {
    const s = JSON.parse(run(dir))
    check('files counted', s.files === 6, JSON.stringify(s))
    check('both envelope and bare reports accepted', s.accepted === 2, JSON.stringify(s))
    check('rejected lists the full closed reason set, zero-filled',
      JSON.stringify(Object.keys(s.rejected)) === JSON.stringify(REASONS), JSON.stringify(s.rejected))
    check('each failure maps to its own reason',
      s.rejected.not_json === 1 && s.rejected.oversize === 1 &&
      s.rejected.envelope_invalid === 1 && s.rejected.report_invalid === 1, JSON.stringify(s.rejected))
    check('counts sum to the file count',
      s.accepted + sum(s.rejected) + s.skipped_window === s.files, JSON.stringify(s))
  })
}

// --- poisoned content never reaches later stages ----------------------------
{
  const unknownInReport = structuredClone(report)
  unknownInReport.smuggled = 'x'
  const longString = structuredClone(report)
  longString.run.command = 'x'.repeat(10 * 1024)
  const files = {
    'a-ok.json': envelope(),
    'b-envelope-extra.json': envelope(report, { note: 'hi' }),
    'c-bad-timestamp.json': envelope(report, { received_at: 'yesterday' }),
    'd-long-timestamp.json': envelope(report, { source_first_seen: '2026-09-01T00:00:00Z'.padEnd(5000, '0') }),
    'e-report-unknown-field.json': envelope(unknownInReport),
    'f-report-long-string.json': envelope(longString),
    'g-bare-unknown-field.json': unknownInReport,
    'h-envelope-missing-report.json': { ...envelope(), report: undefined },
  }
  withDir(files, (dir) => {
    const s = JSON.parse(run(dir))
    check('only the clean envelope is accepted', s.accepted === 1, JSON.stringify(s))
    check('envelope-level poison is envelope_invalid',
      s.rejected.envelope_invalid === 4, JSON.stringify(s.rejected))
    check('report-level poison is report_invalid',
      s.rejected.report_invalid === 3, JSON.stringify(s.rejected))
    check('counts sum to the file count',
      s.accepted + sum(s.rejected) + s.skipped_window === s.files, JSON.stringify(s))
  })
}

// --- run_id dedupe is order-independent -------------------------------------
{
  const other = structuredClone(report)
  other.run.run_id = '11111111-2222-4333-8444-555555555555'
  const older = envelope(report, { received_at: '2026-10-05T10:00:00Z' })
  const newer = envelope(report, { received_at: '2026-10-07T10:00:00Z' })
  const layouts = {
    'latest wins, older superseded': [{ 'a.json': older, 'b.json': newer, 'c.json': envelope(other) }],
    'same result with the file order reversed': [{ 'a.json': newer, 'b.json': older, 'c.json': envelope(other) }],
  }
  for (const [label, [files]] of Object.entries(layouts)) {
    withDir(files, (dir) => {
      const s = JSON.parse(run(dir))
      check(`${label}: one superseded, two accepted`,
        s.accepted === 2 && s.rejected.superseded === 1 && s.rejected.run_id_conflict === 0, JSON.stringify(s))
      check(`${label}: counts sum to the file count`,
        s.accepted + sum(s.rejected) + s.skipped_window === s.files, JSON.stringify(s))
    })
  }

  const conflicting = {
    'a.json': envelope(report, { source: 'a'.repeat(32) }),
    'b.json': envelope(report, { source: 'b'.repeat(32) }),
    'c.json': envelope(report, { source: 'b'.repeat(32), received_at: '2026-10-06T10:00:00Z' }),
    'd.json': envelope(other),
  }
  withDir(conflicting, (dir) => {
    const s = JSON.parse(run(dir))
    check('a run_id under two sources rejects every copy, superseded or not',
      s.rejected.run_id_conflict === 3 && s.rejected.superseded === 0 && s.accepted === 1, JSON.stringify(s))
  })

  // Invalid reports never join dedupe, or a poisoned copy could evict a good one.
  const bad = structuredClone(report)
  bad.smuggled = 1
  withDir({ 'a.json': envelope(report), 'b.json': envelope(bad, { received_at: '2026-10-08T10:00:00Z' }) }, (dir) => {
    const s = JSON.parse(run(dir))
    check('a rejected copy does not supersede a valid one',
      s.accepted === 1 && s.rejected.report_invalid === 1 && s.rejected.superseded === 0, JSON.stringify(s))
  })
}

// --- rolling 30-day window on received_at ----------------------------------
{
  const other = structuredClone(report)
  other.run.run_id = '11111111-2222-4333-8444-555555555555'
  const files = {
    'a-fresh.json': envelope(),
    'b-edge.json': envelope(other, { received_at: '2026-09-09T12:00:00Z' }),
    'c-stale.json': envelope(report, { received_at: '2026-09-09T11:59:59Z' }),
  }
  withDir(files, (dir) => {
    const s = JSON.parse(run(dir))
    // Window is applied before dedupe so a stale copy neither counts as superseded nor evicts a fresh one.
    check('a report exactly 30 days old is in the window, older is skipped',
      s.accepted === 2 && s.skipped_window === 1 && s.rejected.superseded === 0, JSON.stringify(s))
    check('counts sum to the file count',
      s.accepted + sum(s.rejected) + s.skipped_window === s.files, JSON.stringify(s))
    const later = JSON.parse(run(dir, ['--now', '2026-10-20T00:00:00Z']))
    check('--now moves the window',
      later.accepted === 1 && later.skipped_window === 2, JSON.stringify(later))
  })

  withDir({ 'a.json': report }, (dir) => {
    const old = new Date('2026-07-01T00:00:00Z')
    utimesSync(join(dir, 'a.json'), old, old)
    const s = JSON.parse(run(dir))
    check('a bare report is windowed by its file mtime', s.accepted === 0 && s.skipped_window === 1, JSON.stringify(s))
  })
}

// --- rerun determinism -------------------------------------------------------
{
  const bad = structuredClone(report)
  bad.run.command = 'not-a-command'
  const dup = structuredClone(report)
  const files = { 'a.json': envelope(), 'b.json': envelope(dup, { received_at: '2026-10-08T10:00:00Z' }), 'c.json': '{nope', 'd.json': envelope(bad), 'e.json': report }
  const reversed = Object.fromEntries(Object.entries(files).reverse())
  const first = withDir(files, (dir) => run(dir))
  const again = withDir(files, (dir) => run(dir))
  const other = withDir(reversed, (dir) => run(dir))
  check('rerun over the same files is byte-identical', first === again, `${first} vs ${again}`)
  check('creation order does not change the summary bytes', first === other, `${first} vs ${other}`)
  check('summary carries no wall-clock value', !/20\d\d-\d\d-\d\dT/.test(first), first)
}

process.exit(failed)
