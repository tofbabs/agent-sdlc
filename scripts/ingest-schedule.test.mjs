// The daily Cron Trigger is what makes retention automatic: it must reach the
// sweep through the D1 adapter with bound parameters, and be declared in wrangler.toml.
import { readFileSync } from 'node:fs'
import worker from '../ingest/src/worker.mjs'

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name} ${detail}`); failed = 1 }
}

const executed = []
const d1 = {
  prepare: (sql) => ({ bind: (...params) => ({ sql, params }) }),
  async batch(stmts) { executed.push(...stmts); return stmts.map(() => ({ meta: { changes: 0 } })) },
}

const pending = []
const ctx = { waitUntil: (p) => pending.push(p) }
check('worker exposes a scheduled entry', typeof worker.scheduled === 'function')

if (typeof worker.scheduled === 'function') {
  const before = Date.now()
  await worker.scheduled({ cron: '17 3 * * *', scheduledTime: before }, { DB: d1 }, ctx)
  await Promise.all(pending)

  const on = (table) => executed.find((s) => s.sql.startsWith(`DELETE FROM ${table} `))
  check('scheduled run deletes from reports, tokens and counters', on('reports') && on('tokens') && on('counters'))
  check('every statement is parameterised', executed.length > 0 && executed.every((s) => s.params.length === 1 && s.sql.includes('?') && !/\d{4}-\d{2}/.test(s.sql)))
  const cutoff = Date.parse(on('reports')?.params[0])
  const days = (before - cutoff) / 86400000
  check('reports cutoff is about 90 days back', days > 89.99 && days < 90.01, String(days))
}

const toml = readFileSync(new URL('../ingest/wrangler.toml', import.meta.url), 'utf8')
const cron = toml.match(/^\[triggers\]\s*\n(?:[^\[]*\n)?\s*crons\s*=\s*\[\s*"([^"]+)"/m)
check('wrangler.toml declares a cron trigger', !!cron)
check('cron runs once a day', !!cron && /^\d+ \d+ \* \* \*$/.test(cron[1]), cron?.[1])

process.exit(failed)
