#!/usr/bin/env node
// Telemetry consent answer, stored in the checked-in project config so the
// whole team shares one decision. Reads never throw: a session must not fail
// because of a bad config file.

import fs from 'node:fs';
import path from 'node:path';

const [cmd, ...rest] = process.argv.slice(2);
const ci = rest.indexOf('--cwd');
const cwd = ci >= 0 ? rest[ci + 1] : process.cwd();
const file = path.join(cwd, '.claude', 'agentic-sdlc.json');

function load() {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

if (cmd === 'get') {
  const share = load().telemetry?.share;
  console.log(`share=${typeof share === 'boolean' ? share : 'unanswered'}`);
} else if (cmd === 'set') {
  const val = rest.find((a, i) => a !== '--cwd' && rest[i - 1] !== '--cwd');
  if (val !== 'true' && val !== 'false') {
    console.error('usage: consent.mjs set <true|false> [--cwd <dir>]');
    process.exit(2);
  }
  const cfg = load();
  const tel = cfg.telemetry && typeof cfg.telemetry === 'object' ? cfg.telemetry : {};
  cfg.telemetry = { ...tel, share: val === 'true' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
} else {
  console.error('usage: consent.mjs get|set <true|false> [--cwd <dir>]');
  process.exit(2);
}
