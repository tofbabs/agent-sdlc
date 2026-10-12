#!/usr/bin/env node
//
// plan-artifacts.mjs — claim a backlog ID, carry a plan onto its build branch,
// and check an epic's size.
//
// WHY THIS EXISTS AS A SCRIPT AND NOT A CONVENTION
//
// /plan writes backlog/<ID>.md (plus any new brief or ADR) into whatever checkout
// it runs in, and leaves it untracked. /build then cuts its branch from
// origin/<base>, which has never seen those files. Measured on a consuming repo
// running several sessions in parallel worktrees:
//
//   1. Two runs each counted their own backlog/ and picked the same FAST-<n>.
//   2. The plan never shipped with its code. One PR merged a backlog file citing
//      an ADR that existed only as an untracked file in another checkout.
//   3. Sessions kept updating the untracked copy (Status: DONE) while the copy
//      on the branch said TODO, so the main checkout filled with stale plans
//      that blocked `git switch` / fast-forwards on the integration branch.
//
// `claim` removes (1): the next number is taken over every worktree and every
// local and remote branch, and the file is created exclusively. `carry` removes
// (2) and (3): the plan and its artifacts become the build branch's first
// commit, and the untracked copies leave the planning checkout, so the branch
// holds the only live copy.
//
// Zero dependencies, Node 22 (the repo floor).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, openSync, closeSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const KINDS = ['EPIC', 'FAST']
const CLAIM_RETRIES = 20
const ARTIFACTS_RE = /^- Artifacts:\s*(.*)$/m
const DEBT_RE = /^## Debt\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m
const LEDGER = 'docs/TOOLING-DEBT.md'
// Kept together so a later epic can swap them for project config in one place.
const POINTS = { S: 3, M: 5, L: 15 }
const EPIC_CAP = 15
const MAX_LINES = 150
const STORIES_BY_LINE = 40

const [, , command, arg, ...rest] = process.argv
const flags = {}
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--deps-only') flags['deps-only'] = true
  else if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]
}

function die(msg) {
  process.stderr.write(`plan-artifacts: ${msg}\n`)
  process.exit(2)
}

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

function tryGit(args, cwd) {
  try { return git(args, cwd) } catch { return null }
}

// ---------------------------------------------------------------- claim

function numbersIn(names, kind) {
  const re = new RegExp(`(?:^|/)${kind}-(\\d+)\\.md$`)
  return names.map((n) => re.exec(n)).filter(Boolean).map((m) => Number(m[1]))
}

function highestTaken(kind) {
  const seen = []
  // Every checkout's working tree — untracked plans live here and nowhere else.
  const porcelain = git(['worktree', 'list', '--porcelain'])
  for (const line of porcelain.split('\n')) {
    if (!line.startsWith('worktree ')) continue
    const dir = join(line.slice('worktree '.length), 'backlog')
    if (existsSync(dir)) seen.push(...numbersIn(readdirSync(dir), kind))
  }
  // Every local and remote branch — a plan committed on a branch not yet merged.
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).split('\n').filter(Boolean)
  for (const ref of refs) {
    const tree = tryGit(['ls-tree', '--name-only', `${ref}:backlog`])
    if (tree) seen.push(...numbersIn(tree.split('\n'), kind))
  }
  return seen.length ? Math.max(...seen) : 0
}

// Same scan as highestTaken, but answers "where is this exact id" so a refusal can
// name the place the caller has to go look.
function firstHolder(id) {
  const file = `${id}.md`
  const porcelain = git(['worktree', 'list', '--porcelain'])
  for (const line of porcelain.split('\n')) {
    if (!line.startsWith('worktree ')) continue
    const wt = line.slice('worktree '.length)
    if (existsSync(join(wt, 'backlog', file))) return `worktree ${wt}`
  }
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).split('\n').filter(Boolean)
  for (const ref of refs) {
    const tree = tryGit(['ls-tree', '--name-only', `${ref}:backlog`])
    if (tree && tree.split('\n').includes(file)) return `ref ${ref}`
  }
  return null
}

