# EPIC-14: Wave core, part 4 of 4: `phase --next` sweep, migration-number check, parity config

- Brief: docs/briefs/waves/02-wave-core.md
- Part: 4 of 4
- Depends on: EPIC-13
- Outcome: `/agentic-sdlc:phase --next` picks at most one eligible brief, so 03's hourly sweep routine needs no logic of its own. Migration numbers can't collide across parallel builds when `wave.migrations` is set. The last numbers QuestionMe tunes per repo become config instead of constants.
- Covers: PARITY C12 (revise stall from last commit), the `--next` command surface, the `wave.max_failed_attempts` and `wave.migrations` config keys
- Status: STUB

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Config location. RESOLVED by ADR-0006/0007: `.claude/agentic-sdlc.json`, `wave.*` keys additive via `config.mjs` | none | RESOLVED |
| ARCH-8 | `--next` sweep form: what order picks the one Issue (priority, then Issue number, as `start` sorts?), does a `plan` beat a `build`, and what does it print when nothing is eligible? `routines/wave-phase-prompt.md` assumes the results `ok`, `failed`, `skipped`, `lost lock` and `nothing eligible`. | STORY-14-1 | OPEN |

## Stories

### STORY-14-1
- estimate: S
- depends_on: []
(`phase --next`: list the open Issues labelled `wave:<active N>` with `phase:plan|build`,
drop any with a fresh lock (the `wave-lock.mjs` reader), pick one per ARCH-8, then run
EPIC-13's path for it. One Issue per session. Pure selection over a payload, with
a test.)

### STORY-14-2
- estimate: M
- depends_on: []
(migration-number check, `scripts/wave-migrations.mjs` + `.test.sh`, only when
`wave.migrations.{dir,pattern}` is set: the next number above the highest match on
`origin/<base>` and every open `feat/*` branch (`git ls-tree`). Re-check just before
push and renumber if one was taken meanwhile. Wired into `phase build` (STORY-13-3)
before commit and before push. Config keys with `config.test.sh` cases.)

### STORY-14-3
- estimate: S
- depends_on: []
(parity config and tick tuning: `wave.max_failed_attempts` replaces `wave-lock.mjs`'s
`MAX_ATTEMPTS = 2` (default 2). A revise stall is measured from the PR's last commit
rather than the phase age, so tick passes `last_commit_at` (C12). Tests pin both
defaults, so a repo with no config behaves exactly as it does now.)
