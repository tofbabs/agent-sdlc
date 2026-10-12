#!/usr/bin/env node
// Reads the previous review round from comment bodies, never from review
// state: a PR author's own review is stored as COMMENTED, so state lies.
import { readFileSync } from 'node:fs';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const load = (name) => JSON.parse(readFileSync(arg(name), 'utf8'));

const items = [...load('--reviews'), ...load('--comments')];

let round = 0;
let last = '';
let lastState = '';
for (const x of items) {
  const b = x.body || '';
  const m = /^## Review — round (\d+)/m.exec(b);
  if (m && Number(m[1]) > round) {
    round = Number(m[1]);
    last = b;
    lastState = x.state || '';
  }
}

// A response to an older round does not answer the newest findings.
const response = items.some((x) => {
  const m = /^## Response — round (\d+)/m.exec(x.body || '');
  return m && Number(m[1]) === round;
});

// Only a fallback: COMMENTED carries no verdict.
const fromState = { CHANGES_REQUESTED: 'REQUEST_CHANGES', APPROVED: 'APPROVE' };
const field = (re) => (re.exec(last) || [])[1] || '';
console.log(JSON.stringify({
  round,
  verdict: field(/^- verdict: *(\S+)/m) || fromState[lastState] || '',
  sha: field(/^- reviewed sha: *(\S+)/m),
  response,
}));