function claim(kind) {
  if (!KINDS.includes(kind)) die(`claim takes one of ${KINDS.join('|')}, got "${kind}"`)
  // Checked before any fetch or write: the id becomes a file path and a plan kind.
  if (flags.id !== undefined && (!/^(EPIC|FAST)-\d+$/.test(flags.id) || !flags.id.startsWith(`${kind}-`))) {
    die(`claim ${kind} --id takes an ID like ${kind}-7, got "${flags.id}"`)
  }
  tryGit(['fetch', '--quiet', 'origin'])
  const root = git(['rev-parse', '--show-toplevel']).trim()
  mkdirSync(join(root, 'backlog'), { recursive: true })
  // A named id is claimed once and never bumped: the caller reserved that number.
  const named = flags.id !== undefined
  if (named) {
    const holder = firstHolder(flags.id)
    if (holder) die(`${flags.id} is already taken in ${holder}`)
  }
  let n = named ? Number(flags.id.slice(kind.length + 1)) : highestTaken(kind) + 1
  for (let attempt = 0; attempt < (named ? 1 : CLAIM_RETRIES); attempt++, n++) {
    const rel = `backlog/${kind}-${n}.md`
    try {
      // 'wx' fails if the file exists: two sessions racing on the same n cannot
      // both win, whatever they counted.
      const fd = openSync(join(root, rel), 'wx')
      writeFileSync(fd, `# ${kind}-${n}: (claimed — planner writes this file)\n`)
      closeSync(fd)
      process.stdout.write(`${rel}\n`)
      return
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      // Lost the race for the reserved number; there is no next one to try.
      if (named) die(`${flags.id} is already taken`)
    }
  }
  die(`no free ${kind} number after ${CLAIM_RETRIES} attempts from ${n - CLAIM_RETRIES}`)
}

// ---------------------------------------------------------------- carry

function isUntracked(file, cwd) {
  return tryGit(['ls-files', '--error-unmatch', '--', file], cwd) === null
}

