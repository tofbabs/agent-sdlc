# EPIC-8: Build-section fixture

- Outcome: stories in every touched state, handoffs raised before and during the build
- Status: IN_PROGRESS
- Artifacts: docs/briefs/build-fixture.md

## Architect handoffs

| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Planned before the build | STORY-8-1 | RESOLVED |
| ARCH-2 | Raised mid-build, tagged | STORY-8-2 | RESOLVED |
| ARCH-3 | Raised mid-build, untagged | STORY-8-5 | RESOLVED |
| ARCH-4 | Raised mid-build, stale tag | STORY-8-5 | RESOLVED |
| ARCH-5 | Raised mid-build, table row only | STORY-8-6 | RESOLVED |

### ARCH-1: Planned before the build
- status: RESOLVED
- category: contract

### ARCH-2: Raised mid-build, tagged
- status: RESOLVED
- category: data

### ARCH-3: Raised mid-build, untagged
- status: RESOLVED

### ARCH-4: Raised mid-build, stale tag
- status: RESOLVED
- category: banana

## Stories

### STORY-8-1: SOLO, done
- status: DONE

### STORY-8-2: PAIR, still marked TODO
- status: TODO

### STORY-8-3: Never touched
- status: TODO

### STORY-8-4: Only a commit tag says it was touched
- status: TODO

### STORY-8-5: SOLO, in progress
- status: IN_PROGRESS

### STORY-8-6: PAIR, done
- status: DONE
