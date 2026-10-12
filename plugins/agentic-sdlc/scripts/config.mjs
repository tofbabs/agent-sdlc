#!/usr/bin/env node
// The one reader of .claude/agentic-sdlc.json (docs/adr/0006). Defaults live
// only here so a consuming project's file needs to say nothing it does not want
// to change. Bad input throws rather than falling back: a mistyped cap that
// quietly became the default would change review behaviour with no signal.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  review: { round_cap: 3 },
  plan: {
    epic: {
      points: { S: 3, M: 5, L: 15 },
      cap: 15,
      max_lines: 150,
      stories_by_line: 40,
      anchors: { S: { lines: 150, files: 4 }, M: { lines: 400, files: 8 }, L: { lines: 800, files: 12 } },
    },
  },
};

const fileFor = (cwd) => path.join(cwd, '.claude', 'agentic-sdlc.json');
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
}

export class ConfigError extends Error {
  constructor(key, problem) {
    super(`config: ${key}: ${problem}`);
  }
}

const isInt = (v) => Number.isInteger(v) && v >= 1;
const SIZES = ['S', 'M', 'L'];
const ANCHOR_DIMS = ['lines', 'files'];
const LIMITS = ['cap', 'max_lines', 'stories_by_line'];

function validateReview(review) {
  if (review === undefined) return;
  if (!isObj(review)) throw new ConfigError('review', 'must be an object');
  if (review.round_cap !== undefined && !isInt(review.round_cap)) {
    throw new ConfigError('review.round_cap', 'must be an integer >= 1');
  }
}

function validateShape(raw) {
  if (raw.schema !== undefined && raw.schema !== 1) throw new ConfigError('schema', 'must be 1');
  validateReview(raw.review);
  if (raw.plan === undefined) return;
  if (!isObj(raw.plan)) throw new ConfigError('plan', 'must be an object');
  const epic = raw.plan.epic;
  if (epic === undefined) return;
  if (!isObj(epic)) throw new ConfigError('plan.epic', 'must be an object');
  for (const k of LIMITS) {
    if (epic[k] !== undefined && !isInt(epic[k])) {
      throw new ConfigError(`plan.epic.${k}`, 'must be an integer >= 1');
    }
  }
  if (epic.points !== undefined) {
    if (!isObj(epic.points)) throw new ConfigError('plan.epic.points', 'must be an object');
    for (const [k, v] of Object.entries(epic.points)) {
      if (!SIZES.includes(k)) {
        throw new ConfigError(`plan.epic.points.${k}`, 'unknown size, expected S, M or L');
      }
      if (!isInt(v)) throw new ConfigError(`plan.epic.points.${k}`, 'must be an integer >= 1');
    }
  }
  if (epic.anchors === undefined) return;
  if (!isObj(epic.anchors)) throw new ConfigError('plan.epic.anchors', 'must be an object');
  for (const [size, leaf] of Object.entries(epic.anchors)) {
    const at = `plan.epic.anchors.${size}`;
    if (!SIZES.includes(size)) throw new ConfigError(at, 'unknown size, expected S, M or L');
    if (!isObj(leaf)) throw new ConfigError(at, 'must be an object');
    for (const dim of ANCHOR_DIMS) {
      if (leaf[dim] !== undefined && !isInt(leaf[dim])) {
        throw new ConfigError(`${at}.${dim}`, 'must be an integer >= 1');
      }
    }
  }
}

// Ordering is judged on the merged config, so a lone override that breaks a
// default it never mentioned is still caught; the message says which side is the default.
function validateOrder(epic, rawEpic) {
  const fromFile = (key) => {
    const parts = key.split('.');
    return parts.reduce((o, k) => (isObj(o) ? o[k] : undefined), rawEpic) !== undefined;
  };
  const chain = [
    ['points.S', 'points.M'],
    ['points.M', 'points.L'],
    ['points.L', 'cap'],
    ['stories_by_line', 'max_lines'],
    ...ANCHOR_DIMS.flatMap((d) => [[`anchors.S.${d}`, `anchors.M.${d}`], [`anchors.M.${d}`, `anchors.L.${d}`]]),
  ];
  const at = (key) => key.split('.').reduce((o, k) => o[k], epic);
  for (const [lo, hi] of chain) {
    if (at(lo) <= at(hi)) continue;
    const l = `plan.epic.${lo}`;
    const h = `plan.epic.${hi}`;
    const msg = fromFile(lo)
      ? `${at(lo)} exceeds ${h} ${at(hi)}${fromFile(hi) ? '' : ', the default'}`
      : `${at(lo)}, the default, exceeds ${h} ${at(hi)}`;
    throw new ConfigError(l, msg);
  }
}

const KNOWN = {
  schema: true,
  telemetry: true,
  review: { round_cap: true },
  plan: { epic: { points: { S: true, M: true, L: true }, cap: true, max_lines: true, stories_by_line: true, anchors: { S: { lines: true, files: true }, M: { lines: true, files: true }, L: { lines: true, files: true } } } },
};

// Keeps only registered keys so a typo can never leak into the effective config.
function prune(raw, known, prefix, unknown) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const spec = known[k];
    if (spec === undefined) unknown.push(`${prefix}${k}`);
    else out[k] = spec === true || !isObj(v) ? v : prune(v, spec, `${prefix}${k}.`, unknown);
  }
  return out;
}

// The file as written: no defaults, no pruning, so a writer can round-trip
// keys this version does not know. Null means the file does not exist.
export function readRaw(cwd = process.cwd()) {
  let text;
  try {
    text = fs.readFileSync(fileFor(cwd), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError('file', 'invalid JSON');
  }
  if (!isObj(raw)) throw new ConfigError('file', 'must be an object');
  return raw;
}

// Refuses before touching the file, so a hand-broken config is never overwritten.
export function updateConfig(cwd, mutate) {
  const existing = readRaw(cwd);
  if (existing && existing.schema !== undefined && existing.schema !== 1) {
    throw new ConfigError('schema', 'must be 1');
  }
  const next = mutate(existing ?? { schema: 1 });
  const file = fileFor(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
}

export function readConfig(cwd = process.cwd()) {
  let raw = readRaw(cwd) ?? {};
  validateShape(raw);
  const unknown = [];
  raw = prune(raw, KNOWN, '', unknown);
  const merged = merge(DEFAULTS, raw);
  validateOrder(merged.plan.epic, raw.plan?.epic ?? {});
  for (const k of unknown) console.error(`config: ${k}: unknown key, ignored`);
  return merged;
}

// realpath: the hooks may reach this file through a symlink, and it must still run as a CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const ci = rest.indexOf('--cwd');
  const cwd = ci >= 0 ? rest[ci + 1] : process.cwd();
  const key = rest.find((a, i) => a !== '--cwd' && rest[i - 1] !== '--cwd');
  if (cmd !== 'get' || !key) {
    console.error('usage: config.mjs get <dotted.key> [--cwd <dir>]');
    process.exit(2);
  }
  let cfg;
  try {
    cfg = readConfig(cwd);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(e.message);
    process.exit(2);
  }
  // telemetry and schema are consent.mjs's and the file's own; the CLI serves only pipeline settings.
  if (['telemetry', 'schema'].includes(key.split('.')[0])) {
    console.error(`config: ${key}: unknown key`);
    process.exit(2);
  }
  const val = key.split('.').reduce((o, k) => (isObj(o) ? o[k] : undefined), cfg);
  if (val === undefined) {
    console.error(`config: ${key}: unknown key`);
    process.exit(2);
  }
  console.log(typeof val === 'string' ? val : JSON.stringify(val));
}
