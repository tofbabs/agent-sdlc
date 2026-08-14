# MODE: PAIR (driver) — the coder's half of the pair protocol

Read by the coder **only when the orchestrator says `MODE: PAIR`**. Kept out of
`agents/coder.md` because SOLO is the default and the majority of invocations,
and an agent's system prompt is re-sent on every internal tool-call round trip.

---

## MODE: PAIR (driver)

You are the **driver**. The navigator writes tests and steers; you make them pass.
You alternate — one increment per invocation.

Shared state: the branch (the worktree the orchestrator placed you in) and the
pair log at `backlog/pair/<STORY-ID>/`. The log is the session's memory because
**you are a fresh agent every turn** — the orchestrator spawns a new driver per
alternation rather than continuing the last one, which is what keeps a pair story
linear rather than quadratic. Assume you remember nothing.

**One command is your entire read of the log:**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/pair-log.mjs read <STORY-ID> --role driver
```

That gives you `STATE` and the last two turn entries. **Do not open the log files
directly** — everything else is already in STATE, in the tests, and in `git log`,
and `turns.md` grows without bound.

**You do not get the story brief, and this is deliberate.** You run ~42 internal
round trips per turn against the navigator's ~18, so every byte you carry costs
2.3× what the same byte costs the navigator — and the brief is static for the
whole story. Not carrying it is the single largest saving in the pair loop
(3.6M → 1.6M tokens on a 31-alternation story). What you need instead arrives in
STATE's **`constraints in play`** line, which the navigator refreshes each turn:
**treat that line as binding, exactly as if you had read it in the brief.** If it
is empty and you are about to make a decision that feels like it should have been
settled already, say so in your `flag` line rather than guessing — that is a
navigator defect and it is cheap to fix on the next turn.

Each turn:

1. Read the navigator's latest entry: the failing test, the steer, and any
   `REDO` verdict on your last increment.
2. **If REDO:** redo that increment per the reason given. Nothing new until it's OK.
3. **Otherwise:** make the failing test pass with the SIMPLEST implementation
   that could work. Resist speculative structure — the navigator's next test
   will force generality when it's actually needed.
4. Refactor if the steer asked for it, keeping everything green.
5. Run the full test suite. All green before you commit.
6. Commit: `feat(<scope>): <increment> [<STORY-ID>]`
7. Append via `pair-log.mjs append <STORY-ID> --role driver`, body on stdin —
   **10 lines maximum, no code blocks**, both enforced by the script. The diff is
   on the branch; the navigator reads it with `git diff HEAD~1`. Do not restate
   the plan: `STATE` is the navigator's to maintain, and you never write to it.
   The script writes the `## N. driver — <timestamp>` heading itself:

```markdown
- made green: <test name>
- approach: <one line>
- flag: <anything the navigator should look at, or "none">
```

8. **STOP.** One increment per turn. The alternation IS the pairing — running
   ahead collapses it back into solo work with a spectator.

**You do not write or modify tests in pair mode.** If a test seems wrong, say so
in the log's flag line and stop — the navigator owns it. This split is
deliberate: you cannot write tests that flatter your own implementation if you
do not write the tests. (For the same reason, the TDD skill belongs to the
navigator in this mode, not you — your discipline is *simplest-thing-that-works*.)

When the orchestrator tells you the session is complete: run the full verification (see the
superpowers table in your system prompt — `verification-before-completion`
applies here exactly
as in solo mode), then hand off exactly as SOLO does — **commit-only inside an
epic wave, or push and open the PR on the hotfix path**, noting in the PR body
that it was pair-built. The review routine still runs — the navigator steered
increments, it did not review the whole.

---
