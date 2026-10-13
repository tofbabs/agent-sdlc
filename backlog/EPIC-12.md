# EPIC-12: Wave core, part 2 of 3: lock, phase classifier, `wave tick`

- Brief: docs/briefs/waves/02-wave-core.md
- Part: 2 of 3
- Depends on: EPIC-11
- Outcome: `wave tick` derives each brief's phase from GitHub evidence, writes only changed labels, edits the board, notifies once per stall, and applies the close rule.
- Status: STUB

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-2 | Round comment contract. RESOLVED by ADR-0005 | none | RESOLVED |
| ARCH-3 | Is `wave:deferred` kept, or must the human close the Issue? | close rule | OPEN |
| ARCH-4 | Does a PR closed unmerged return its brief to the pool automatically, or after a human re-label? | close rule | OPEN |
| ARCH-5 | Notification channel; is a comment on the wave epic the durable one? | stall notices | OPEN |

## Stories

### STORY-12-1
- estimate: M
- depends_on: []
(lock: `phase-running` label, wave-run comment, stale detection, two failures => phase:blocked)

### STORY-12-2
- estimate: M
- depends_on: []
(eight-rule phase classifier)

### STORY-12-3
- estimate: M
- depends_on: [STORY-12-1, STORY-12-2]
(tick write path, stall notices, close rule)
