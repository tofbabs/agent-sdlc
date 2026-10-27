# EPIC-14: Wave core, part 4 of 4: `phase --next` sweep, migration-number check, parity config

- Brief: docs/briefs/waves/02-wave-core.md
- Part: 4 of 4
- Depends on: EPIC-13
- Outcome: `/agentic-sdlc:phase --next` picks at most one eligible brief, so 03's hourly sweep routine needs no logic of its own. Migration numbers can't collide across parallel builds when `wave.migrations` is set. The numbers a project tunes per repo become config instead of constants.
- Covers: tick clearing a stale lock and leaving a held one untouched, the revise stall measured from the last commit, the `--next` command surface, the `wave.max_failed_attempts` and `wave.migrations` config keys
- Status: STUB

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Config location. RESOLVED by ADR-0006/0007: `.claude/agentic-sdlc.json`, `wave.*` keys additive via `config.mjs` | none | RESOLVED |
| ARCH-8 | `--next` pick order and outputs. **Decision:** among open Issues labelled `wave:<active N>` with `phase:plan\|build` and no fresh lock, pick by priority label (as `start` ranks), then `phase:build` before `phase:plan` (finish work in flight before starting new; a build is what unblocks a PR), then lowest Issue number. Print exactly one of `ok #n`, `failed #n`, `skipped #n`, `lost lock #n`, `nothing eligible`, which are the results 03's phase routine expects. | none | RESOLVED |

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
rather than the phase age, so tick passes `last_commit_at`. Tests pin both
defaults, so a repo with no config behaves exactly as it does now.)

### STORY-14-4
- estimate: S
- depends_on: []
(tick hands locks off cleanly. `wave-tick.mjs` takes `wave-lock`'s outcome
per brief and:
- `cleared` (stale, under `wave.max_failed_attempts`): returns a marker edit
  `ended=<now> result=stale` for that comment id, plus removal of
  `phase-running`. The command applies both, so the stale run counts once
  (EPIC-13 ARCH-6).
- `held` with a fresh lock: returns no label change for that brief, and the
  board shows `running`. Its classifier phase is ignored for this tick, so a
  plan worker that pushed its plan but hasn't released yet never gets a build
  worker dispatched over it.
`reference/wave.md` tick step 3: "tick reads lock results, never takes a lock,
and clears only a stale one". Tests: a cleared lock yields exactly one edit and
the next tick counts it once; a fresh lock with a pushed plan yields no label
change; a blocked lock still wins as today.)
