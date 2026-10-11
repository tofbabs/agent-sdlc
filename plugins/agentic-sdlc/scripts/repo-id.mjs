#!/usr/bin/env node
// Anonymous per-clone repo ID (ADR-0003, "Repo ID scope", option B).
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Nothing about the repo is hashed in: a random salt alone makes the ID
// unlinkable, and any identifying input would only add a way to brute-force it.
const LABEL = 'agentic-sdlc/repo-id/v1\n'

// Same common-git-dir rule as the decision store so every worktree of one
// clone resolves to the same salt.
export function exportDir(cwd) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim()
  return join(resolve(cwd, common), 'agentic-sdlc', 'export')
}

// link() fails with EEXIST instead of overwriting, so concurrent creators
// converge on exactly one winner and every loser reads the winner's bytes.
export function createOnce(file, content) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, content, { mode: 0o600 })
  try {
    linkSync(tmp, file)
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
  } finally {
    rmSync(tmp, { force: true })
  }
  return readFileSync(file, 'utf8')
}

// Longer than any holder can legitimately run (flush is capped at 20 s), so a
// lock left by a killed process frees itself.
const LOCK_STALE_MS = 60_000

// Serializes flush against revoke for one clone, so an opt-out cannot be
// overtaken by an upload that passed its consent check first. Resolves the
// release function, or null if the lock stayed busy for waitMs.
export async function acquireExportLock(cwd, { waitMs }) {
  const dir = exportDir(cwd)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, 'lock')
  const until = Date.now() + waitMs
  for (;;) {
    try {
      closeSync(openSync(file, 'wx', 0o600))
      return () => rmSync(file, { force: true })
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    try {
      if (Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) rmSync(file, { force: true })
    } catch {
      // released between open and stat: just retry
    }
    if (Date.now() >= until) return null
    await new Promise((r) => setTimeout(r, 100))
  }
}

export function repoId({ cwd = process.cwd() } = {}) {
  const dir = exportDir(cwd)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const salt = createOnce(join(dir, 'repo-id.salt'), randomBytes(32).toString('hex'))
  const id = createHash('sha256').update(LABEL + salt).digest('hex')
  return createOnce(join(dir, 'repo-id'), id)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--cwd')
  console.log(repoId(i > 0 ? { cwd: process.argv[i + 1] } : {}))
}
