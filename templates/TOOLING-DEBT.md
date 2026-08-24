# Tooling Debt

**Current stage:** <1 Prototype | 2 Real users | 3 Team/scale | 4 Mature> — <one line of reasoning>
**Last scanned:** <YYYY-MM-DD>

> A ledger, not a backlog of failures. Missing tooling is correct at an early
> stage. What matters is that each gap has a **concrete, observable trigger**.
>
> Maintained by the weekly gap-scan routine. Appended to by `architect` and
> `coder` during builds.

## Now — blocking real risk

| Gap | Risk | Why now | Effort |
|-----|------|---------|--------|
| | | | |

> If this table exceeds 5 entries, the gap scan says so at the top of the file:
> **recommend pausing feature work.**

## Next — at the coming milestone

| Gap | Trigger | Effort |
|-----|---------|--------|
| | | |

## Later — acknowledged, not yet worth it

| Gap | Trigger | Effort |
|-----|---------|--------|
| | | |

## Accepted — deliberately not doing this

| Gap | Why it is fine | Revisit if |
|-----|----------------|------------|
| | | |

## Fast-mode shortcuts

Written by `--fast` runs. One row per shortcut — if logging one costs more than
taking it, nobody logs anything. Triaged by the gap scan like any other entry.

| Shortcut | Instead of | Trigger to fix | From |
|----------|------------|----------------|------|
| | | | |

> A `--fast` run adds one line naming itself, so a reader knows why the rows are
> here: `_Run: FAST-3, 2026-08-23, tasks T3-1..T3-6 — built in fast mode._`
>
> What belongs here: a missing test on a risk surface (auth, money, destructive
> data paths, external contracts) — including one covered by a happy-path test with
> no negative case, which is the same gap — a hardcoded value, a stubbed
> integration, a deferred migration. What does **not**: "skipped TDD", "did not pair", "wrote
> fewer tests". Fast mode's whole shape is those things; rows restating it are how
> a ledger stops being read.

## Logged by agents

Raw entries appended during `/plan` and `/build`. The gap scan triages these into
the tables above; do not leave them loose.

```markdown
### <thing>
- Raised: <date> by <architect | coder> (<ARCH-n | STORY-id>)
- Current: <what we did instead>
- Risk: LOW | MEDIUM | HIGH
- Address when: <concrete, observable trigger>
```

<!--
Triggers are observable or they are not triggers. "Before the first external
user", "when a second engineer appears in git shortlog -sn", "above 100 req/s".
Never "soon", "when mature", or a calendar quarter.

Do not inflate risk. Crying HIGH on everything is how a ledger gets ignored, and
an ignored ledger is worse than none.
-->
