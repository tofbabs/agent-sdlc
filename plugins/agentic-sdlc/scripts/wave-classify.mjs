// Classifies each brief's phase from pre-fetched GitHub evidence (stdin, or a
// file path argument). Never calls gh, so the same payload always yields the
// same phases.
import { readFileSync } from 'node:fs';
import { classify } from './ci-state.mjs';

// A merged PR or closed Issue is delivered work; no later evidence can reopen it.
const isDone = (b) => b.issue_state === 'closed' || b.pr?.merged === true;

function classifyBrief(b, roundCap) {
  if (isDone(b)) return { number: b.number, phase: 'done' };
  const ci = classify(b.pr?.check_runs);
  if (b.pr?.state === 'open' && ci.state === 'red') {
    return { number: b.number, phase: 'revise', ci_failure: true, failing_checks: ci.failing };
  }
  // Strictly past the cap: a round at the cap still gets its revise.
  if (b.round?.round > roundCap && b.round.verdict !== 'APPROVE') {
    return { number: b.number, phase: 'blocked' };
  }
  // An answered round is waiting on re-review, so only unanswered findings revise.
  if (b.round?.verdict === 'REQUEST_CHANGES' && !b.round.response) {
    return { number: b.number, phase: 'revise' };
  }
  const open = b.pr?.state === 'open';
  // Approval covers only the commit it reviewed; a later push voids it.
  if (open && ci.state === 'green' && b.round?.verdict === 'APPROVE' && b.round.sha === b.pr.head_sha) {
    return { number: b.number, phase: 'awaiting-merge' };
  }
  if (open) return { number: b.number, phase: 'ci' };
  return { number: b.number, phase: b.plan ? 'build' : 'plan' };
}

export function classifyWave({ round_cap, briefs }) {
  return { briefs: briefs.map((b) => classifyBrief(b, round_cap)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const raw = readFileSync(process.argv[2] ?? 0, 'utf8');
    console.log(JSON.stringify(classifyWave(JSON.parse(raw))));
  } catch (e) {
    console.error(`wave-classify: ${e.message}`);
    process.exit(2);
  }
}
