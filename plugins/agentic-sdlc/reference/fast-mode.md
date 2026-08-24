# FAST mode — the orchestrator's lean lane

Read by `/plan` and `/build` **only when `--fast` is present in the arguments**.
Kept out of both command bodies because a command body is re-sent on every internal
tool-call round trip, and a deliberate run must not pay for a lane it never takes.

**This file is the protocol. The stubs in `commands/plan.md` and
`commands/build.md` are reminders, not substitutes — do not improvise from them.**

---

## WHAT FAST MODE TRADES

Direct requirements, one observable check per task, decide-and-log instead of
stop-and-handoff, only the tests that would catch an expensive bug — and every
shortcut on one line in `docs/TOOLING-DEBT.md`.

It is the right lane for prototypes, spikes, internal tools, and anything you would
be content to rewrite. It is the wrong lane for a persisted data model, a contract
another team consumes, or anything touching money, auth or PII — those hit the
one-way-door list and get the architect anyway.

The flag is per command. `/plan --fast` then `/build --fast` is the common path, but
`/build EPIC-3 --fast` builds a deliberately-planned epic the lean way, and a
`FAST-<n>` task list can be built without the flag if it turns out to deserve the
full cascade.

**Model tiering:** planner Sonnet 5, coder Sonnet 5 — unchanged, both already the
cost floor. The architect stays on Fable 5 but fires **zero times in the common
case** and at most once per run. The navigator (Opus 4.8, every other turn in a PAIR
story) is not used at all. That last one is the largest single saving in the mode.

---

## `/plan --fast`

**One planner invocation. No architect pass by default.**

```
Agent(subagent_type: "agentic-sdlc:planner", prompt: "MODE: FAST. Decompose this
into a flat task list and write backlog/FAST-<n>.md. One `done when` per task, not
Gherkin criteria. Do NOT raise ARCH handoffs — tag anything on the one-way-door
list inline as `⚠ one-way: <what>` and keep going.")
```

Inline the brief into that prompt, **and inline this format with it** — the
planner's own prompt carries only a stub, so the shape has to come from here:

```markdown
# FAST-<n>: <title>

- Outcome: <what is true after this that isn't now>
- Status: TODO

## Tasks

### T<n>-1: <imperative title>   [S|M]
- files: <paths this task owns>
- done when: <one observable check>
- notes: <only if genuinely non-obvious — usually omit>
- ⚠ one-way: <only if this hits the five below>
```

**~40 lines, `## Tasks` inside the first 10.** One `done when` per task — it is
still the acceptance criterion, one observable check falsifiable by one test, just
stated directly. No personas, no `Technical notes`, no `Out of scope`. Nothing
larger than M. Tasks run in listed order and that order is the dependency.

The five that earn a `⚠ one-way` tag: a persisted data model holding real data · a
published API or event contract · an auth, permission or tenancy boundary · money
or PII · a dependency expensive to leave. Untagged is the expected case.

Then, **only if the file contains at least one `⚠ one-way` tag**, one batched
architect invocation:

```
Agent(subagent_type: "agentic-sdlc:architect", prompt: "Resolve every `⚠ one-way`
tag in backlog/FAST-<n>.md. Read the codebase first. DECIDE — one paragraph each,
written in place. ADR only if genuinely irreversible. Log any deliberate shortcut
to docs/TOOLING-DEBT.md.")
```

No tags → **no architect invocation at all.** That is the expected case.

Report, non-blocking, same as the deliberate lane: tasks, any one-way items and how
they were resolved, new debt. If you say nothing, `/build --fast` proceeds.

| FAST-n | Tasks | One-way items | Status |
|--------|-------|---------------|--------|

---

## `/build --fast`

### Preconditions

- `backlog/FAST-<n>.md` (or an `EPIC-<n>.md`) exists with tasks
- Nothing else. There is no ARCH-open gate — fast mode defers rather than blocks.

### 1. One branch. No worktrees, no waves, no merge-back.

```bash
git checkout -b feat/FAST-<n> origin/main
```

The worktree cascade, the `depends_on` wave sort and the `--no-ff` merge-backs in
`BRANCH TOPOLOGY` exist to make **parallel** stories safe. Fast mode is sequential,
so it needs none of it and should not pay for it. Tasks run in listed order.

If a run genuinely needs parallel tasks, that is a signal it wants the deliberate
lane — drop the flag rather than reintroducing the cascade here.

