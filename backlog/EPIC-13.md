# EPIC-13: Wave core, part 3 of 3: `phase` worker and migration-number check

- Brief: docs/briefs/waves/02-wave-core.md
- Part: 3 of 3
- Depends on: EPIC-12
- Outcome: `/agentic-sdlc:phase <plan|build> <issue>` runs one locked phase in a fresh session, ending in a PR with `Closes #<issue>`; migration numbers are checked before each push.
- Status: STUB

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-2 | Round comment contract. RESOLVED by ADR-0005 | none | RESOLVED |

## Stories

### STORY-13-1
- estimate: M
- depends_on: []
(phase plan: lock, plan --id, commit plan to feat/<id>, label build)

### STORY-13-2
- estimate: M
- depends_on: [STORY-13-1]
(phase build: resume branch, gate, PR, label ci; clear lock on every exit; model per worker, pinned version)

### STORY-13-3
- estimate: M
- depends_on: []
(migration-number collision check; only when a pattern is configured)
