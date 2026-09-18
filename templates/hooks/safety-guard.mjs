#!/usr/bin/env node
// safety-guard.mjs — Antigravity PreToolUse hook enforcing agentic-sdlc safety invariants.
// Blocks force-pushes and agent self-merges. Zero dependencies, Node 22.

import { readFileSync } from 'node:fs'

try {
  const input = JSON.parse(readFileSync(0, 'utf-8'))
  const tool = input?.toolCall?.name
  const cmd = String(input?.toolCall?.args?.CommandLine || '')

  if (tool === 'run_command') {
    if (/git\s+push.*(-f\b|--force)/.test(cmd)) {
      console.log(JSON.stringify({
        decision: 'deny',
        reason: 'agentic-sdlc invariant: force-pushing is strictly forbidden.'
      }))
      process.exit(0)
    }

    if (/gh\s+pr\s+merge/.test(cmd)) {
      console.log(JSON.stringify({
        decision: 'deny',
        reason: 'agentic-sdlc invariant: agents must never merge pull requests. The human is the sole blocking gate.'
      }))
      process.exit(0)
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }))
} catch (e) {
  // Graceful fallback to allow if input parse fails
  console.log(JSON.stringify({ decision: 'allow' }))
}
