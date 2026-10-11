import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderIssue } from './signal-render.mjs'
import { scan, evaluate, validateMerges, mergeGroups, applyKnownMerges, parseSignalMarker, THRESHOLDS } from './signal-scan.mjs'

const idsOf = (body) => (parseSignalMarker(body) ?? []).filter((t) => t.startsWith('sig-'))

// GitHub may hand back CRLF or trim the trailing newline; neither is a content change.
const same = (a, b) => (a ?? '').replace(/\r\n/g, '\n').trimEnd() === (b ?? '').replace(/\r\n/g, '\n').trimEnd()

const LOG_LABEL = 'signal-discards'
const FIELDS = 'number,state,stateReason,closedAt,body'

// Real adapter kept apart from the sync logic so tests inject a stub instead of
// reaching the network. --state all because closed issues must still be found.
export function ghAdapter() {
  // Bodies go through stdin: a discard log can approach the argv limit.
  const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input })
  const listLabel = (label) => JSON.parse(gh(['issue', 'list', '--label', label, '--state', 'all', '--limit', '1000', '--json', FIELDS]))
  return {
    list: () => listLabel('signal'),
    listDiscards: () => listLabel(LOG_LABEL),
    create: ({ title, body, labels }) => {
      const url = gh(['issue', 'create', '--title', title, '--body-file', '-', ...labels.flatMap((l) => ['--label', l])], body).trim()
      return { number: Number(url.split('/').pop()), url }
    },
    edit: (number, { title, body }) => {
      gh(['issue', 'edit', String(number), ...(title ? ['--title', title] : []), '--body-file', '-'], body)
    },
  }
}

