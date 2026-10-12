#!/usr/bin/env node
// Classifies a head's check-runs REST payload (stdin, or a file path argument)
// into one JSON line: {"state":"green|pending|red|none","failing":[...],"pending":[...]}.
// Red wins over pending: a failed job already decides the round, waiting
// on the rest would only delay the same answer.
import { readFileSync } from 'node:fs';

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

export function classify(payload) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  const failing = runs.filter((r) => r.status === 'completed' && FAILED.has(r.conclusion)).map((r) => r.name);
  const pending = runs.filter((r) => r.status !== 'completed').map((r) => r.name);
  const state = failing.length ? 'red' : pending.length ? 'pending' : runs.length ? 'green' : 'none';
  return { state, failing, pending };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const raw = readFileSync(process.argv[2] ?? 0, 'utf8');
    console.log(JSON.stringify(classify(JSON.parse(raw))));
  } catch (e) {
    console.error(`ci-state: ${e.message}`);
    process.exit(2);
  }
}
