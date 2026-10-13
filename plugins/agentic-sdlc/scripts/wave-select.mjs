// Picks the briefs for the next wave from a pre-fetched Issues payload (stdin,
// or a file path argument). Never calls gh, so the same payload always yields
// the same selection.
import { readFileSync } from 'node:fs';
import { parseBriefIssue, conflicts } from './brief-issue.mjs';
import { classify } from './ci-state.mjs';

// An open PR already carries evidence, so it decides the phase over a plan file.
// Approved-on-head is not derivable from check-runs; round-state owns that.
const EVIDENCE_PHASE = { green: 'ci', pending: 'ci', none: 'ci', red: 'revise' };
const startPhase = (i) => {
  if (i.open_pr) return EVIDENCE_PHASE[classify(i.open_pr).state];
  return i.plan ? 'build' : 'plan';
};

// Raw REST returns label objects and mixes PRs into /issues; accepting both
// shapes here keeps the agent from having to reshape the payload.
const normalize = (issues) =>
  issues
    .filter((i) => !i.pull_request)
    .map((i) => ({ ...i, labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)) }));

export function select({ issues: rawIssues, priority_labels: priorities = [] }) {
  const issues = normalize(rawIssues);
  const active = issues
    .filter((i) => i.labels.includes('wave:active'))
    .map((i) => i.number)
    .sort((a, b) => a - b);
  if (active.length) return { ok: false, error: 'wave-active', issues: active };
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  // Closed-as-not-planned never delivered, and a dependency absent from the
  // payload is unknown; both must block.
  const delivered = (n) => {
    const dep = byNumber.get(n);
    return dep?.state === 'closed' && dep.state_reason === 'completed';
  };
  const briefs = issues.filter((i) => i.state === 'open' && i.labels.includes('brief'));
  const parsed = {};
  for (const i of briefs) parsed[i.number] = parseBriefIssue(i.body);
  const eligibleBriefs = briefs.filter((i) => {
    const brief = parsed[i.number];
    return brief.ok && brief.dependsOn.every(delivered);
  });
  const eligible = eligibleBriefs.map((i) => i.number).sort((a, b) => a - b);
  // Ineligible briefs still count: they are the ones waiting on this work.
  const dependents = (n) => briefs.filter((i) => parsed[i.number].dependsOn?.includes(n)).length;
  const rank = (i) => {
    const at = priorities.findIndex((p) => i.labels.includes(p));
    return at === -1 ? priorities.length : at;
  };
  const ordered = [...eligibleBriefs].sort(
    (a, b) => rank(a) - rank(b) || dependents(b.number) - dependents(a.number) || a.number - b.number,
  );
  const selected = [];
  for (const i of ordered) {
    if (!selected.some((n) => conflicts(parsed, i.number, n))) selected.push(i.number);
  }
  const phases = {};
  for (const n of selected) phases[n] = startPhase(byNumber.get(n));
  const result = { ok: true, eligible, selected, phases };
  if (!selected.length) {
    const blockers = {};
    for (const i of briefs) {
      const b = parsed[i.number];
      blockers[i.number] = !b.ok
        ? [`invalid brief body (${b.error})`]
        : b.dependsOn.filter((n) => !delivered(n)).map((n) => `unmet dependency #${n}`);
    }
    result.message = exhaustion(briefs.map((i) => i.number).sort((a, b) => a - b), blockers);
  }
  return result;
}

// An empty pool means the work is done; a non-empty pool that yields nothing
// means a human must unblock something, so the two must read differently.
function exhaustion(numbers, blockers) {
  if (!numbers.length) return 'backlog exhausted';
  const lines = numbers.map((n) => `  #${n}: ${blockers[n].join('; ') || 'no blocker found'}`);
  return ['cannot continue; blocked briefs:', ...lines].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const raw = readFileSync(process.argv[2] ?? 0, 'utf8');
    console.log(JSON.stringify(select(JSON.parse(raw))));
  } catch (e) {
    console.error(`wave-select: ${e.message}`);
    process.exit(2);
  }
}
