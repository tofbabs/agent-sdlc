// Decides what one wave tick must change, from a pre-fetched payload (stdin, or
// a file path argument): {wave, epic, now, stall_thresholds?, epic_comments?,
// briefs: [{number, phase, labels, since, pr?, ci_state?, lock?, issue_state,
// pr_state?}]}. phase is wave-classify's, lock is wave-lock's evaluate output,
// pr_state is open > merged > closed across the brief's PRs.
// Never calls gh; the command applies the result.
import { readFileSync } from 'node:fs';
import { render, duration } from './wave-board.mjs';
import { DEFAULTS as CONFIG_DEFAULTS } from './config.mjs';

const PHASE = 'phase:';
const HOUR = 3600000;
// One source for the thresholds: a payload built without config still gets
// the same limits the command would have passed.
const DEFAULTS = CONFIG_DEFAULTS.wave.stall_thresholds;

const labelNames = (labels) => (labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));

// Each label call costs API quota and an event on the Issue, so an unchanged
// phase yields no entry at all.
const labelChange = ({ number, phase, labels }) => {
  const want = `${PHASE}${phase}`;
  const have = labelNames(labels).filter((l) => l.startsWith(PHASE));
  if (have.length === 1 && have[0] === want) return [];
  return [{ issue: number, add: [want], remove: have.filter((l) => l !== want) }];
};

// A stale lock that exhausted its attempts is the only lock result that moves
// a phase; held and cleared leave the classifier's phase alone.
const effectivePhase = (b) => (b.lock?.outcome === 'blocked' ? 'blocked' : b.phase);

// Delivered work is final; a closed Issue is terminal whatever closed it.
const isTerminal = (b) => b.issue_state === 'closed' || b.pr_state === 'merged';
// The PR was abandoned but the Issue is open: the brief returns to the pool
// (ARCH-4), so it must lose the wave's labels rather than hold the wave open.
const isAbandoned = (b) => b.issue_state === 'open' && b.pr_state === 'closed';

export function tick({ wave, epic, now, stall_thresholds, briefs = [], epic_comments = [] }) {
  const limits = { ...DEFAULTS, ...stall_thresholds };
  const dropped = briefs.filter(isAbandoned);
  const kept = briefs.filter((b) => !isAbandoned(b)).map((b) => ({ ...b, phase: effectivePhase(b) }));
  const removals = dropped.map(({ number, labels }) => ({
    issue: number,
    add: [],
    remove: labelNames(labels).filter((l) => l === `wave:${wave}` || l.startsWith(PHASE)),
  }));
  const label_changes = [...kept.flatMap(labelChange), ...removals];
  const changed = new Set(label_changes.map((c) => c.issue));
  // A kept clock on a changed phase would overstate its age; a reset one on an
  // unchanged phase would hide a stall.
  const rows = kept.map(({ number, phase, pr, since, ci_state }) => ({
    number, phase, pr, since: changed.has(number) ? now : since, ci_state,
  }));
  const at = Date.parse(now);
  const notices = rows.flatMap(({ number, phase, since, ci_state }) => {
    const limit = limits[phase];
    const age = at - Date.parse(since);
    // A pending head is the pipeline working, not a brief waiting on anyone.
    if (limit === undefined || age <= limit * HOUR || (phase === 'ci' && ci_state === 'pending')) return [];
    const marker = `<!-- wave-stall:${number} phase=${phase} since=${since} -->`;
    // The marker is the only record of a stall; matching the whole line lets a new since re-notify.
    if (epic_comments.includes(marker)) return [];
    return [{
      issue: number,
      body: `${marker}\nBrief #${number} has been in ${phase} for ${duration(age)}.`,
    }];
  });
  // An empty payload is more likely a failed fetch than a finished wave. A
  // blocked brief with an open Issue and no merged PR still holds the wave open (ARCH-3).
  const done = briefs.length > 0 && kept.every(isTerminal);
  return {
    label_changes,
    dropped: dropped.map((b) => b.number),
    board: render({ wave, epic, now, briefs: rows }),
    notices,
    close: done ? { epic, remove: ['wave:active'], start: true } : null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const raw = readFileSync(process.argv[2] ?? 0, 'utf8');
    console.log(JSON.stringify(tick(JSON.parse(raw))));
  } catch (e) {
    console.error(`wave-tick: ${e.message}`);
    process.exit(2);
  }
}
