# FAST-<n>: <title>

- Outcome: <what is true after this that isn't now>
- Status: TODO

## Tasks

### T<n>-1: <imperative title>   [S|M]

- files: <paths this task owns>
- done when: <one observable check>
- notes: <only if genuinely non-obvious — usually omit>

### T<n>-2: <imperative title>   [S|M]

- files: <paths>
- done when: <one observable check>
- ⚠ one-way: <only if this hits the five-item list — the architect resolves in place>

<!--
Budget: ~40 lines, `## Tasks` inside the first 10. If it doesn't fit, the brief is
an epic, not a fast run — use /plan without --fast.

`done when` IS the acceptance criterion. One observable check, falsifiable by one
test. Not "Given/when/then", not a persona, not 2-5 criteria — one line.

Tasks run in listed order; that order is the dependency. Add `depends_on` only
where the order isn't enough. Nothing larger than M — split it.

No "Technical notes", no "Out of scope", no sections this format doesn't have.
Anything the coder needs goes in `notes`, in one line, and usually it doesn't.

⚠ one-way marks the five decisions fast mode still hands to the architect:
persisted data model holding real data · public API or event contract · auth,
permission or tenancy boundary · money or PII · a dependency expensive to leave.
Everything else the coder decides and logs. The tag never blocks the run — the
orchestrator batches all of them into one architect pass at the end.
-->
