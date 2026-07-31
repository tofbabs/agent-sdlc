# Pair-log carryover — cutting the token cost

**Date:** 2026-07-31
**Status:** approved, ready for an implementation plan
**Touches:** `plugins/agentic-sdlc/commands/build.md`, `agents/navigator.md`,
`agents/coder.md`, new `plugins/agentic-sdlc/scripts/pair-log.mjs`,
`scripts/preflight.sh`, `.github/workflows/validate.yml`

---

## The problem

A PAIR story spawns a fresh navigator and a fresh driver every alternation. That
freshness is deliberate — `445503d` established it, and it is what keeps a story
linear rather than `O(alternations²)`. The price of freshness is that the pair log
is re-read on every turn, so **the log's size is multiplied by every remaining
turn of the story**.

The multiplier is larger than it looks. A subagent's context is re-sent on each of
its internal tool-call round trips — measured at 18 per navigator turn and 42 per
driver turn. So carryover cost is not bytes read, it is:

```
Σ over turns of ( bytes_read × round_trips_in_that_turn )
```

Every byte removed from what an agent reads is worth 18–42 bytes of billed input
per turn it is removed from.

### Measured baseline

From the two PAIR stories on `feat/EPIC-15`, read out of git:

| | STORY-15-1 | STORY-15-3 |
|---|---|---|
| alternations | 31 | 23 |
| total log | 87,387 B | 72,676 B |
| header + STATE (re-read every turn) | 5,420 B | 5,566 B |
| mean turn-log entry | 2,624 B | 2,892 B |
| max entry | 5,434 B | 4,872 B |
| entries over the 10-line cap | 31/31 | 23/23 |
| mean entry length | 43.0 lines | 45.8 lines |

**Both stories predate `445503d` (07-31 08:24); STORY-15-1 ran 07-30 17:xx and
STORY-15-3 finished 03:01.** These numbers are the pre-fix baseline, not evidence
that the current rules are being disobeyed. The current rules have never run.
That cuts both ways: they are also unproven, and they are prose-only.

### Where the cost still sits

Modelling `bytes × round_trips × turns` at ~3.6 B/token, for STORY-15-1:

| variant | cost |
|---|---|
| A — pre-fix, whole log re-read | 25.2M tok |
| B — current rules as written, entry cap unenforced | 5.8M |
| C — entry cap actually enforced | 3.6M |
| **D — C, plus the driver stops reading the header** | **1.6M** |

`445503d` claims A→B. The remaining two thirds are C and D, and D is the larger
of them.

D exists because of an asymmetry nobody has exploited: **the driver runs 42 round
trips to the navigator's 18, so a byte the driver carries costs 2.3× a byte the
navigator carries.** Yet `coder.md:73` and `navigator.md:41` currently instruct
both agents to read the *identical* block, header included. The header is ~78% of
what each reads and it is static for the whole story.

---

## Decisions taken

1. **Enforcement is mechanical, not prose.** The 07-31 fix was documentation-only
   and untested; repeating that shape would be a bet on the same mechanism twice.
2. **The driver reads no header at all** — STATE plus the last two entries only.
   This is the aggressive option. It banks the full 2.0M rather than the 1.4M a
   compressed constraints digest would give, and its risk is accepted explicitly
   (see *Risks*).

---

## Design

### A. The log becomes a directory

`backlog/pair/<STORY-ID>/`:

| File | Written by | Growth | Read by |
|---|---|---|---|
| `brief.md` | orchestrator, once at init | fixed, ~5 KB | **navigator only** |
| `state.md` | navigator, overwritten every turn | fixed, ≤15 lines | both |
| `turns.md` | `pair-log append` only | grows | last 2 entries only |
| `session.json` | `pair-log` only | fixed | orchestrator |

The split is the point. "The driver does not read the header" stops being an
instruction an agent can drift from and becomes a path the driver is never given.
A single file cannot deliver that — any whole-file read hits the header.

### B. Read surface

One command replaces today's `sed` + `tail` pair, which also removes a round trip
from every turn:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/pair-log.mjs read <STORY-ID> --role navigator
node ${CLAUDE_PLUGIN_ROOT}/scripts/pair-log.mjs read <STORY-ID> --role driver
```

- `--role navigator` → `brief.md` + `state.md` + last 2 entries (~6.9 KB)
- `--role driver` → `state.md` + last 2 entries (~1.5 KB)

`read` has no flag that makes it emit `brief.md` for the driver role. That is the
enforcement.

### C. Write surface and the entry cap

```bash
pair-log.mjs init    <STORY-ID> --brief <path>        # creates the four files
pair-log.mjs append  <STORY-ID> --role <r>            # entry body on stdin
pair-log.mjs state   <STORY-ID>                       # new STATE on stdin
pair-log.mjs session <STORY-ID> --set active|complete|blocked [--arch ARCH-<n>]
pair-log.mjs status  <STORY-ID>                       # session + alternation
```

`append` is the only way into `turns.md`. It:

- truncates the body to **10 lines** (`ENTRY_MAX_LINES`),
- strips fenced code blocks entirely — the diff is on the branch, and
  `git diff HEAD~1` is one cheap call,
- stamps the `## N. <role> — <timestamp>` heading itself, so numbering cannot drift,
- on overflow, **truncates and warns on stderr**:
  `entry truncated 43→10 lines; continuity belongs in STATE, not the turn log —
  you pay for turn-log bytes on every remaining turn.`