// A stub is a placeholder awaiting its fill-in. Only the header (title line up to
// the first "## ") counts: a finished epic may quote "- Status: STUB" in its body,
// and an ID prefix like EPIC-41-old is a different epic.
function isOwnStub(text, id) {
  const header = text.split(/^## /m)[0]
  return new RegExp(`^# ${id}(:|[ \\t]*$)`).test(header.split('\n')[0]) && /^[-*][ \t]+Status:[ \t]*STUB[ \t]*$/m.test(header)
}

function carry(id, from) {
  if (!/^(EPIC|FAST)-\d+$/.test(id ?? '')) die(`carry takes an ID like FAST-7, got "${id}"`)
  if (!from) die('carry needs --from <the checkout /plan ran in>')
  const here = git(['rev-parse', '--show-toplevel']).trim()
  const there = git(['rev-parse', '--show-toplevel'], resolve(from)).trim()
  const sameCheckout = here === there

  const planRel = `backlog/${id}.md`
  const planSrc = join(there, planRel)
  // A resumed branch already carries its plan; the planning checkout may never
  // have had it. An untracked copy still goes through the refusal check below.
  if (!existsSync(planSrc) && !sameCheckout && tryGit(['cat-file', '-e', `HEAD:${planRel}`], here) !== null) return
  if (!existsSync(planSrc)) die(`${planSrc} not found — nothing to carry`)
  let plan = readFileSync(planSrc, 'utf8')

  const listed = (ARTIFACTS_RE.exec(plan)?.[1] ?? '')
    .split(/[,\s]+/).map((s) => s.replace(/`/g, '')).filter((s) => s && s !== 'none')
  if (listed.includes(LEDGER)) die(`${LEDGER} is shared — put rows under "## Debt" in ${planRel}, not in Artifacts`)

  // Nothing on the branch is overwritten. A differing file already there means
  // someone else owns that path — a human decides, the script does not.
  const files = [planRel, ...listed]
  for (const rel of files) {
    const src = join(there, rel)
    if (!existsSync(src)) die(`${rel} is listed in ${planRel} but missing from ${there}`)
    const dst = join(here, rel)
    if (!sameCheckout && existsSync(dst) && readFileSync(dst, 'utf8') !== readFileSync(src, 'utf8') &&
        !(rel === planRel && isOwnStub(readFileSync(dst, 'utf8'), id))) {
      die(`${rel} already exists on this branch with different content — refusing to overwrite`)
    }
  }

  // Debt rows written at plan time move into the shared ledger here, on the
  // branch, so they ship with the code that incurs them.
  const debt = DEBT_RE.exec(plan)
  let ledgered = 0
  if (debt && debt[1].trim()) {
    const ledger = join(here, LEDGER)
    mkdirSync(dirname(ledger), { recursive: true })
    const prev = existsSync(ledger) ? readFileSync(ledger, 'utf8') : ''
    writeFileSync(ledger, `${prev.replace(/\n*$/, '\n\n')}${debt[1].trim()}\n`)
    ledgered = (debt[1].match(/^### /gm) ?? []).length
    plan = plan.replace(DEBT_RE, `## Debt\n\nLedgered in ${LEDGER} by the plan commit.\n\n`)
  }

  for (const rel of listed) {
    const dst = join(here, rel)
    mkdirSync(dirname(dst), { recursive: true })
    writeFileSync(dst, readFileSync(join(there, rel)))
  }
  mkdirSync(dirname(join(here, planRel)), { recursive: true })
  writeFileSync(join(here, planRel), plan)

  git(['add', '--', planRel, ...listed, ...(ledgered ? [LEDGER] : [])])
  if (tryGit(['diff', '--cached', '--quiet']) !== null) {
    process.stdout.write(`${id}: already on this branch — nothing to commit\n`)
  } else {
    git(['commit', '--quiet', '-m', `docs: add ${id} plan`])
  }

  // The branch now holds the only live copy. Remove the untracked originals so
  // nobody updates a copy that never ships. Tracked files are never touched.
  const removed = []
  if (!sameCheckout) {
    for (const rel of files) {
      if (isUntracked(rel, there)) {
        rmSync(join(there, rel))
        removed.push(rel)
      }
    }
  }
  process.stdout.write(
    `${id}: committed ${files.length} file(s)` +
      (ledgered ? `, ${ledgered} debt row(s) ledgered` : '') +
      (removed.length ? `; removed untracked copies from ${there}: ${removed.join(', ')}` : '') +
      '\n',
  )
}

// ---------------------------------------------------------------- check

// Sizing is an epic-only gate; FAST plans are flat task lists with no estimates.
function check(id) {
  if (!/^(EPIC|FAST)-\d+$/.test(id ?? '')) die(`check takes an ID like EPIC-7, got "${id}"`)
  if (id.startsWith('FAST-')) return

  const file = join(process.cwd(), 'backlog', `${id}.md`)
  if (!existsSync(file)) die(`${file} not found`)
  const text = readFileSync(file, 'utf8')

  // Stub epics carry the same heading and estimate lines, so no special case.
  const section = /^## Stories\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? ''
  const stories = section.split(/^(?=### STORY-)/m).filter((b) => b.startsWith('### STORY-'))

  const errors = []

  const lines = text.replace(/\n$/, '').split('\n')
  if (lines.length > MAX_LINES) errors.push(`${id}: ${lines.length} lines exceeds the limit of ${MAX_LINES}`)
  const storiesAt = lines.findIndex((l) => /^## Stories\s*$/.test(l)) + 1
  if (storiesAt > STORIES_BY_LINE) errors.push(`${id}: "## Stories" starts at line ${storiesAt}, after the limit of line ${STORIES_BY_LINE}`)

  // "none" or a missing header yields no EPIC-<n> tokens, so nothing to resolve.
  const depends = /^- Depends on:[ \t]*(.*)$/m.exec(text)?.[1] ?? ''
  for (const target of new Set(depends.match(/EPIC-\d+/g) ?? [])) {
    if (!existsSync(join(process.cwd(), 'backlog', `${target}.md`))) errors.push(`${id}: Depends on ${target}, but backlog/${target}.md does not exist`)
  }

  let total = 0
  for (const block of stories) {
    const name = /^### (STORY-[^:\s]+)/.exec(block)[1]
    const est = /^- estimate:[ \t]*(\S*)/m.exec(block)?.[1]
    if (!est) errors.push(`${name}: missing "- estimate:" (want S|M|L)`)
    else if (!Object.hasOwn(POINTS, est)) errors.push(`${name}: estimate "${est}" is not one of ${Object.keys(POINTS).join('|')}`)
    else total += POINTS[est]
  }
  if (total > EPIC_CAP) errors.push(`${id}: ${total} points exceeds the cap of ${EPIC_CAP}`)

  if (errors.length) {
    process.stderr.write(errors.map((e) => `plan-artifacts: ${e}\n`).join(''))
    process.exit(1)
  }
  process.stdout.write(`${id}: ${total}/${EPIC_CAP} points\n`)
}

// ---------------------------------------------------------------- ready

// Only (merged) dependencies are anchored; "released" and "none" yield nothing.
function mergedDeps(text) {
  const header = /^- Depends on:[ \t]*(.*)$/m.exec(text)?.[1] ?? ''
  return [...new Set([...header.matchAll(/(EPIC-\d+)\s*\(merged\)/g)].map((m) => m[1]))]
}

// A merged epic's file is on origin/<base> only via a merge; its stories land as
// squash commits tagged [STORY-<id>], so that tag is the only per-story anchor.
// Returns an error line, or null when every merged dependency is on origin/<base>.
function unmergedDependency(text, base, cwd = process.cwd()) {
  const ref = `origin/${base}`
  for (const dep of mergedDeps(text)) {
    const copy = tryGit(['show', `${ref}:backlog/${dep}.md`], cwd)
    if (copy === null) return `${dep} is not merged: backlog/${dep}.md is not on ${ref}`
    const ids = [...copy.matchAll(/^### (STORY-[^:\s]+)/gm)].map((m) => m[1])
    for (const id of ids) {
      const hit = tryGit(['log', ref, '-F', `--grep=[${id}]`, '-n1', '--format=%H'], cwd)
      if (hit?.trim()) continue
      const shallow = tryGit(['rev-parse', '--is-shallow-repository'], cwd)?.trim() === 'true'
      return shallow
        ? `${dep} may be unmerged: ${id} not found in a shallow checkout; run git fetch --unshallow origin ${base}`
        : `${dep} is not merged: ${id} has no [${id}] commit on ${ref}`
    }
  }
  return null
}

function ready(id) {
  if (!/^EPIC-\d+$/.test(id ?? '')) die(`ready takes an ID like EPIC-7, got "${id}"`)
  const base = flags.base
  if (!base) die('ready needs --base <base>')
  const file = join(process.cwd(), 'backlog', `${id}.md`)
  if (!existsSync(file)) die(`${file} not found`)
  const text = readFileSync(file, 'utf8')
  // A stale origin/<base> would report a just-merged part as unmerged; offline,
  // the existing ref is the best answer available.
  tryGit(['fetch', '--quiet', 'origin', base])

  if (!flags['deps-only']) {
    if (/^- Status:[ \t]*STUB\b/m.test(text)) {
      process.stderr.write(`${id} is a stub: run /plan ${id} first\n`)
      process.exit(1)
    }
    if (!/^### STORY-/m.test(text)) die(`${id} has no "### STORY-" blocks`)
  }

  const problem = unmergedDependency(text, base)
  if (problem) {
    process.stderr.write(`${problem}\n`)
    process.exit(3)
  }
}

// ---------------------------------------------------------------- resume

// A branch pushed by an earlier session already holds the committed plan, so it is
// checked out (tracking, no -b) rather than recreated.
function resume(id, base) {
  const top = git(['rev-parse', '--show-toplevel']).trim()
  const wt = resolve(top, '..', `wt-${id}`)
  if (tryGit(['fetch', 'origin', `feat/${id}`], top) === null) {
    // Unpushed work from an earlier session: a second branch would orphan it.
    if (tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/feat/${id}`], top) !== null) {
      git(['worktree', 'add', wt, `feat/${id}`], top)
      return
    }
    // No branch anywhere: a first session, so start from the base as claim would.
    git(['fetch', 'origin', base], top)
    git(['worktree', 'add', wt, '-b', `feat/${id}`, `origin/${base}`], top)
    return
  }
  git(['worktree', 'add', wt, `feat/${id}`], top)
  // Merge, never rebase: the branch is already pushed and a force push is denied.
  git(['fetch', 'origin', base], wt)
  const mine = git(['rev-parse', 'HEAD'], wt).trim()
  const theirs = git(['rev-parse', `origin/${base}`], wt).trim()
  if (tryGit(['merge', '--no-edit', `origin/${base}`], wt) === null) {
    // Listed before the abort, which clears the unmerged state.
    const paths = (tryGit(['diff', '--name-only', '--diff-filter=U'], wt) ?? '').trim().split('\n').join(', ')
    tryGit(['merge', '--abort'], wt)
    die(`merge of origin/${base} conflicts in: ${paths}; branch ${mine}, base ${theirs}; resolve by hand`)
  }
}

// ---------------------------------------------------------------- dispatch

if (command === 'claim') claim(arg)
else if (command === 'resume') resume(arg, flags.base)
else if (command === 'carry') carry(arg, flags.from)
else if (command === 'check') check(arg)
else if (command === 'ready') ready(arg)
else die('usage: plan-artifacts.mjs claim <EPIC|FAST> | resume <ID> --base <base> | carry <ID> --from <planning checkout> | check <ID> | ready <EPIC-n> --base <base> [--deps-only]')
