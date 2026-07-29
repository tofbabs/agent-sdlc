# EPIC-<n>: <title>

- Outcome: <what is true after this that isn't now>
- Success metric: <the one number, if there is one>
- Status: TODO

## Architect handoffs

| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | <the decision the planner refused to make> | STORY-1-2 | OPEN |

### ARCH-<n>: <the question>

- status: OPEN
- blocks: [STORY-IDs]

**Context:** <why this comes up>
**Why I'm not deciding:** <what makes this bigger than one story>

<!-- The architect resolves in place:

### ARCH-<n>: <question>
- status: RESOLVED
- reversibility: TWO-WAY

**Decision:** <what to do>
**Why:** <one or two sentences>
**Note:** <anything the coder needs to implement it>

A ONE-WAY door gets docs/adr/<NNNN>-<slug>.md as well — and still gets decided.
-->

## Stories

### STORY-<epic>-<n>: <title>

- status: TODO
- estimate: S | M | L
- depends_on: []
- blocked_by_arch: [ARCH-n]

**As a** <persona>
**I want** <capability>
**So that** <outcome>

**Acceptance criteria**

1. Given <context>, when <action>, then <observable outcome>

**Technical notes**

- Files / modules likely touched
- Anything the coder should know but shouldn't have to rediscover

**Out of scope**

- What this story explicitly does NOT do

<!--
Vertically sliced — "add the database table" produces nothing observable.
Independently shippable. Nothing larger than L; split it.
2–5 acceptance criteria, each testable. A criterion no test could falsify is a
wish, not a criterion.

depends_on drives the topological sort in /build. A dependent story starts on its
parent's COMMIT, not its merge, so a whole epic runs in one go.
-->
