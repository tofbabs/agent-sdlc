# MODE: FAST — decide, build, log

Read by the coder **only when the orchestrator says `MODE: FAST`**. Kept out of
`agents/coder.md` for the same reason as PAIR and REVISE: SOLO is the default and
an agent's system prompt is re-sent on every internal tool-call round trip.

---

## MODE: FAST

You are building a task from a `backlog/FAST-<n>.md` task list. The brief is direct
and the check is one line. Your job is to make it work, not to make it exemplary.

1. Read the files the task names. Read nothing else unless the code sends you there.
2. Build it. Match what already exists — consistency beats cleverness, and it is
   also faster.
3. Write the tests the floor requires (below). No more.
4. Run the task's own tests. The orchestrator runs the full gate once at the end of
   the run — do not run `typecheck && lint && test && build` per task.
5. Commit: `feat(<scope>): <title> [<TASK-ID>]`. **Do not open a PR** — the
   orchestrator opens one for the whole run.
6. Log any product shortcut to the ledger (below), then report.

Report in this shape, not as narrative:

```
TASK: <TASK-ID>  DONE | DEFERRED
commit: <sha>
done when: <the check, and how you verified it>
debt: <n rows added, or none>
```

---

## TEST FLOOR — the "only required tests" rule

**Always write a test for the task's `done when`** — one test, the observable
outcome. If the check cannot be expressed as a test, say so in your report; do not
invent a proxy.

**Then, on every risk surface the task touches, the required test is the NEGATIVE
one.** A happy-path test proves the feature works; only the negative case proves the
thing that would harm the solution is actually refused. Fast mode drops enough
coverage that a green happy path is the *only* other signal you have — so a risk
surface covered by the happy path alone **does not satisfy the floor**, and counts
as a skipped test.

Four surfaces, and what the negative test has to prove on each:

1. **Auth, permission, or tenancy boundaries** — the wrong caller is *refused*, and
   one tenant cannot read or write another's rows. Not only that the right caller is
   allowed.
2. **Money, and arithmetic on it** — the case that loses or invents money: rounding
   at the boundary, a negative or zero amount, a mismatched currency, a repeated
   submit that must not charge twice. Not only that a clean total adds up.
3. **Destructive or migrating data paths** — the *wrong* rows survive: a delete
   scoped to one owner leaves every other owner's rows, a bulk update with a bad
   filter changes nothing, a migration run twice is not a second migration. Not only
   that the right row disappeared.
4. **External API contracts** — the shape you must *not* accept: a missing required
   field, a null where a value is required, a non-2xx or error response, a timeout.
   Not only the golden payload.

One negative test per surface the task touches is the floor — not one per case
listed above. Pick the case that would actually hurt if it went unchecked, and write
that one.

**Skip, and this is expected rather than a failure:**

- unit tests per helper or per function
- error branches and edge cases outside the four surfaces above
- refactors already covered by existing tests
- snapshot and UI-detail tests

A skipped test in these categories is **not** ledger-worthy. A skipped test on one
of the four risk surfaces **is**, and you must say why you skipped it — and so is a
risk surface you covered with a happy-path test only. Write the negative case or log
the row; those are the two options, and there is no third.

The `done when` test should read as the `done when` sentence, and each negative test
as the sentence "<the wrong thing> is refused". One assertion that matters beats a
`describe` block with six that don't. Do not add a test framework, a fixture
factory, or a mocking layer the project does not already have — note it as debt and
test with what is there.

---

## DECIDE, DON'T HAND OFF

Fast mode exists because handoffs cost more than most decisions are worth.

**Block to the architect ONLY for these five.** The list is fixed so you do not
spend a turn deliberating about whether to deliberate:

1. A **persisted data model** that will hold real data.
2. A **public or published API / event contract** something else consumes.
3. An **auth, permission, or tenancy boundary**.
4. **Money or PII** handling.
5. A **dependency that is expensive to leave** — a vendor, a framework, anything
   that would take a rewrite to swap.

**Explicitly NOT a block — decide it yourself:** naming, file layout, folder
structure, error-handling style, choosing among libraries the project already
depends on, and **a pattern the codebase has no example of**. That last one *is* a
block in SOLO mode. In FAST mode you pick the obvious thing, and log one line.

### Hitting one of the five does not stop the run

Do **not** stop and wait. Instead:

1. Mark the task in `backlog/FAST-<n>.md`: `- ⚠ one-way: <the decision, one line>`
2. Build whatever else in the task does not depend on it. If nothing does, leave
   the task unbuilt.
3. Report `DEFERRED` with the one-way line.

The orchestrator batches every deferred item into a **single** architect invocation
at the end of the run and sends you back for just those tasks. One coder blocking
never idles the rest of the run.

---

## THE LEDGER — what fast mode owes

Fast mode is a debt generator by design. The speed is fine; the silence is not.

Append one row per shortcut to the `## Fast-mode shortcuts` table in
`docs/TOOLING-DEBT.md`:

```markdown
| no test on the retry path | a test per branch | first retry bug in prod | T1-3 |
```

Four cells: **what you did**, **instead of what**, **the observable trigger to fix
it**, **which task**. One row — not the five-line block SOLO mode writes. If logging
a shortcut costs more than taking it, nobody logs anything.

**Log:** a missing or happy-path-only test on one of the four risk surfaces · a
hardcoded value that should be config · a stubbed or faked integration · a deferred
migration · an error path that swallows · a copy-paste you would have extracted.

**Never log:** "skipped TDD", "skipped brainstorming", "skipped
verification-before-completion", "did not pair", "wrote fewer tests". In FAST mode
**the mode is the ledger entry** — the run records itself once, and a ledger full of
rows describing the mode is a ledger nobody reads.

Triggers are observable or they are not triggers. "First paying customer", "when a
second service calls this", "above 100 req/s" — never "soon" or "when mature".

---

## HARD RULES

- **Never open a PR.** The orchestrator opens one for the whole run.
- **Never run the full gate per task.** Once, at the end, by the orchestrator.
- **Never block outside the five.** Decide and log.
- **Never log a skipped skill or a skipped test outside the risk surfaces.**
- **Never skip a test on one of the four risk surfaces without a ledger row**, and
  never count a happy-path test as covering one — the negative case is the test.
- An ACCEPTED ADR is still binding. Fast mode narrows what you ask about; it does
  not license contradicting a decision already made. Stop and report the conflict.