export async function syncIssues(qualified, { entries = [], gh = ghAdapter(), issues, claim = (found, group, body) => body } = {}) {
  const existing = issues ?? await gh.list()

  // Validate before any write so a corrupt tracker never gets half-updated.
  const byId = new Map()
  for (const issue of existing) {
    for (const id of idsOf(issue.body)) {
      if (byId.has(id) && byId.get(id).number !== issue.number) {
        throw new Error(`fingerprint ${id} is claimed by issues #${byId.get(id).number} and #${issue.number}`)
      }
      byId.set(id, issue)
    }
  }

  const plan = qualified.map((group) => {
    const merged = (group.merged ?? []).filter((i) => i !== group.id)
    // Any fingerprint of a merged set may name the issue, because a merge can change the primary.
    const claimed = new Set([group.id, ...merged].map((i) => byId.get(i)).filter(Boolean))
    if (claimed.size > 1) {
      throw new Error(`group ${group.id} spans issues ${[...claimed].map((i) => `#${i.number}`).join(' and ')}; close one or split the merge`)
    }
    const found = [...claimed][0]
    const rendered = renderIssue(group, { entries, merged })
    return { group, found, ...rendered, body: claim(found, group, rendered.body) }
  })

  const result = { created: [], updated: [], unchanged: [] }
  for (const { group, found, title, body, labels } of plan) {
    if (!found) {
      const made = await gh.create({ title, body, labels })
      result.created.push({ id: group.id, number: made?.number })
    } else if (same(found.body, body)) {
      result.unchanged.push({ id: group.id, number: found.number })
    } else {
      await gh.edit(found.number, { title, body })
      result.updated.push({ id: group.id, number: found.number })
    }
  }
  return result
}

// Precedence filed > discarded > no_signal keeps each accepted report in exactly one bucket,
// so the three counts always sum to `accepted`.
export function account(entries, { qualified, discards }, rejectedByReason = {}) {
  const runIds = (groups) => new Set(groups.flatMap((g) => g.members.map((m) => m.run_id)))
  const filedIds = runIds(qualified)
  const discardedIds = runIds(discards)
  const a = { accepted: entries.length, filed: 0, discarded: 0, no_signal: 0,
    rejected: Object.values(rejectedByReason).reduce((x, n) => x + n, 0), rejectedByReason }
  for (const e of entries) {
    const id = e.report.run.run_id
    if (filedIds.has(id)) a.filed++
    else if (discardedIds.has(id)) a.discarded++
    else a.no_signal++
  }
  return a
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// Members are omitted: the file is committed, and verdict members must not leak outside the store.
export const discardsJson = (discards) =>
  JSON.stringify([...discards].sort(byId).map(({ id, kind, key, runs, repos, reason }) =>
    ({ id, kind, key, runs, repos, reason })), null, 2) + '\n'

// Sorted by id and free of timestamps so an unchanged run renders identical bytes and causes no edit.
export function renderDiscardLog(discards, acct, { maxChars = 60000 } = {}) {
  const head = [
    '# Signal discards', '',
    `no_signal: ${acct.no_signal}`, `rejected: ${acct.rejected}`, '',
    '| fingerprint | key | runs | sources | failed rule |', '| --- | --- | --- | --- | --- |',
  ]
  const row = (g) => `| ${g.id} | ${g.key.join('/')} | ${g.runs} | ${g.repos} | ${g.reason} |`
  const render = (rows, omitted) => [...head, ...[...rows].sort(byId).map(row),
    ...(omitted ? ['', `${omitted} rows omitted`] : [])].join('\n') + '\n'

  // Lowest-runs-first cut, so the weakest evidence is what falls off the end.
  const ranked = [...discards].sort((a, b) => b.runs - a.runs || byId(a, b))
  let kept = ranked.length
  while (kept > 0 && render(ranked.slice(0, kept), ranked.length - kept).length > maxChars) kept--
  return render(ranked.slice(0, kept), ranked.length - kept)
}

export const summaryLine = (a) => {
  const by = Object.entries(a.rejectedByReason ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ')
  return `accepted ${a.accepted} = filed ${a.filed} + discarded ${a.discarded} + no_signal ${a.no_signal}; rejected ${a.rejected} by reason${by ? `: ${by}` : ''}`
}

const pickLogIssue = (issues) => {
  if (issues.length > 1) throw new Error(`expected one ${LOG_LABEL} issue, found #${issues.map((i) => i.number).join(', #')}`)
  return issues[0]
}

// One long-lived issue, overwritten: a comment per run would grow without bound and a signal
// label would feed the log back into the issues it describes.
export async function syncDiscardLog(discards, acct, { gh = ghAdapter(), existing } = {}) {
  const found = pickLogIssue(existing ?? await gh.listDiscards())
  const body = renderDiscardLog(discards, acct)
  if (!found) {
    const made = await gh.create({ title: 'Signal discards', body, labels: [LOG_LABEL] })
    return { action: 'created', number: made?.number }
  }
  if (same(found.body, body)) return { action: 'unchanged', number: found.number }
  await gh.edit(found.number, { body })
  return { action: 'updated', number: found.number }
}

const NEWEST = /<!--\s*signal-newest:\s*(\S+)\s*-->/

// Reports received after the newest one any signal issue reflects; with no issue yet, every report is new.
export function newSinceLastRun(entries, issues) {
  const seen = issues.map((i) => NEWEST.exec(i.body ?? '')?.[1]).map(Date.parse).filter(Number.isFinite)
  if (!seen.length) return entries.length
  const newest = Math.max(...seen)
  return entries.filter((e) => Date.parse(e.received_at) > newest).length
}

// Only an issue closed as completed claims a fix; the fix ships in the first release cut at or after the close.
export function cutoverVersion(issue, tags) {
  if (issue.state !== 'CLOSED' || issue.stateReason !== 'COMPLETED') return null
  const closed = Date.parse(issue.closedAt)
  const first = tags
    .filter((t) => Date.parse(t.date) >= closed)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0]
  return first ? first.tag.replace(/^v/, '') : null
}

// creatordate is the tag date for annotated tags and the commit date for lightweight ones, which is when the release was cut either way.
export function readTags(repoDir = '.') {
  try {
    const raw = execFileSync('git', ['-C', repoDir, 'for-each-ref', '--format=%(refname:short) %(creatordate:iso-strict)', 'refs/tags/v*'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return raw.split('\n').filter(Boolean).map((l) => {
      const [tag, date] = l.split(' ')
      return { tag, date }
    }).filter((t) => /^v\d+(\.\d+)*$/.test(t.tag))
  } catch {
    return []
  }
}

export async function runSync({ dir, mergesFile, now = new Date(), out, gh = ghAdapter(), log = console.log, tags = [] }) {
  const { entries, rejected } = scan(dir, { now })

  // Read both lists and validate before the first write, so a corrupt tracker leaves nothing half-done.
  const issues = await gh.list()
  const logIssues = await gh.listDiscards()
  pickLogIssue(logIssues)

  const known = [...issues].sort((a, b) => a.number - b.number)
    .map((i) => parseSignalMarker(i.body)).filter((ids) => ids && ids.length > 1)
  let rejectedMerges
  const merge = (groups, opts) => {
    const afterKnown = applyKnownMerges(groups, known, opts)
    if (!mergesFile || !existsSync(mergesFile)) return afterKnown
    let doc
    try { doc = JSON.parse(readFileSync(mergesFile, 'utf8')) } catch { doc = null }
    rejectedMerges = validateMerges(doc, afterKnown)
    return rejectedMerges ? afterKnown : mergeGroups(afterKnown, doc, opts)
  }
  const result = evaluate(entries, { now, merge })

  const ratesFor = (issue, group) => {
    const version = cutoverVersion(issue, tags)
    return version ? shipRates(group, entries, version) : null
  }
  // The render would overwrite the claim, so re-apply it; the frozen marker comes from the issue's current body.
  const claim = (found, group, body) => {
    if (!found) return body
    const frozen = (found.body ?? '').match(BEFORE_MARKER)
    return withShipClaim(frozen ? `${body}${CLAIM_START}${frozen[0]}\n` : body, ratesFor(found, group))
  }
  const synced = await syncIssues(result.qualified, { entries, gh, issues, claim })

  // A group that fell out of the qualified set still has a closed issue whose claim needs refreshing.
  const qualifiedIssues = new Set(result.qualified.flatMap((g) => [g.id, ...(g.merged ?? [])]).flatMap((id) => issues.filter((i) => idsOf(i.body).includes(id))))
  for (const issue of issues) {
    if (qualifiedIssues.has(issue)) continue
    const ids = idsOf(issue.body)
    const group = result.discards.find((g) => ids.includes(g.id) || (g.merged ?? []).some((m) => ids.includes(m)))
    if (!group) continue
    const body = withShipClaim(issue.body ?? '', ratesFor(issue, group))
    if (!same(issue.body, body)) await gh.edit(issue.number, { body })
  }
  const acct = account(entries, result, rejected)
  if (out) {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'discards.json'), discardsJson(result.discards))
  }
  const logged = await syncDiscardLog(result.discards, acct, { gh, existing: logIssues })

  log(`issues: ${synced.created.length} created, ${synced.updated.length} updated, ${synced.unchanged.length} unchanged`)
  log(`discard log: ${logged.action}`)
  if (rejectedMerges) log(`merge_rejected:${rejectedMerges}`)
  log(`new since last run: ${newSinceLastRun(entries, issues)}`)
  log(summaryLine(acct))
  return { synced, logged, acct }
}

const semverCmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

// Caps apply to the group and the cohort alike so one chatty repo cannot swing either side of the ratio.
export function shipRates(group, entries, version) {
  const rules = group.kind === 'outlier' ? THRESHOLDS.cost : THRESHOLDS.quality
  const capped = (items) => {
    const perSource = new Map()
    for (const s of items) perSource.set(s, (perSource.get(s) ?? 0) + 1)
    return [...perSource.values()].reduce((a, n) => a + Math.min(n, rules.cap), 0)
  }
  const isAfter = (e) => semverCmp(e.report.run.plugin_version, version) >= 0
  const versionOf = new Map(entries.map((e) => [e.report.run.run_id, e.report.run.plugin_version]))
  const side = (after) => {
    const inSide = (v) => v !== undefined && (semverCmp(v, version) >= 0) === after
    const cohort = entries.filter((e) => isAfter(e) === after)
    const weighted = capped(cohort.map((e) => e.source))
    const runs = capped(group.members.filter((m) => inSide(versionOf.get(m.run_id))).map((m) => m.source))
    return { runs, weighted, rate: weighted ? runs / weighted : 0 }
  }
  const after = side(true)
  if (after.weighted < rules.min_runs) return null
  return { before: side(false), after }
}

const CLAIM_START = '\n<!-- signal-claim -->\n'
const BEFORE_MARKER = /<!-- signal-before: (\d+)\/(\d+) -->/

// The before-rate is frozen on first sight so later runs cannot rewrite history
// once the group has left the qualified set.
export function withShipClaim(body, rates) {
  if (!rates) return body
  const at = body.indexOf(CLAIM_START)
  const original = at === -1 ? body : body.slice(0, at)
  const frozen = body.match(BEFORE_MARKER)
  const before = frozen ? { runs: Number(frozen[1]), weighted: Number(frozen[2]) } : rates.before
  const { after } = rates
  return `${original}${CLAIM_START}<!-- signal-before: ${before.runs}/${before.weighted} -->\nbefore: ${before.runs} of ${before.weighted} runs\nafter: ${after.runs} of ${after.weighted} runs\n`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const flag = (n) => { const i = args.lastIndexOf(n); return i < 0 ? undefined : args[i + 1] }
  const source = flag('--source') ?? ''
  const now = flag('--now') === undefined ? new Date() : new Date(flag('--now'))
  if (!source.startsWith('dir:') || Number.isNaN(now.getTime())) {
    console.error('usage: signal-sync.mjs --source dir:<path> [--merges <file>] [--now <iso>] [--out <dir>] [--repo <dir>]')
    process.exit(2)
  }
  try {
    await runSync({ dir: source.slice(4), mergesFile: flag('--merges'), now, out: flag('--out'), tags: readTags(flag('--repo') ?? '.') })
  } catch (e) {
    console.error(`signal-sync: ${e.message}`)
    process.exit(1)
  }
}
