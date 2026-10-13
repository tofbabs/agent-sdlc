#!/usr/bin/env node
// Reads the four-line body of a brief Issue. Pure: no network, no gh.

const LANES = ['standard', 'fast'];

const field = (body, label) => {
  const m = new RegExp(`^${label}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(body);
  return m ? m[1] : null;
};

// An em dash stands for "none" so the line is never left blank. Anything
// else must be strictly #N, comma-separated; a guess here would schedule
// the wrong work.
const refs = (value) => {
  if (value === '—') return [];
  const parts = value.split(',').map((p) => p.trim());
  if (!parts.every((p) => /^#\d+$/.test(p))) return null;
  return parts.map((p) => Number(p.slice(1)));
};

const fail = (error) => ({ ok: false, error });

export function parseBriefIssue(body) {
  const brief = field(body, 'Brief');
  if (!brief) return fail('missing-brief');
  const lane = field(body, 'Lane');
  if (lane === null || lane === '') return fail('missing-lane');
  if (!LANES.includes(lane)) return fail('unknown-lane');
  const dep = field(body, 'Depends on');
  if (dep === null || dep === '') return fail('missing-depends-on');
  const dependsOn = refs(dep);
  if (!dependsOn) return fail('bad-depends-on');
  const con = field(body, 'Conflicts with');
  if (con === null || con === '') return fail('missing-conflicts-with');
  const conflictsWith = refs(con);
  if (!conflictsWith) return fail('bad-conflicts-with');
  return { ok: true, brief, lane, dependsOn, conflictsWith };
}

// Either Issue may be the only one to have declared the clash, so both sides
// are consulted.
export function conflicts(issues, a, b) {
  return !!(issues[a]?.conflictsWith?.includes(b) || issues[b]?.conflictsWith?.includes(a));
}
