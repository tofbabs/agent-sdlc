# Self-improvement: from run telemetry to better briefs

The goal is more high-quality code at a much lower cost. Each run records how
it made its decisions. Consenting repos send those records to a store the
maintainers own. A daily routine turns patterns across repos into proposed
briefs, and a human decides which ones become real.

```
01 run report  ──►  02 export  ──►  storage  ──►  03 signal routine  ──►  GitHub Issue (proposed brief)
(local, code-free)  (opt-in, hardened)            (group, dedupe, triage)  or discard log
```

## Implementation order

| # | Brief | Depends on | Lane | Ships to |
|---|-------|-----------|------|----------|
| 1 | [Run report](01-run-report.md) | — | deliberate (schema ADR) | `plugins/` → `feat:` |
| 2 | [Telemetry export](02-telemetry-export.md) | 1's schema ADR **accepted** | deliberate (storage + identity ADRs) | `plugins/` + ingest service → `feat:` |
| 3 | [Signal routine](03-signal-routine.md) | 1's schema ADR **accepted** | deliberate | this repo only (`templates/routines/`, scripts) |
| 4 | [Mode selection](04-mode-selection.md) | 1's schema ADR **accepted** (with 04's fields in it) | deliberate | `plugins/` → `feat:` |

1. **Plan and build 01 first.** Its schema and category vocabulary are the
   contract the other two depend on, and they become a one-way door once
   reports leave the machine. Don't plan 02 or 03 until that ADR is accepted.
2. **02 and 03 can then run in parallel.** 03 develops against local reports
   and fixtures, so it does not wait for export to go live.
3. **Turn on cross-repo signal** once 02's endpoint is live and 03's routine
   is scheduled. Until then, 03 runs on this repo's own reports.

## Commands

```
/agentic-sdlc:plan docs/briefs/self-improvement/01-run-report.md
# after the schema ADR is accepted:
/agentic-sdlc:plan docs/briefs/self-improvement/02-telemetry-export.md
/agentic-sdlc:plan docs/briefs/self-improvement/03-signal-routine.md
/agentic-sdlc:plan docs/briefs/self-improvement/04-mode-selection.md
```

## Decisions already made

These were settled while scoping the briefs. Don't re-open them during
planning.

- **Payload is structured only.** It holds enums and numbers, with no free
  text, not even redacted text. This keeps reports code-free by construction
  and keeps attacker-written text away from the routine's model pass.
- **Consent is opt-in, asked once, and checked in.** It is a team decision. A
  repo that declines or never answers sends nothing.
- **The board is GitHub Issues.** The routine proposes briefs, and a human
  writes them into `docs/briefs/`. The rule that briefs are hand-written
  stands.
- **Every decision is observable to its outcome.** A lane or mode decision
  carries a stable ID. Its outcomes attach to that ID across later runs
  (build, review, merge, post-merge) and close with a verdict. 01's schema
  must allow that cross-run join. See `04-mode-selection.md`.
- **Storage backend is the architect's call**, within the constraints and
  threat model in 02.
- **Client identity default:** a registration token issued at opt-in. The
  architect confirms or overrides it in 02.

## Status

| # | Planned | Built | Merged |
|---|---------|-------|--------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
