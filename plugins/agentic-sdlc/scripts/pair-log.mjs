#!/usr/bin/env node
//
// pair-log.mjs — the pair log's only read and write surface.
//
// WHY THIS EXISTS AS A SCRIPT AND NOT A CONVENTION
//
// A PAIR story spawns a fresh navigator and a fresh driver every alternation, so
// the log is re-read every turn. A subagent's context is re-sent on each of its
// internal tool-call round trips — 18 per navigator turn, 42 per driver turn,
// measured — so carryover cost is
//
//     Σ over turns of ( bytes_read × round_trips_in_that_turn )
//
// which makes every byte in the log worth 18–42 bytes of billed input per turn
// it survives. Two limits follow, and both had been prose:
//
//   1. Turn-log entries cap at 10 lines. Measured mean on EPIC-15 was 43 lines.
//   2. The driver never reads the brief. It runs 42 round trips to the
//      navigator's 18, so a byte it carries costs 2.3× — and the brief is ~78%
//      of what it was being told to read, static for the whole story.
//
// `read --role driver` has no flag that emits the brief, and `append` is the
// only path into turns.md. That is the enforcement; the markdown just explains it.
//
// Zero dependencies, Node 22 (the repo floor). See
// docs/superpowers/specs/2026-07-31-pair-log-carryover-design.md

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ENTRY_MAX_LINES = 10
const STATE_MAX_LINES = 15
const ALTERNATION_CAP = 20
const READ_ENTRIES = 2

const ENTRY_RE = /^## \d+\. /

const STATE_TEMPLATE = `- ACs met / remaining:
- constraints in play:
- next reds planned:
- open flag / REDO: none
`

// ---------------------------------------------------------------- arg parsing

const [, , command, storyId, ...rest] = process.argv

const flags = {}
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true
    } else {
      flags[key] = next
      i++
    }
  }
}

const die = (code, msg) => {
  process.stderr.write(`pair-log: ${msg}\n`)
  process.exit(code)
}

const USAGE = `usage:
  pair-log.mjs init    <STORY-ID> --brief <path> [--root <dir>] [--force]
  pair-log.mjs read    <STORY-ID> --role navigator|driver [--entries <n>]
  pair-log.mjs append  <STORY-ID> --role navigator|driver      (body on stdin)
  pair-log.mjs state   <STORY-ID>                              (STATE on stdin)
  pair-log.mjs session <STORY-ID> --set active|complete|blocked [--arch ARCH-<n>]
  pair-log.mjs status  <STORY-ID>`

if (!command || command === '--help' || command === '-h') die(2, USAGE)
if (!storyId) die(2, `missing <STORY-ID>\n${USAGE}`)

const root = flags.root || 'backlog/pair'
const dir = join(root, storyId)
const F = {
  brief: join(dir, 'brief.md'),
  state: join(dir, 'state.md'),
  turns: join(dir, 'turns.md'),
  session: join(dir, 'session.json'),
}

const requireLog = () => {
  if (!existsSync(F.session)) {
    die(3, `no pair log at ${dir} — run \`pair-log.mjs init ${storyId} --brief <path>\` first`)
  }
}

const readSession = () => JSON.parse(readFileSync(F.session, 'utf8'))
const writeSession = (s) => writeFileSync(F.session, `${JSON.stringify(s, null, 2)}\n`)