### 2. One coder invocation per task — batched where the files overlap

```
Agent(subagent_type: "agentic-sdlc:coder", prompt: "MODE: FAST. Implement <TASK-ID>
on branch feat/FAST-<n>. <task title>. Files: <paths>. Done when: <the check>.
<binding one-way resolutions, verbatim>. Test the `done when`, and the NEGATIVE case
on any risk surface this task touches. Commit; do NOT open a PR; do NOT run the full
gate — I run it once at the end.")
```

**Inline the task** — its `done when` verbatim, the resolved one-way decisions that
bind it, and the exact file paths. Never write "read T1-2 in backlog/FAST-1.md": a
coder sent to the file reads the whole thing, and every coder in the run reads it
again.

**Batch adjacent tasks that share a file surface.** Two or three consecutive tasks
touching the same module go in one invocation with both `done when` lines. Spawn
overhead is a system prompt plus re-orientation in the codebase, paid per
invocation; after dropping the navigator, batching is the cheapest saving left.
Do not batch across unrelated modules — a confused coder costs more than a spawn.

### 3. Deferred one-way items — collect, do not stall

A coder reporting `DEFERRED` with a `⚠ one-way` line does not stop the run. Keep
going through the remaining tasks, then **once**, at the end:

```
Agent(subagent_type: "agentic-sdlc:architect", prompt: "Resolve every `⚠ one-way`
item in backlog/FAST-<n>.md — coders deferred these and are waiting. Read the
codebase, decide, one paragraph each written in place.")
```

Then re-dispatch **only** the deferred tasks, with the resolutions inlined.

**Max one re-dispatch round.** A second means the brief is wrong, not the tasks —
escalate to the human rather than grinding.

### 4. Gate once, then one PR

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # or the project's claim
git merge origin/main   # resolve, re-run the gate
git push -u origin feat/FAST-<n>
```

Open **one** PR for the run. The body **must** stamp:

```markdown
Mode: FAST
```

That stamp is load-bearing: the review routine reads it and judges the ledger
against the fast floor instead of the deliberate one. Without it, every skipped
unit test comes back as a review finding and the mode costs more than the lane it
replaced.

Then stop. **The human still owns the merge** — nothing here merges its own PR.

### 5. Record the run in the ledger

One line, so a reader of `docs/TOOLING-DEBT.md` knows why the rows are there:

```markdown
_Run: FAST-<n>, <date>, tasks T<n>-1..T<n>-<k> — built in fast mode._
```

Individual product shortcuts are rows the coders add themselves.

---

## REPORT

| TASK-ID | Status | Commit | Deferred one-way |
|---------|--------|--------|------------------|

Plus: the PR number, and every debt row logged this run — list them, do not
summarise the count. The ledger is the price of the speed; hiding it defeats the
trade.

---

## HARD RULES

- **Force SOLO for every task.** No navigator, no pair log, no
  `reference/pair-loop.md` — never read it in a fast run.
- **Never open more than one PR per run**, and never merge it.
- **Never run the full gate per task.** Once, before pushing.
- **Never worktree, never wave-sort, never `--no-ff` merge-back** in this lane.
- **Never let a deferred one-way item stall the remaining tasks.**
- **One re-dispatch round, then escalate to the human.**
- **The PR body must stamp `Mode: FAST`.**
- **Never accept a task as done when it touched a risk surface — auth or tenancy,
  money, destructive or migrating data, an external contract — and the coder's
  report shows only a happy-path test.** Send it back for the negative case, or make
  it a ledger row. That floor is what the review routine relaxes everything else
  against; if it is hollow, `Mode: FAST` stops being a safe stamp.
- Everything the deliberate lane says about **not squashing inside an epic** is moot
  here — a fast run is one branch and one PR, squash-merged like any single-story
  branch. If the run touched more than one release-please package scope, merge-commit
  it instead so each scope keeps its own commit.

---

## COST

Projected, from the structure rather than a measured run: the deliberate lane's
worked example — one epic, five stories, two of them PAIR at ten alternations —
costs **~52 agent spawns**, of which the PAIR alternations are roughly 80%. The
same work in fast mode is one planner, ~4 batched coders, and zero-to-one
architect: **~6 spawns**, none of them on the escalation tier.

**This number is unverified.** Count the spawns on the first real fast run and
replace this paragraph with the measured figure, per the convention that every
number in these prompts carries its provenance.
