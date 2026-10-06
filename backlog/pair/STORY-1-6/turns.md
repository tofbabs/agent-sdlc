# Turn log — STORY-1-6

## 1. navigator — 2026-10-06T10:41:33.634Z
- review of increment N-1: n/a (first turn, no increment yet)
- tests added: run-report.mjs `mark` fresh-run marker — command/lane/target parse, uuid v4 run_id, sessions=1, prior clock 0, started_at=now; targets AC1/AC3 (marker is the UserPromptSubmit path)
- steer: build the `mark` subcommand only this round; keep the shell hook thin and later. Trap: prompt text must be read from --prompt-file, never argv (it can carry anything) — and do not touch report schema 1.

## 2. driver — 2026-10-06T10:45:43.478Z
- made green: mark subcommand writes fresh run-state.json (uuid run_id, command/lane/target parse, sessions 1, prior clock 0, started_at=now)
- approach: parsePrompt reads first line "/agentic-sdlc:<cmd> <rest>"; --fast flips lane and is stripped from target; unconditional fresh-write, no continuation/supersession logic yet
- flag: session flag is only presence-checked, unused until continuation lands next; arch_snapshot/debt_snapshot/backlog written as [] /null/null placeholders pending increment 2

## 3. navigator — 2026-10-06T10:50:29.987Z
- review of increment N-1: OK — mark fresh marker conforms to THE RUN MARKER doc (uuid v4, sessions 1, prior 0, lane/target parse, prompt read from file); arch/debt/backlog are declared placeholders
- tests added: mark snapshots at run start — arch_snapshot = every ARCH id in resolved backlog (EPIC-7 => ARCH-1..5), backlog resolves to the file, debt_snapshot agrees with report (rows_logged=0); degrade guard: unresolvable backlog + no ledger -> [] / null / null. Targets AC1/AC3.
- steer: REUSE resolveBacklogPath + debtLedgerEntries, do not reimplement the resolution order. Trap: a plan run's backlog may not exist yet -> [] + null, never crash. Report schema 1 stays frozen.

## 4. driver — 2026-10-06T10:57:32.964Z
- made green: mark snapshots arch_snapshot/backlog/debt_snapshot at run start
- approach: reused resolveBacklogPath/parseBacklog/debtLedgerEntries inside mark(), stored backlog as path relative to project root
- flag: none

## 5. navigator — 2026-10-06T11:00:55.838Z
- review of increment N-1: OK — mark snapshots reuse resolveBacklogPath/parseBacklog/debtLedgerEntries, degrade path (unresolvable backlog + no ledger -> [] / null / null) holds, report rows_logged=0 agrees, schema 1 untouched; suite green
- tests added: continuation across sessions — same command+target, NEW session keeps run_id, sessions+1, folds 600s into wall_clock_s_prior, started_at=now; SAME-session re-prompt keeps run_id, no bump, clock + started_at untouched. Targets AC3.
- steer: mark must read the existing marker and record its last session in a local-only field. Fold = prior + (now - started_at) then started_at=now, so the report's prior+now-started_ms counts each second once — do not also advance started_at elsewhere. Supersession (different cmd/target) is the NEXT red, not this one.

## 6. navigator — 2026-10-06T11:05:43.098Z
- review of increment N-1: REDO (corrective, orchestrator-steered): last turn's continuation test encoded the wrong clock semantics — it folded (now − started_at) at the NEXT prompt, counting the idle gap between sessions (a run resumed next morning books the night). Replaced that test region; no new behaviour this turn.
- tests added: mark continuation across sessions under ARCH-4 — new session (predecessor closed → banked prior carried through unfolded; predecessor crashed → fold nothing) keeps run_id, sessions+1, started_at=now, session_open=true; same-session re-prompt is not a boundary. Targets AC3. Red for the right reason (continuation unimplemented; run_id changes, sessions stays 1, no session_open).
- steer: mark NEVER folds — folding is the SessionEnd path's job. Next driver red = make mark continuation green (read existing marker, record session_id/session_open, carry prior through). THEN the SessionEnd fold + report-uses-prior-when-closed is a separate round.

## 7. driver — 2026-10-06T11:13:01.497Z
- made green: mark continuation across sessions (closed/banked, crashed/unbanked, same-session re-prompt)
- approach: mark reads existing marker; same session_id -> no-op; new session_id + same command/target -> keep run_id, sessions+1, started_at=now, session_open=true, wall_clock_s_prior carried through unchanged; added session_id/session_open to fresh markers too and wired --session into mark()
- flag: none

## 8. navigator — 2026-10-06T11:18:10.037Z
- review of increment N-1: OK — mark continuation across sessions matches ARCH-4 (new session keeps run_id, sessions+1, started_at reset, session reopened, prior carried through unfolded; same-session re-prompt is a no-op). run-report.test.sh green.
- tests added: report finalises a session — folds (end − start) into wall_clock_s_prior and closes session_open in the marker; a later rebuild of a closed session reports the banked prior ALONE (no double count). Targets AC3. Red for the right reason: fold not persisted (marker stays 100/true), rebuild double-counts 1900.
- steer: the fold MUST live in `report` (SessionEnd spawns report detached under a 1.5s budget — no room for a separate step). Fold only an OPEN complete marker; closed → prior alone, no re-fold, no marker growth. This is the base supersession's rebuild relies on — build it before (C).

## 9. driver — 2026-10-06T11:36:12.807Z
- made green: report folds an open session's clock into wall_clock_s_prior and closes session_open; closed session rebuild uses banked prior alone
- approach: readMarker now parses session_open (absent/true = open); buildRun branches on it; new banksSession() in the report CLI path persists the fold/close back to run-state.json after validate
- flag: none
