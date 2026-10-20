// Reads the phase lock on one brief Issue from a pre-fetched payload (stdin, or
// a file path argument): {labels, comments, now, timeouts, wave_labeled_at}.
// Never calls gh; the command fetches labels, comments and events.
//
// The lock is GitHub state only: the `phase-running` label plus a marker
// comment the phase worker posts when it takes the lock:
//   <!-- wave-run phase=<plan|build> started=<ISO-8601> -->
// A worker that finishes removes the label and deletes its marker, so a marker
// still on the Issue past its timeout is a run that never finished.
import { readFileSync } from 'node:fs';

export const LOCK_LABEL = 'phase-running';
export const MAX_ATTEMPTS = 2;
export const markerFor = (phase, started) => `<!-- wave-run phase=${phase} started=${started} -->`;

const MARKER = /<!--\s*wave-run\s+([^>]*?)\s*-->/g;
const MIN = 60_000;

const parseMarkers = (comments) =>
  comments.flatMap((c) => {
    const body = typeof c === 'string' ? c : c?.body ?? '';
    return [...body.matchAll(MARKER)].map((m) => {
      const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)=(\S+)/g)].map((a) => [a[1], a[2]]));
      const ms = attrs.started === undefined ? NaN : Date.parse(attrs.started);
      return { phase: attrs.phase, started: attrs.started, ms };
    });
  });

const labelNames = (labels) => (labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));

export function evaluate({ labels, comments, now, timeouts = {}, wave_labeled_at: labeledAt }) {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) throw new Error('now must be an ISO-8601 timestamp');
  const since = labeledAt === undefined || labeledAt === null ? -Infinity : Date.parse(labeledAt);
  if (Number.isNaN(since)) throw new Error('wave_labeled_at must be an ISO-8601 timestamp');
  const markers = parseMarkers(comments ?? []);
  const timeoutMs = (phase) => (timeouts[phase] ?? Infinity) * MIN;
  const isStale = (m) => nowMs - m.ms > timeoutMs(m.phase);
  // The held run is the failure being detected, so it counts even when it
  // predates the wave label; only earlier runs are scoped to the current wave.
  const failed = (cur) =>
    1 + markers.filter((m) => m !== cur && m.phase === cur.phase && !Number.isNaN(m.ms) && m.ms > since && isStale(m)).length;

  if (!labelNames(labels).includes(LOCK_LABEL)) return { ok: true, outcome: 'free', lock: { held: false } };

  const current = markers[markers.length - 1];
  // Without a readable start we cannot prove the run died, and clearing a live
  // lock would let two sessions work one brief; so it stays held.
  if (!current || Number.isNaN(current.ms)) {
    const error = !current ? 'lock-marker-missing' : current.started === undefined ? 'started-missing' : 'started-malformed';
    return { ok: false, error, outcome: 'held', lock: { held: true, stale: false, phase: current?.phase } };
  }
  const lock = { held: true, phase: current.phase, started: current.started, stale: isStale(current) };
  if (!lock.stale) return { ok: true, outcome: 'held', lock };
  const attempts = failed(current);
  return attempts >= MAX_ATTEMPTS
    ? { ok: true, outcome: 'blocked', phase: current.phase, lock, attempts }
    : { ok: true, outcome: 'cleared', phase: current.phase, lock, attempts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const raw = readFileSync(process.argv[2] ?? 0, 'utf8');
    console.log(JSON.stringify(evaluate(JSON.parse(raw))));
  } catch (e) {
    console.error(`wave-lock: ${e.message}`);
    process.exit(2);
  }
}
