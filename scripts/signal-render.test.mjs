import { readFileSync } from 'node:fs'
import { evaluate } from './signal-scan.mjs'
import { renderIssue } from './signal-render.mjs'

const base = JSON.parse(readFileSync(new URL('./fixtures/signal/report.json', import.meta.url), 'utf8'))
const NEWEST_LINE = /^<!-- signal-newest: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ -->\n/m
let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name} ${detail}`); failed = 1 }
}

const hex = (i) => i.toString(16).padStart(32, 'a')
const entries = []
// 6 repos x 6 runs; the last two runs of each are 10x cost outliers.
for (let s = 1; s <= 6; s++) {
  for (let i = 0; i < 6; i++) {
    const r = structuredClone(base)
    const n = s * 100 + i
    r.run.run_id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    r.build.stories = [{ mode: 'SOLO', alternations: 0 }]
    r.cost.totals = { billed_input_equivalent: i < 4 ? 1000 : 10000 }
    r.review.rounds = i < 4 ? 1 : 5
    if (i % 2 === 0) r.review.findings = [{ category: 'correctness', severity: 'major' }]
    entries.push({
      report: r, source: hex(s),
      source_first_seen: '2026-09-01T00:00:00Z', received_at: '2026-10-07T10:00:00Z',
    })
  }
}
const { qualified } = evaluate(entries, { now: new Date('2026-10-09T12:00:00Z') })
const render = (g) => renderIssue(g, { entries })

check('fixture yields groups of both classes',
  qualified.some((g) => g.kind === 'finding') && qualified.some((g) => g.kind === 'outlier'),
  qualified.map((g) => g.kind).join())

{
  const g = qualified.find((g) => g.kind === 'finding')
  const { title, body, labels } = render(g)
  check('marker is its own first line', body.split('\n')[0] === `<!-- signal: ${g.id} -->`)
  check('labels include signal', labels.includes('signal'))
  check('title is non-empty', title.length > 0)
  check('counts present', body.includes(`Runs: ${g.runs}`) && body.includes(`Distinct repos: ${g.repos}`))
  check('cost and round impact section with global baseline',
    body.includes('## Cost and round impact vs baseline') && /global baseline/.test(body))
  for (const h of ['Problem', 'Users', 'Outcome', 'Success metric', 'Scope — in', 'Scope — out',
    'Value dependency', 'Technical context', 'Constraints', 'Open questions']) {
    check(`draft has "${h}"`, body.includes(`\n## ${h}\n`))
  }
  check('says it is a draft for a human', /Draft generated/.test(body) && /write the brief/.test(body))
}
{
  const g = qualified.find((g) => g.kind === 'outlier')
  const { body } = render(g)
  check('outlier shows ratio and baseline', /vs baseline median: \d/.test(body) && /Baseline median: \d/.test(body), body)
}
{
  const g = qualified.find((g) => g.kind === 'finding')
  const { body } = renderIssue(g, { entries, merged: ['sig-0123456789ab'] })
  check('merged fingerprints join the marker', body.startsWith(`<!-- signal: ${g.id} sig-0123456789ab -->`))
  const { body: none } = renderIssue(g, {})
  check('missing ctx entries prints n/a, not a guess', /`review_rounds`: n\/a/.test(none))
  check('non-fingerprint is refused', (() => { try { renderIssue({ ...g, id: 'x' }, {}); return false } catch { return true } })())
}
// AC2: nothing raw from the reports can appear in any body.
{
  const raw = new Set()
  for (const e of entries) {
    raw.add(e.source); raw.add(e.report.run.run_id)
    for (const m of e.report.decisions ?? []) raw.add(m.decision_id)
  }
  const leaked = []
  for (const g of qualified) {
    const { title, body } = render(g)
    for (const v of raw) if ((title + body).includes(v)) leaked.push(v)
    if (/[0-9a-f]{32}/.test(title + body)) leaked.push('32-hex')
    // The newest-received marker is the one published timestamp; any other is a leak.
    if (/\d{4}-\d\d-\d\dT/.test((title + body).replace(NEWEST_LINE, ''))) leaked.push('timestamp')
  }
  check('no source, run_id, decision_id or timestamp in any body', leaked.length === 0, leaked.join())
}
{
  const a = qualified.map(render)
  const b = evaluate(entries, { now: new Date('2026-10-09T12:00:00Z') }).qualified.map(render)
  check('same group twice renders identically', JSON.stringify(a) === JSON.stringify(b))
}
{
  const g = qualified.find((g) => g.kind === 'finding')
  const [first, second] = render(g).body.split('\n')
  check('the body carries the newest received_at of its members as one second-precision line after the marker',
    first === `<!-- signal: ${g.id} -->` && second === '<!-- signal-newest: 2026-10-07T10:00:00Z -->', second)
  check('a group rendered without evidence carries no newest line', !renderIssue(g, { entries: [] }).body.includes('signal-newest'))
}
process.exit(failed)
