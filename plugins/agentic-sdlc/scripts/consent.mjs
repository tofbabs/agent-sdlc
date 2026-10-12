#!/usr/bin/env node
// Telemetry consent answer, stored in the checked-in project config so the
// whole team shares one decision. Reads never throw: a session must not fail
// because of a bad config file.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { TERMS } from './run-report-categories.mjs';
import { readRaw, updateConfig } from './config.mjs';

function load(cwd) {
  try {
    return readRaw(cwd) ?? {};
  } catch {
    return {};
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// true, false or 'unanswered'.
export function readConsent(cwd) {
  const { share, terms } = load(cwd).telemetry ?? {};
  // A yes covers only the terms it was given under; a no is never re-asked.
  const stale = share === true && !(Number.isInteger(terms) && terms >= TERMS);
  return typeof share === 'boolean' && !stale ? share : 'unanswered';
}

// realpath: the hooks may reach this file through a symlink, and it must still run as a CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const ci = rest.indexOf('--cwd');
  const cwd = ci >= 0 ? rest[ci + 1] : process.cwd();

  if (cmd === 'get') {
    console.log(`share=${readConsent(cwd)}`);
  } else if (cmd === 'set') {
    const val = rest.find((a, i) => a !== '--cwd' && rest[i - 1] !== '--cwd');
    if (val !== 'true' && val !== 'false') {
      console.error('usage: consent.mjs set <true|false> [--cwd <dir>]');
      process.exit(2);
    }
    try {
      updateConfig(cwd, (cfg) => {
        const tel = isObj(cfg.telemetry) ? cfg.telemetry : {};
        const { share: _s, ...others } = tel;
        cfg.telemetry = val === 'true' ? { ...others, share: true, terms: TERMS } : { ...others, share: false };
        return cfg;
      });
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  } else {
    console.error('usage: consent.mjs get|set <true|false> [--cwd <dir>]');
    process.exit(2);
  }
}