const readStdin = () => {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Strip fenced code blocks, then cap the line count.
 *
 * Fences go first and unconditionally: the diff is already on the branch and
 * `git diff HEAD~1` is one cheap call, so a pasted block is pure duplication —
 * duplication every remaining turn of the story pays to re-read. Stripping
 * before the cap also stops a block from eating the 10-line budget and pushing
 * the actual reasoning out.
 *
 * An unterminated fence strips to end of input; that is the safe direction.
 */
const clamp = (body, maxLines) => {
  const out = []
  let inFence = false
  let strippedFence = false
  for (const line of body.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      strippedFence = true
      continue
    }
    if (!inFence) out.push(line)
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop()
  const kept = out.slice(0, maxLines)
  return { text: kept.join('\n'), original: out.length, truncated: out.length > maxLines, strippedFence }
}

/** Split turns.md into entries. Anything before the first `## N.` is the file header. */
const parseEntries = () => {
  if (!existsSync(F.turns)) return []
  const lines = readFileSync(F.turns, 'utf8').split('\n')
  const entries = []
  let current = null
  for (const line of lines) {
    if (ENTRY_RE.test(line)) {
      if (current) entries.push(current)
      current = [line]
    } else if (current) {
      current.push(line)
    }
  }
  if (current) entries.push(current)
  return entries.map((e) => e.join('\n').replace(/\n+$/, ''))
}

// --------------------------------------------------------------- subcommands

if (command === 'init') {
  if (existsSync(F.session) && !flags.force) {
    die(2, `pair log already exists at ${dir} — pass --force to overwrite`)
  }
  if (typeof flags.brief !== 'string') die(2, `init needs --brief <path>\n${USAGE}`)
  if (!existsSync(flags.brief)) die(2, `brief not found: ${flags.brief}`)

  mkdirSync(dir, { recursive: true })
  writeFileSync(F.brief, readFileSync(flags.brief, 'utf8'))
  writeFileSync(F.state, STATE_TEMPLATE)
  writeFileSync(F.turns, `# Turn log — ${storyId}\n`)
  writeSession({ story: storyId, session: 'active', arch: null, alternation: 0 })

  process.stdout.write(`initialised ${dir} (brief.md, state.md, turns.md, session.json)\n`)
  process.exit(0)
}

if (command === 'read') {
  requireLog()
  const role = flags.role
  if (role !== 'navigator' && role !== 'driver') {
    die(2, `read needs --role navigator|driver\n${USAGE}`)
  }
  const n = Number.parseInt(flags.entries ?? String(READ_ENTRIES), 10)
  if (!Number.isFinite(n) || n < 0) die(2, '--entries must be a non-negative integer')

  const parts = []

  // The asymmetry. There is deliberately no flag that puts the brief in front of
  // the driver: it is static, it is ~78% of the read, and the driver pays 42
  // round trips for every byte of it. The navigator carries AC compliance, and
  // routes whatever THIS increment must respect into STATE's `constraints in
  // play` line — which the driver does read, and which costs the same on turn 20
  // as on turn 2.
  if (role === 'navigator') {
    parts.push(readFileSync(F.brief, 'utf8').trimEnd())
  }

  parts.push(`## STATE\n${readFileSync(F.state, 'utf8').trimEnd()}`)

  const entries = parseEntries()
  const recent = n === 0 ? [] : entries.slice(-n)
  parts.push(recent.length ? `## Recent turns\n\n${recent.join('\n\n')}` : '## Recent turns\n\n(none yet)')

  process.stdout.write(`${parts.join('\n\n---\n\n')}\n`)
  process.exit(0)
}

if (command === 'append') {
  requireLog()
  const role = flags.role
  if (role !== 'navigator' && role !== 'driver') {
    die(2, `append needs --role navigator|driver\n${USAGE}`)
  }

  const { text, original, truncated, strippedFence } = clamp(readStdin(), ENTRY_MAX_LINES)
  if (!text.trim()) die(2, 'refusing to append an empty entry')

  const number = parseEntries().length + 1
  const heading = `## ${number}. ${role} — ${new Date().toISOString()}`
  const existing = readFileSync(F.turns, 'utf8').replace(/\n+$/, '')
  writeFileSync(F.turns, `${existing}\n\n${heading}\n${text}\n`)

  // The navigator opens each alternation, so counting its turns counts
  // alternations. The count lives here rather than in STATE's prose so it cannot
  // drift, and so STATE keeps the line for `constraints in play` at no net cost.
  const session = readSession()
  if (role === 'navigator') {
    session.alternation += 1
    writeSession(session)
  }

  if (strippedFence) {
    process.stderr.write(
      'pair-log: stripped a fenced code block. The diff is on the branch — ' +
        '`git diff HEAD~1` is one call, and a pasted block is re-read every remaining turn.\n',
    )
  }
  if (truncated) {
    process.stderr.write(
      `pair-log: entry truncated ${original}→${ENTRY_MAX_LINES} lines. Continuity belongs in ` +
        'STATE (`pair-log.mjs state`), not the turn log — you pay for turn-log bytes on every ' +
        'remaining turn of this story.\n',
    )
  }
  if (session.alternation > ALTERNATION_CAP) {
    process.stderr.write(
      `pair-log: alternation ${session.alternation} exceeds the cap of ${ALTERNATION_CAP}. ` +
        'The increments are too small or the story is too big — split the story rather than ' +
        'raising the cap.\n',
    )
    process.exit(4)
  }
  process.exit(0)
}

if (command === 'state') {
  requireLog()
  const { text, original, truncated } = clamp(readStdin(), STATE_MAX_LINES)
  if (!text.trim()) die(2, 'refusing to write an empty STATE')
  writeFileSync(F.state, `${text}\n`)
  if (truncated) {
    process.stderr.write(
      `pair-log: STATE truncated ${original}→${STATE_MAX_LINES} lines. STATE is overwritten every ` +
        'turn, so it is the cheap place to put the plan — but it is read every turn by both ' +
        'agents, so it is not a free one.\n',
    )
  }
  process.exit(0)
}

if (command === 'session') {
  requireLog()
  const set = flags.set
  if (!['active', 'complete', 'blocked'].includes(set)) {
    die(2, `session needs --set active|complete|blocked\n${USAGE}`)
  }
  if (set === 'blocked' && typeof flags.arch !== 'string') {
    die(2, 'session --set blocked needs --arch ARCH-<n>')
  }
  const session = readSession()
  session.session = set
  session.arch = set === 'blocked' ? flags.arch : null
  writeSession(session)
  process.stdout.write(`session: ${set}${session.arch ? ` (${session.arch})` : ''}\n`)
  process.exit(0)
}

if (command === 'status') {
  requireLog()
  const s = readSession()
  // Machine-readable, and deliberately NOT parsed out of the turn log. The old
  // marker was prose inside an entry, so the 10-line truncation would eventually
  // clip a `SESSION: COMPLETE` written on line 11 — and the symptom would be a
  // pair loop running silently to its alternation cap.
  process.stdout.write(
    `session=${s.session} arch=${s.arch ?? 'none'} alternation=${s.alternation}/${ALTERNATION_CAP}\n`,
  )
  process.exit(0)
}

die(2, `unknown command: ${command}\n${USAGE}`)
