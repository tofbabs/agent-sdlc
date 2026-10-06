# Tooling Debt

Fixture: trims the real template to the one section run-report.mjs reads.

## Logged by agents

Raw entries appended during `/plan` and `/build`. The gap scan triages these into
the tables above; do not leave them loose.

```markdown
### <thing>
- Raised: <date> by <architect | coder> (<ARCH-n | STORY-id>)
- Current: <what we did instead>
- Risk: LOW | MEDIUM | HIGH
- Category: <debt_category> (run-report-categories.mjs)
- Address when: <concrete, observable trigger>
```

### Fixture entry A — low risk, missing_test
- Raised: 2026-10-01 by coder (STORY-1-1)
- Current: skipped the negative-case test on an internal-only path
- Risk: LOW
- Category: missing_test
- Address when: this path is ever exposed externally

### Fixture entry B — medium risk, hardcoded_value
- Raised: 2026-10-02 by coder (STORY-1-2)
- Current: hardcoded the retry count instead of reading config
- Risk: MEDIUM
- Category: hardcoded_value
- Address when: a second caller needs a different retry count

### Fixture entry C — stale risk token, no category line
- Raised: 2026-10-03 by coder (STORY-1-3)
- Current: left a TODO instead of wiring the real client
- Risk: CRITICAL
- Address when: the real client is ready

### Fixture entry D — high risk, explicit other
- Raised: 2026-10-04 by coder (STORY-1-4)
- Current: deferred the migration to the next release
- Risk: HIGH
- Category: other
- Address when: the next release cuts
