#!/usr/bin/env node
// Anonymous per-clone repo ID (ADR-0003, "Repo ID scope", option B).
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
