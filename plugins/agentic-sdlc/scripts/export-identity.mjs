// Client identity for report export: a registered bearer token kept beside the repo ID.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createOnce, exportDir, repoId } from './repo-id.mjs'

// Anything else from the server (or disk) is untrusted and must never reach an Authorization header.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

const DEFAULT_COOLDOWN_S = 60
// A hostile or buggy Retry-After must not park registration for longer than a day.
const MAX_COOLDOWN_S = 24 * 60 * 60

function cooldownSeconds(res) {
  const n = Number(res?.headers?.get?.('retry-after'))
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COOLDOWN_S) : DEFAULT_COOLDOWN_S
}

export function createAuth({ cwd = process.cwd(), baseUrl, fetch = globalThis.fetch, timeoutMs = 5000 }) {
  function coolingDown(file) {
    try {
      return Date.now() < JSON.parse(readFileSync(file, 'utf8')).until
    } catch {
      // Unreadable or corrupt means no cooldown: failing open costs one request, failing closed could lock export out.
      return false
    }
  }

  function startCooldown(file, seconds) {
    // Rename keeps readers from ever seeing a half-written record.
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ until: Date.now() + seconds * 1000 }), { mode: 0o600 })
    renameSync(tmp, file)
  }

  async function register(cooldownFile) {
    let res
    try {
      res = await fetch(`${baseUrl}/v1/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo_id: repoId({ cwd }) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 201) {
        const { token } = await res.json()
        if (typeof token === 'string' && TOKEN_SHAPE.test(token)) {
          rmSync(cooldownFile, { force: true })
          return token
        }
      }
    } catch {
      // Network and timeout failures cool down like any other refusal.
    }
    startCooldown(cooldownFile, cooldownSeconds(res))
    return null
  }

  function readStored(file) {
    try {
      const { token } = JSON.parse(readFileSync(file, 'utf8'))
      return typeof token === 'string' && TOKEN_SHAPE.test(token) ? token : null
    } catch {
      return null
    }
  }

  return {
    async invalidate() {
      // force: a missing file means another caller already invalidated.
      rmSync(join(exportDir(cwd), 'token.json'), { force: true })
    },
    async token() {
      try {
        return await obtain()
      } catch {
        // Export is best-effort; a network or disk fault must not break the caller.
        return null
      }
    },
  }

  async function obtain() {
    const dir = exportDir(cwd)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, 'token.json')
    if (existsSync(file)) {
      const stored = readStored(file)
      if (stored) return stored
      rmSync(file, { force: true })
    }
    const cooldownFile = join(dir, 'cooldown.json')
    if (coolingDown(cooldownFile)) return null
    const token = await register(cooldownFile)
    if (!token) return null
    // The stored winner, not our fetch, so concurrent worktrees converge on one token.
    const stored = createOnce(file, JSON.stringify({ token, created_at: new Date().toISOString() }))
    return JSON.parse(stored).token
  }
}
