// Pure request handler: storage and the clock are injected so the same code runs
// under Workers and under plain Node tests. No node: imports, so it bundles for
// the edge.
import { validate } from '../../plugins/agentic-sdlc/scripts/run-report-schema.mjs'

const MAX_BYTES = 16384
const MAX_REPORTS = 8
const DAILY_CAP = 100
const KILL_RETRY_SECONDS = 3600

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const sha256Hex = async (s) => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const REGISTER_WINDOW_SECONDS = 60
const REGISTER_DAILY_CAP = 500
const REPO_ID = /^[0-9a-f]{64}$/

const secondsToMidnight = (nowDate) =>
  Math.ceil((Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() + 1) - nowDate.getTime()) / 1000)

const base64url = (bytes) => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const killed = () => json(503, { stop: true }, { 'retry-after': String(KILL_RETRY_SECONDS) })

// Both checks precede any storage access so an oversized body costs no db work.
async function readCapped(request) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null
  const text = await request.text()
  return new TextEncoder().encode(text).length > MAX_BYTES ? null : text
}

const RETENTION_MS = 90 * 86400000
const COUNTER_RETENTION_MS = 2 * 86400000

// Cutoffs are computed here so the port stays a dumb set of bound deletes.
export async function sweep({ db, now }) {
  const t = now().getTime()
  await db.purgeExpired({
    reportsBefore: new Date(t - RETENTION_MS).toISOString(),
    tokensBefore: new Date(t - RETENTION_MS).toISOString(),
    countersBefore: new Date(t - COUNTER_RETENTION_MS).toISOString().slice(0, 10),
  })
}

const ROUTES = {
  '/v1/reports': { POST: reports },
  '/v1/register': { POST: register },
  '/v1/repo': { DELETE: deleteRepo },
}

export async function handle(request, ctx) {
  const methods = ROUTES[new URL(request.url).pathname]
  if (!methods) return json(404, { error: 'not found' })
  const route = methods[request.method]
  if (!route) return json(405, { error: 'method not allowed' }, { allow: Object.keys(methods).join(', ') })
  return route(request, { env: {}, ...ctx })
}

// Deliberately ignores the kill switch: an operator stop must never block a user erasing their data.
// The target repo comes only from the token record, never from the request.
async function deleteRepo(request, { db }) {
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const record = token ? await db.getToken(await sha256Hex(token)) : null
  if (!record) return json(401, { error: 'unauthorized' })
  await db.deleteRepo(record.repo_id)
  return new Response(null, { status: 204 })
}

async function register(request, { db, now, env }) {
  // First check so an operator stop costs neither a body read nor a db call.
  if (env.KILL_SWITCH === 'on') return killed()
  const text = await readCapped(request)
  if (text === null) return json(413, { error: 'too large' })

  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json(400, { error: 'invalid json' })
  }
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : []
  if (keys.length !== 1 || keys[0] !== 'repo_id' || typeof body.repo_id !== 'string' || !REPO_ID.test(body.repo_id)) {
    return json(400, { error: 'body must be {"repo_id":"<64 lowercase hex>"}' })
  }

  const nowDate = now()
  const day = nowDate.toISOString().slice(0, 10)
  // Salting with the UTC day makes the hash unlinkable across days, so no IP is ever stored.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const ipHash = await sha256Hex(`${env.IP_SALT ?? ''}|${day}|${ip}`)
  const epochSeconds = Math.floor(nowDate.getTime() / 1000)
  const window = Math.floor(epochSeconds / REGISTER_WINDOW_SECONDS)
  const ipKey = `register-ip:${ipHash}:${window}`
  if ((await db.getCounter(ipKey, day)) >= 1) {
    const wait = (window + 1) * REGISTER_WINDOW_SECONDS - epochSeconds
    return json(429, { error: 'slow down' }, { 'retry-after': String(wait) })
  }
  const globalKey = 'register-global'
  if ((await db.getCounter(globalKey, day)) >= REGISTER_DAILY_CAP) {
    return json(429, { error: 'daily limit reached' }, { 'retry-after': String(secondsToMidnight(nowDate)) })
  }
  await db.incCounter(ipKey, day, 1)
  await db.incCounter(globalKey, day, 1)

  const token = base64url(globalThis.crypto.getRandomValues(new Uint8Array(32)))
  await db.insertToken(await sha256Hex(token), { repo_id: body.repo_id, created_at: nowDate.toISOString() })
  return json(201, { token })
}

async function reports(request, { db, now, env }) {
  // First check so an operator stop costs neither a body read nor a db call.
  if (env.KILL_SWITCH === 'on') return killed()
  const text = await readCapped(request)
  if (text === null) return json(413, { error: 'too large' })

  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const tokenHash = await sha256Hex(token)
  const record = token ? await db.getToken(tokenHash) : null
  if (!record) return json(401, { error: 'unauthorized' })

  const nowDate = now()
  let accepted = 0
  // Any authenticated call proves the token is live, including ones later rejected or capped.
  try {
    return await ingest()
  } finally {
    await db.touchToken(tokenHash, { seenAt: nowDate.toISOString(), accepted })
  }

  async function ingest() {
  const day = nowDate.toISOString().slice(0, 10)
  const capKey = `token:${tokenHash}`
  if ((await db.getCounter(capKey, day)) >= DAILY_CAP) {
    return json(429, { error: 'daily limit reached' }, { 'retry-after': String(secondsToMidnight(nowDate)) })
  }

  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json(400, { error: 'invalid json' })
  }
  const reports = body?.reports
  if (!Array.isArray(reports) || reports.length < 1 || reports.length > MAX_REPORTS) {
    return json(400, { error: `reports must be an array of 1..${MAX_REPORTS}` })
  }

  const results = []
  for (const report of reports) {
    const errors = validate(report)
    if (errors.length > 0) {
      results.push({ status: 'rejected', errors: errors.slice(0, 5) })
      continue
    }
    const { run_id, sessions } = report.run
    // repo_id comes from the token record only; the schema forbids it in the body.
    const inserted = await db.insertReport({
      repo_id: record.repo_id,
      run_id,
      sessions,
      schema: report.schema,
      body: JSON.stringify(report),
      token_hash: tokenHash,
      received_at: now().toISOString(),
    })
    if (inserted) {
      accepted++
      await db.incCounter(capKey, day, 1)
    }
    results.push({ status: inserted ? 'stored' : 'duplicate', run_id, sessions })
  }
  return json(200, { results })
  }
}
