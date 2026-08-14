# PAIR LOOP — the navigator ⇄ coder protocol

Read by `/build` **only when a story selects PAIR**. It is kept out of
`commands/build.md` because an all-SOLO run would otherwise carry ~130 lines it
never uses, on every invocation.

---

## PAIR LOOP — navigator ⇄ coder, for one story

Subagents run to completion — they cannot pause mid-story — so **the orchestrator
drives the alternation**. The pairing IS this loop; it is not something the coder
does internally. Shared state is the worktree branch plus
`backlog/pair/<STORY-ID>/`, which is read and written **only** through
`pair-log.mjs` (see PAIR LOG SHAPE).

### Every turn is a FRESH agent. Never `SendMessage`.

**Each step below spawns a new `Agent()`. Do not continue a previous navigator or
driver with `SendMessage`, and do not keep a pair agent alive across turns.** This
is the single most expensive mistake available in this command, and it is the
tempting one — a live partner "remembers the session", which sounds like exactly
what a pair wants.

It is not, because a subagent's context is re-sent on *every internal tool-call
round trip*, not once per turn — 18 of them per navigator turn and 42 per driver
turn, measured. Keep the agent alive and its context climbs with every increment,
so turn *k* costs `round trips × context(k)` and the story costs
**O(alternations²)**. Measured on EPIC-15 STORY-15-1 (16 navigator + 15 driver
turns): driver context 50k → 405k, 139M input tokens for that one agent, ~380M
across the run.

A fresh agent starts at a flat ~60-80k every turn and the story goes linear. The
pair log exists *precisely* to make freshness affordable — it is the session's
memory, so the agent doesn't have to be. Carrying both means paying for memory
twice and letting the more expensive copy be the one that grows.

```
0. Write the story's brief (ACs verbatim + binding constraints) to a temp file,
   then, in the story's worktree:
       node ${CLAUDE_PLUGIN_ROOT}/scripts/pair-log.mjs init <STORY-ID> --brief <tmp>
   That creates backlog/pair/<STORY-ID>/ — brief.md, state.md, turns.md,
   session.json.

1. Agent(subagent_type: "agentic-sdlc:navigator", prompt: "PAIR on <STORY-ID> in <worktree>.
         Get your context with `pair-log.mjs read <STORY-ID> --role navigator` —
         that command IS your read of the log; do not open the files yourself.
         Review the driver's last increment if any. Write the next failing test.
         Steer. Refresh STATE. One test, then stop.")

2. Read the session field — never the log itself, or you accumulate one copy per
   alternation:
       node ${CLAUDE_PLUGIN_ROOT}/scripts/pair-log.mjs status <STORY-ID>
     session=complete  → Agent(subagent_type: "agentic-sdlc:coder", prompt: "MODE: PAIR —
                         <STORY-ID> in <worktree>, session complete. Run full
                         verification, commit the final state. Do NOT open a PR
                         — this is an epic wave.")
                         → story done, back to the wave.
     session=blocked   → Agent(subagent_type: "agentic-sdlc:architect", prompt: "Resolve
                         ARCH-<n> — a pair is blocked and waiting.") → back to 1.
     otherwise         → continue.

3. Agent(subagent_type: "agentic-sdlc:coder", prompt: "MODE: PAIR — driver turn on <STORY-ID>
         in <worktree>. Get your context with `pair-log.mjs read <STORY-ID>
         --role driver`. Make the failing test pass with the simplest thing that
         works, one increment, commit, stop.")

4. → back to 1.

CAP: 20 alternations per story, counted by the script and reported by `status`.
Hitting the cap means the increments are too small or the story is too big —
split the story rather than raising the cap.
```

**`status`, not a grep for `SESSION: COMPLETE`.** The old marker was prose inside
a turn-log entry, so the 10-line truncation clips one written on line 11 —
verified — and the symptom is a pair loop running silently to its cap. The
session is a machine field now, and the two are decoupled.

Do not skip navigator turns to "speed up" — the alternation is the mechanism. A
driver running unreviewed increments is just SOLO mode with a worse name and
double the cost. When the story finishes, its worktree is in the same committed
state a SOLO story would be, and re-joins the cascade at THE LOOP step 4 in
`commands/build.md`.

### PAIR LOG SHAPE

The log has to stay **O(1) to read**, because a fresh agent reads it every turn
and an unboundedly growing log just moves the quadratic out of the agent's context
and into the file. It is a **directory of four files**, and only one of them grows:

| File | Written by | Growth | Read by |
|---|---|---|---|
| `brief.md` | orchestrator, once at `init` | fixed | **navigator only** |
| `state.md` | navigator, overwritten every turn | ≤15 lines | both |
| `turns.md` | `append` only | grows | last 2 entries only |
| `session.json` | the script only | fixed | orchestrator |

**Nothing reads or writes these files directly — `pair-log.mjs` is the whole
surface.** That is not ceremony. Both limits below were prose in the previous
version of this document and neither had ever been exercised by a run; the
script makes them things the tooling cannot do, rather than things an agent is
asked not to do.

**The driver never sees `brief.md`, and there is no flag that shows it one.**
The driver runs 42 internal round trips per turn to the navigator's 18, so a byte
it carries costs 2.3× a byte the navigator carries — and the brief is ~78% of the
read and static for the whole story. Stripping it is the single largest lever
available: 3.6M → 1.6M tokens on STORY-15-1's 31 alternations.

What replaces it is one line in STATE:

```
- ACs met / remaining: <ids>
- constraints in play: <what THIS increment must respect>
- next reds planned: <short list>
- open flag / REDO: <or none>
```

**`constraints in play` is what makes the strip safe.** The binding constraints
do not vanish — the navigator routes the ones this increment must respect into
the one block the driver does read. Because STATE is overwritten rather than
appended, that line costs the same on turn 20 as on turn 2. A driver that
violates a constraint the navigator never routed is a *navigator* defect.

`alternation` is gone from STATE — the script counts it and `status` reports it,
so it cannot drift and STATE gets `constraints in play` at no net cost.

STATE is the continuity mechanism, and it is fixed-size *because it is rewritten,
not appended*. Forward-looking reasoning — the plan, the reds you can see coming,
the traps — belongs there. The turn log records what happened; it is not a place
to restate the plan.

**The 10-line cap is now enforced, not requested.** `append` truncates at 10
lines and strips fenced code blocks outright, warning on stderr. On STORY-15-1
the mean entry ran 2.6KB and 43 lines against a template of ~150 bytes and a
10-line budget — every entry over, in both measured stories. Truncation rather
than rejection is deliberate: a rejected driver retries at 42 round trips.

---
