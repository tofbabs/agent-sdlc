#!/usr/bin/env node
// Renders the wave board comment from JSON on stdin. Pure so the same wave
// state always yields the same text and `start` can edit the comment in place.

import { readFileSync } from 'node:fs';

function duration(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function render({ wave, epic, now, briefs }) {
  const at = Date.parse(now);
  // A bad timestamp would post "NaNm" to a public Issue; refuse before that.
  for (const b of briefs) {
    if (Number.isNaN(at) || Number.isNaN(Date.parse(b.since))) {
      throw new Error(`unparseable now/since for #${b.number}`);
    }
  }
  const rows = [...briefs]
    .sort((a, b) => a.number - b.number)
    .map((b) => `| #${b.number} | ${b.phase} | ${b.pr ? `#${b.pr}` : '—'} | ${duration(at - Date.parse(b.since))} |`);
  return [
    `<!-- wave-board:${wave} -->`,
    `## Wave ${wave} (epic #${epic})`,
    '',
    '| Brief | Phase | PR | In phase |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(render(JSON.parse(readFileSync(0, 'utf8'))));
  } catch (e) {
    console.error(`wave-board: ${e.message}`);
    process.exit(2);
  }
}
