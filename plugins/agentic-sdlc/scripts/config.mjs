#!/usr/bin/env node
// The only reader of .claude/agentic-sdlc.json (docs/adr/0006). Defaults live
// here once. Bad input throws rather than falling back: a mistyped cap that
// quietly became the default would change review behaviour with no signal.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const positiveInt = (v) => Number.isInteger(v) && v >= 1;

// Leaf keys the reader knows. `check` is the validator, `what` the message.
const KEYS = {
  'review.round_cap': { default: 3, check: positiveInt, what: 'an integer >= 1' },
};

// consent.mjs writes `telemetry` into the same file and tolerates anything in
// it, so it is known here and left unvalidated.
const OWNED_ELSEWHERE = new Set(['schema', 'telemetry']);

export class ConfigError extends Error {}

const fileFor = (cwd) => path.join(cwd, '.claude', 'agentic-sdlc.json');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function walk(obj, prefix, warn) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (!prefix && OWNED_ELSEWHERE.has(k)) continue;
    if (KEYS[key]) {
      if (!KEYS[key].check(v)) throw new ConfigError(`${key}: must be ${KEYS[key].what}, got ${JSON.stringify(v)}`);
      out[key] = v;
    } else if (isObj(v) && Object.keys(KEYS).some((d) => d.startsWith(`${key}.`))) {
      Object.assign(out, walk(v, key, warn));
    } else {
      warn(`unknown key ignored: ${key}`);
    }
  }
  return out;
}

// Returns a flat { 'review.round_cap': 3, ... } with defaults applied.
export function readConfig(cwd = process.cwd(), warn = (m) => console.error(`config: ${m}`)) {
  const effective = Object.fromEntries(Object.entries(KEYS).map(([k, d]) => [k, d.default]));
  const file = fileFor(cwd);
  if (!fs.existsSync(file)) return effective;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConfigError(`${file}: invalid JSON (${e.message})`);
  }
  if (!isObj(raw)) throw new ConfigError(`${file}: must be a JSON object`);
  // A file written only by consent.mjs has no schema yet; that is version 1.
  if (raw.schema !== undefined && raw.schema !== 1) {
    throw new ConfigError(`schema: must be 1, got ${JSON.stringify(raw.schema)}`);
  }
  return { ...effective, ...walk(raw, '', warn) };
}

// realpath: the plugin dir may be reached through a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const ci = rest.indexOf('--cwd');
  const cwd = ci >= 0 ? rest[ci + 1] : process.cwd();
  const key = rest.find((a, i) => a !== '--cwd' && rest[i - 1] !== '--cwd');
  if (cmd !== 'get' || !key) {
    console.error('usage: config.mjs get <dotted.key> [--cwd <dir>]');
    process.exit(2);
  }
  if (!KEYS[key]) {
    console.error(`config: unknown key ${key}`);
    process.exit(2);
  }
  try {
    console.log(readConfig(cwd)[key]);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(`config: ${e.message}`);
    process.exit(1);
  }
}
