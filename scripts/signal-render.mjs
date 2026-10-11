#!/usr/bin/env node
// Renders a qualifying group as a public issue. The repo is public, so the body
// is built only from closed-vocabulary tokens, fingerprints and numbers: a
// run_id, source or any free-form report string must never reach this file's
// output, which is why members are counted upstream and never read here.
import { METRICS, median } from './signal-scan.mjs'

const TOKEN = /^[a-z0-9_*.-]{1,40}$/
const FINGERPRINT = /^sig-[0-9a-f]{12}$/

// A token outside the closed shape is replaced rather than escaped: escaping still publishes it.
const tok = (v) => (typeof v === 'string' && TOKEN.test(v) ? v : 'other')
const fp = (v) => {
  if (!FINGERPRINT.test(v)) throw new Error('signal-render: not a fingerprint')
  return v
}
const int = (n) => (Number.isFinite(n) ? String(Math.round(n)) : 'n/a')
// Fixed precision keeps the same group byte-identical across runs.
const num = (n) => (Number.isFinite(n) ? String(Number(n.toFixed(2))) : 'n/a')

const METRIC_FOR_COST = { billed_input_per_story: 'billed_input_per_story', review_rounds: 'review_rounds' }

function impact(group, entries) {
  if (group.kind === 'outlier') {
    return [
      `- Metric: \`${tok(group.key.at(-1))}\``,
      `- Group median vs baseline median: ${num(group.ratio)}x`,
      `- Baseline median: ${num(group.baseline)}`,
    ]
  }
  const byRun = new Map(entries.map((e) => [e.report.run.run_id, e.report]))
  const reports = group.members.map((m) => byRun.get(m.run_id)).filter(Boolean)
  return Object.keys(METRIC_FOR_COST).map((metric) => {
    const mine = reports.map(METRICS[metric]).filter((v) => v !== undefined)
    const all = entries.map((e) => METRICS[metric](e.report)).filter((v) => v !== undefined)
    if (!mine.length || !all.length) return `- \`${metric}\`: n/a`
    const g = median(mine)
    const b = median(all)
    return `- \`${metric}\`: group median ${num(g)} vs global baseline ${num(b)}` +
      (b > 0 ? ` (${num(g / b)}x)` : '')
  })
}

export function renderIssue(group, ctx = {}) {
  const entries = ctx.entries ?? []
  const primary = fp(group.id)
  const merged = (ctx.merged ?? []).map(fp)
  const keyText = group.key.map(tok).join(' / ')
  const kind = tok(group.kind)
  const lines = [
    `<!-- signal: ${[primary, ...merged].join(' ')} -->`,
    '',
    '> Draft generated from aggregate counts only. A maintainer should write the brief from the evidence below; nothing here is a decision.',
    '',
    '## Evidence',
    '',
    `- Kind: \`${kind}\``,
    `- Key: ${group.key.map((t) => `\`${tok(t)}\``).join(' ')}`,
    `- Runs: ${int(group.runs)}`,
    `- Distinct repos: ${int(group.repos)}`,
    ...(group.kind === 'debt' ? [`- Debt rows: ${int(group.debt_rows)}`] : []),
    '',
    '## Cost and round impact vs baseline',
    '',
    ...impact(group, entries),
    '',
    '---',
    '',
    '# Feature: <name>',
    '',
    '## Problem',
    '',
    `Recurring \`${kind}\` signal (${keyText}) seen in ${int(group.runs)} runs across ${int(group.repos)} repos. <what is broken or missing, who feels it>`,
    '',
    '## Users',
    '',
    '<primary persona(s)>',
    '',
    '## Outcome',
    '',
    '<what is true after this ships>',
    '',
    '## Success metric',
    '',
    `<the one number that moves; current evidence: ${int(group.runs)} runs in the window>`,
    '',
    '## Scope — in',
    '',
    '- <capabilities that are in>',
    '',
    '## Scope — out',
    '',
    '- <explicitly out>',
    '',
    '## Value dependency',
    '',
    '<does partial delivery have value?>',
    '',
    '## Technical context',
    '',
    '<integration points, constraints, open questions>',
    '',
    '## Constraints',
    '',
    '<data / compliance, deadline>',
    '',
    '## Open questions',
    '',
    '<what is genuinely unknown>',
    '',
  ]
  return {
    title: `Signal: ${kind} ${keyText}`,
    body: lines.join('\n'),
    labels: ['signal', `signal:${kind}`],
  }
}
