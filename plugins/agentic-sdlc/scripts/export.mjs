#!/usr/bin/env node
// Export client: queues anonymous reports on disk. Telemetry must never break
// the work it observes, so nothing here is allowed to throw.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

// Same common-git-dir rule as repo-id.mjs so every worktree shares one queue.
function queueDir(cwd) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  return join(resolve(cwd, common), 'agentic-sdlc', 'export', 'queue')
}

export const QUEUE_CAP = 50

// Bounded so an unreachable endpoint cannot grow the queue without limit.
function prune(dir) {
  const items = readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => a.t - b.t)
  for (const { n } of items.slice(0, Math.max(0, items.length - QUEUE_CAP))) unlinkSync(join(dir, n))
}

// One file per (run_id, sessions): a re-run of the same session replaces its
// report, while a later session of the same run stays a separate item.
export async function enqueue({ cwd, report }) {
  try {
    const { run_id, sessions } = report.run
    const dir = queueDir(cwd)
    mkdirSync(dir, { recursive: true })
    const name = `${run_id}.${sessions}.json`.replace(/[^A-Za-z0-9._-]/g, '_')
    const tmp = join(dir, `${name}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
    writeFileSync(tmp, JSON.stringify(report))
    renameSync(tmp, join(dir, name))
    prune(dir)
  } catch {
    // swallowed on purpose: see header
  }
}

// Placeholder until the real collector exists; the maintainers set the real
// hostname before the first release that enables export. Env wins so
// deployments can repoint.
export const DEFAULT_EXPORT_URL = 'https://export.invalid'

export const MAX_REPORTS = 8
export const MAX_BODY_BYTES = 16384
export const CALL_TIMEOUT_MS = 5000
export const FLUSH_BUDGET_MS = 20000
const BACKOFF_BASE_MS = 30_000
const BACKOFF_CAP_MS = 3_600_000
const RETRY_AFTER_CAP_MS = 86_400_000
const KILL_DEFAULT_MS = 3_600_000
const ENVELOPE_BYTES = Buffer.byteLength('{"reports":[]}')

const stateFile = (cwd) => join(dirname(queueDir(cwd)), 'state.json')

function readState(cwd) {
  try {
    return JSON.parse(readFileSync(stateFile(cwd), 'utf8'))
  } catch {
    return {}
  }
}

function writeState(cwd, state) {
  const file = stateFile(cwd)
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(state))
  renameSync(tmp, file)
}

// Retry-After is seconds or an HTTP date; anything else (or hostile) is ignored/capped.
function retryAfterMs(res, now) {
  const raw = res.headers?.get?.('retry-after')
  if (raw == null) return null
  const n = Number(raw)
  const ms = Number.isFinite(n) ? n * 1000 : Date.parse(raw) - now
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.min(ms, RETRY_AFTER_CAP_MS)
}

function backoff(cwd, state, res, now) {
  const failures = (state.failures ?? 0) + 1
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (failures - 1))
  // Full jitter keeps a fleet of clients from retrying in lockstep.
  const wait = (res && retryAfterMs(res, now)) ?? exp * (0.5 + Math.random() / 2)
  writeState(cwd, { failures, backoff_until: now + wait })
}

async function killSwitch(res) {
  if (res.status !== 503) return false
  try {
    return (await res.json())?.stop === true
  } catch {
    return false
  }
}

const bodyOf = (reports) => JSON.stringify({ reports })

function batches(items) {
  const out = []
  let cur = []
  let size = ENVELOPE_BYTES
  for (const it of items) {
    const add = it.bytes + (cur.length ? 1 : 0)
    if (cur.length && (cur.length >= MAX_REPORTS || size + add > MAX_BODY_BYTES)) {
      out.push(cur)
      cur = []
      size = ENVELOPE_BYTES
    }
    size += it.bytes + (cur.length ? 1 : 0)
    cur.push(it)
  }
  if (cur.length) out.push(cur)
  return out
}

const drop = (dir, it) => {
  try {
    unlinkSync(join(dir, it.file))
  } catch {
    // already gone
  }
}

async function run({ cwd, auth, baseUrl, fetch, now, jitterMs, timeoutMs, deadline }) {
  const t0 = now()
  const state = readState(cwd)
  if ((state.backoff_until ?? 0) > t0) return

  const token = await auth.token()
  if (!token) return
  const dir = queueDir(cwd)
  const items = []
  for (const n of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const body = readFileSync(join(dir, n), 'utf8')
      items.push({ file: n, report: JSON.parse(body), bytes: Buffer.byteLength(JSON.stringify(JSON.parse(body))), t: statSync(join(dir, n)).mtimeMs })
    } catch {
      try {
        unlinkSync(join(dir, n))
      } catch {
        // gone
      }
    }
  }
  items.sort((a, b) => a.t - b.t)
  const sendable = []
  for (const it of items) {
    // A report that cannot fit one request alone can never be accepted.
    if (it.bytes + ENVELOPE_BYTES > MAX_BODY_BYTES) drop(dir, it)
    else sendable.push(it)
  }
  if (!sendable.length) return

  if (jitterMs > 0) await new Promise((r) => setTimeout(r, Math.random() * jitterMs))

  const base = baseUrl ?? process.env.AGENTIC_SDLC_EXPORT_URL ?? DEFAULT_EXPORT_URL
  const queue = batches(sendable)
  while (queue.length) {
    if (now() >= deadline) return
    const batch = queue.shift()
    let res
    try {
      res = await fetch(`${base}/v1/reports`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: bodyOf(batch.map((i) => i.report)),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      backoff(cwd, readState(cwd), null, now())
      return
    }
    if (res.status === 200) {
      const { results } = await res.json()
      for (const r of results ?? []) {
        if (!['stored', 'duplicate', 'rejected'].includes(r.status)) continue
        const it = batch.find((p) => p.report.run.run_id === r.run_id && p.report.run.sessions === r.sessions)
        if (it) drop(dir, it)
      }
      writeState(cwd, {})
    } else if (res.status === 401) {
      await auth.invalidate()
      return
    } else if (res.status === 413 || res.status === 400) {
      // Retrying the same bytes cannot help: narrow it down, and drop a lone offender.
      if (batch.length === 1) drop(dir, batch[0])
      else {
        const mid = batch.length >> 1
        queue.unshift(batch.slice(0, mid), batch.slice(mid))
      }
    } else if (res.status === 429 || res.status >= 500) {
      const t = now()
      if (await killSwitch(res)) {
        writeState(cwd, { stop_until: t + (retryAfterMs(res, t) ?? KILL_DEFAULT_MS), backoff_until: t + (retryAfterMs(res, t) ?? KILL_DEFAULT_MS) })
      } else backoff(cwd, readState(cwd), res, t)
      return
    } else {
      return
    }
  }
}

export async function flush({
  cwd,
  auth,
  baseUrl,
  fetch = globalThis.fetch,
  now = Date.now,
  jitterMs = 0,
  timeoutMs = CALL_TIMEOUT_MS,
  budgetMs = FLUSH_BUDGET_MS,
}) {
  let timer
  try {
    // The race bounds the whole call even if an injected auth/fetch ignores its signal.
    await Promise.race([
      run({ cwd, auth, baseUrl, fetch, now, jitterMs, timeoutMs, deadline: now() + budgetMs }),
      new Promise((r) => {
        timer = setTimeout(r, budgetMs)
      }),
    ])
  } catch {
    // swallowed on purpose: see header
  } finally {
    clearTimeout(timer)
  }
}

async function main(argv) {
  const [cmd, arg] = argv
  const cwd = process.cwd()
  if (cmd === 'enqueue' && arg) {
    await enqueue({ cwd, report: JSON.parse(readFileSync(arg, 'utf8')) })
  } else if (cmd === 'flush') {
    const baseUrl = process.env.AGENTIC_SDLC_EXPORT_URL ?? DEFAULT_EXPORT_URL
    const { createAuth } = await import('./export-identity.mjs')
    const j = argv.indexOf('--jitter-ms')
    await flush({ cwd, baseUrl, auth: createAuth({ cwd, baseUrl, timeoutMs: CALL_TIMEOUT_MS }), jitterMs: j > 0 ? Number(argv[j + 1]) || 0 : 0 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2))
  } catch {
    // the CLI must never fail the session that invoked it
  }
  process.exit(0)
}