Truncate rather than reject: a rejection costs the agent a retry, and a driver
retry is 42 round trips. Truncation is the cheaper teacher and still a hard cap.

`state` truncates to **15 lines** (`STATE_MAX_LINES`).

### D. STATE schema

```
- ACs met / remaining: <ids>
- constraints in play: <what THIS increment must respect>   ← new
- next reds planned: <short list>
- open flag / REDO: <or none>
```

`constraints in play` is the safeguard that makes stripping the driver's header
survivable. The binding constraints do not disappear — the navigator routes the
ones relevant to *this* increment into the one block the driver does read. Because
STATE is overwritten rather than appended, that line costs the same on turn 20 as
on turn 2.

**The cap stays at 15 lines, not 20.** `alternation: k of 20` leaves the prose
template — the script owns the count and `status` reports it — so
`constraints in play` arrives at zero net cost and one drift source disappears.

### E. Session signalling

`session.json` carries `{session, arch, alternation}`. The orchestrator calls
`pair-log status` instead of `tail -n 30 … | grep 'SESSION: COMPLETE'`.

This is not tidying. Today's marker is prose inside a turn-log entry, and the new
10-line truncation will eventually clip a `SESSION: COMPLETE` that an agent wrote
on line 11 — the cap and the marker are on a collision course. Decoupling them
removes a failure that would present as a pair loop silently running to its
20-alternation cap.

`alternation` increments on each navigator `append`; `status` fails the run at 20.

### F. Plugin edits

- `build.md` — PAIR LOOP steps 0/2, PAIR LOG SHAPE section, the `tail`-based
  completion check, the two HARD RULES that name whole-log reads.
- `navigator.md` — SHARED STATE table, the `sed`/`tail` snippet, the entry
  template, HARD RULES.
- `coder.md` — MODE: PAIR read instruction at line 73, HARD RULES at 229.

### G. Testing

The plugin repo has no test runner — bash `preflight.sh` plus structural CI. The
tests fit that idiom rather than introducing one. Cases:

1. `init` creates all four files.
2. A 43-line entry lands as exactly 10 body lines; exit 0; stderr warns.
3. An entry containing a fenced block lands with no fence in `turns.md`.
4. `read --role driver` output does not contain a sentinel string planted in
   `brief.md`; `read --role navigator` does.
5. A 30-line STATE truncates to 15.
6. `session --set complete` then `status` reports complete after a truncated
   append — the collision case from §E.
7. `alternation` increments on navigator appends only.

Wired into both `scripts/preflight.sh` and `.github/workflows/validate.yml`.

### H. Migration

`init` only creates the new shape. The existing single-file logs on
`feat/EPIC-15` and `feat/EPIC-12` stay as they are and remain readable by humans;
no in-flight story is rewritten or migrated. There is no back-compatibility path
in `read` — a story is either new-shape or it finishes under the old rules.

---

## Projected result

STORY-15-1, 31 alternations: navigator reads 6,920 B/turn, driver 1,500 B/turn.

```
(6920/3.6×18 + 1500/3.6×42) × 31 ≈ 1.6M tokens
```

- vs the pre-fix baseline (25.2M): **94% reduction**
- vs the current rules as written (5.8M): **72% reduction**

---

## Risks

**The model rests on the 18/42 round-trip figures** recorded in `build.md`. They
are the multiplier on every lever here; if they shift, the ranking of C against D
shifts with them. Worth re-measuring on the first story that runs under this
design.

**Stripping the driver's header is a bet.** It assumes the navigator's
per-increment review plus `constraints in play` catches what a blind driver would
violate. One REDO alternation costs ~0.23M. Measured against the alternative that
was on the table — a ~1.5 KB constraints digest for the driver, 2.16M — the full
strip is ahead by 0.54M, so **the bet turns bad at roughly 2.3 extra REDOs per
story**. That is measurable directly from REDO verdicts in `turns.md`. (Against
keeping the full header, the margin is 8.5 REDOs, so the strip only loses to the
digest, never to the status quo.)
The constraints observed in STORY-15-3's header are exactly the kind a driver
violates ("the disclaimer text is fixed VERBATIM", "AST-based, not a regex", "a
separate field, not an overload of `note`"), so §D is load-bearing, not garnish.

**Truncation loses information.** An agent writing 43 lines silently keeps 10.
The stderr warning is the mitigation; if REDO rates rise after rollout, suspect
this before suspecting the header strip.

---

## Out of scope

Compressing `brief.md` itself (worth a further ~0.3M), and reducing driver round
trips by naming a working set in STATE (~0.2M). Both are real, both are smaller
than what is here, and both are easier to judge once this design has run once.
