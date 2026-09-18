#!/usr/bin/env node
//
// size-budget.mjs — a ratchet on the bytes in the agent boot path.
//
// WHY A BYTE COUNT IS A COST CHECK
//
// Every agent's system prompt, tool definitions and instruction body are re-sent
// on each internal round trip, and a PAIR story spawns each agent ~40 times. So a
// kilobyte added to coder.md is not a kilobyte — it is ~40 cache writes plus a
// cache read on every round trip of every spawn. That is why this file's growth is
// a cost regression, not a style question, and why it gets a CI gate of its own.
//
// The gate is RATCHET-ONLY, in two directions:
//   1. a file may not exceed its cap;
//   2. a cap may not be raised above the cap on origin/main — caps only go DOWN.
// Rule 2 is what stops "just bump the cap" from being the path of least resistance.
//
// reference/*.md is exempt on purpose: it is loaded on demand, never in the boot
// path, and a budget that punished it would punish the split that already works.
//
// Zero dependencies, Node 22. Caps live in scripts/size-budget.json.

import { statSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUDGET_REL = 'scripts/size-budget.json'
const BUDGET = JSON.parse(readFileSync(join(ROOT, BUDGET_REL), 'utf8'))

let fail = 0
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`)
const bad = (m) => {
  process.stderr.write(`  ✗ ${m}\n`)
  fail = 1
}

const fileSize = (rel) => (existsSync(join(ROOT, rel)) ? statSync(join(ROOT, rel)).size : null)

const groupSize = (g) => {
  let total = 0
  for (const d of g.dirs) {
    const abs = join(ROOT, d)
    if (!existsSync(abs)) continue
    for (const f of readdirSync(abs)) {
      if (f.endsWith(g.ext)) total += statSync(join(abs, f)).size
    }
  }
  return total
}

// 1. No file over its cap.
for (const [rel, cap] of Object.entries(BUDGET.files || {})) {
  const size = fileSize(rel)
  if (size === null) {
    bad(`${rel} is budgeted but missing`)
    continue
  }
  if (size > cap) bad(`${rel} is ${size} B, over its ${cap} B cap by ${size - cap} B`)
  else ok(`${rel} ${size}/${cap} B`)
}

// 2. No group total over its cap.
for (const [name, g] of Object.entries(BUDGET.groups || {})) {
  const size = groupSize(g)
  if (size > g.cap) bad(`group ${name} is ${size} B, over its ${g.cap} B cap by ${size - g.cap} B`)
  else ok(`group ${name} ${size}/${g.cap} B`)
}

// 3. Ratchet: a cap in this budget may not exceed the cap on origin/main.
const base = spawnSync('git', ['show', `origin/main:${BUDGET_REL}`], { cwd: ROOT, encoding: 'utf8' })
if (base.status === 0) {
  let prior
  try {
    prior = JSON.parse(base.stdout)
  } catch {
    prior = null
  }
  if (prior) {
    let raised = 0
    for (const [rel, cap] of Object.entries(BUDGET.files || {})) {
      const was = prior.files?.[rel]
      if (typeof was === 'number' && cap > was) {
        bad(`cap for ${rel} was raised ${was} → ${cap} — caps may only go down`)
        raised++
      }
    }
    for (const [name, g] of Object.entries(BUDGET.groups || {})) {
      const was = prior.groups?.[name]?.cap
      if (typeof was === 'number' && g.cap > was) {
        bad(`cap for group ${name} was raised ${was} → ${g.cap} — caps may only go down`)
        raised++
      }
    }
    if (!raised) ok('no cap raised above origin/main (ratchet holds)')
  }
} else {
  process.stdout.write('  (no size-budget.json on origin/main yet — ratchet baseline established here)\n')
}

if (fail) {
  process.stderr.write('\nsize budget exceeded\n')
  process.exit(1)
}
process.stdout.write('\nsize budget holds\n')
