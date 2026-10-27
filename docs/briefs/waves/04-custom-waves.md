# Feature: custom waves, so the maintainer can pick the bucket, park the rest, and let tick restart idle waves

## Problem

Automatic selection takes every eligible brief that doesn't conflict. That
is usually right, and wrong in cases the proven wave skill hit within its
first five waves:

- **A themed release.** The maintainer wants exactly briefs #10–#14,
  including #13, which depends on #12, and none of the other eligible
  briefs.
- **An urgent brief while a wave runs.** Only one wave can be active, so
  today the maintainer waits for the wave to close or hand-edits labels on
  every brief.
- **A dependency chain inside one bucket.** Selection rejects #13 because
  #12 hasn't merged yet, though #12 is in the same bucket and merges first.
- **Nothing restarts an idle backlog.** Tick with no active wave says so and
  stops (`reference/wave.md` tick). When a wave closes on "cannot continue",
  because a dependency PR was still awaiting merge, no wave opens after
  that merge unless a separate start routine fires. The proven skill's tick
  runs `start` when no wave is active, which is why its start routine stays
  disabled.

In production, every wave since `start --briefs`, `wave:queued` and `pause`
were added has been opened that way.

## Users

- **The maintainer.** They decide what ships together and when to change
  course.
- **The tick routine (03),** which should be the only routine that opens
  waves.

## Outcome

- `/agentic-sdlc:wave start --briefs 10,11,12,13` opens a wave of exactly
  those briefs, in the given order. #13 waits as `wave:queued` until #12
  closes as completed, then starts by itself.
- `/agentic-sdlc:wave pause` shelves the active wave without losing anything,
  so a custom wave can replace it.
- `tick` with no active and no paused wave runs `start`. With a paused wave
  it reports that and stops.
- The board shows each brief's review round, what it is waiting on, and
  which briefs outside the wave are waiting on it.

## Success metric

Hand-edited `wave:*`/`phase:*` labels per wave: **≈ 4–8 in production
before custom waves → 0**. Also, waves that opened only because a start
routine fired: **→ 0** (tick opens them).

## Scope — in

- **`start --briefs <n>,<n>,…`:**
  - **Gate:** `wave:active` refuses.
  - **Validate.** Every listed Issue is open, labelled `brief`, parses, and
    isn't held (06). Every `Depends on` is closed as completed or is in the
    bucket. No two chosen briefs conflict, checked in both directions as
    today. Otherwise stop, naming the Issue or the pair.
  - **Open** in the given order, with no priority sort. A chosen brief loses
    any other `wave:<n>` and its `phase:*` (06's strip). If a `wave:paused`
    epic exists, close it as not planned with a link to the new wave.
  - A brief whose dependencies are met gets its starting phase. Any other
    brief gets `wave:queued` and **no** phase label.
- **`wave:queued` as tick rule 0**, ahead of every merged rule:
  - while any `Depends on` is still open, leave the brief untouched;
  - if a dependency closes as anything other than completed, `blocked`,
    notified once;
  - once every dependency is closed as completed, remove `wave:queued` and
    classify as usual. That dispatches the worker.
- **`pause`:**
  - refuse while any brief holds a fresh lock or has an open PR;
  - move the epic from `wave:active` to `wave:paused`;
  - return every open brief to the pool unless the maintainer names it to
    keep;
  - comment where each brief went, and leave the epic open.
- **Idle tick → start.** With no `wave:active`: if a `wave:paused` epic
  exists, report it and stop. Otherwise run `start`. Plain `start` gets the
  same paused gate. Only `start --briefs` retires a paused wave.
- **The board** (`wave-board.mjs`):
  - gains `Round` (from `round-state.mjs`, `—` without a PR) and
    `Waiting on` (`#d` for queued; the lock, partof or `hold` reason for
    blocked; "merge #p" for awaiting-merge);
  - gains a `Blocks:` line listing the open briefs outside the wave whose
    `Depends on` names a brief in it;
  - shows queued briefs as `queued`;
  - stays numbers, phases and timings only.

## Scope — out

- **Planned waves** (`plan --wave`, `wave:planned:<N>`). That's 07.
- **More than one active wave.**
- **Adding briefs to a running wave.** Pause it and start a new one.
- **Inferring the bucket.** That's selection's job, or 03's `/conflicts`.

## Value dependency

`start --briefs` and `wave:queued` are useful alone. `pause` is useful only
with `start --briefs`. Idle start is useful alone, but needs the paused
gate as soon as `pause` exists. All four share the gate and the label strip,
so they ship as one PR. The board fields are small and are what makes
`queued` readable.

## Technical context

- **Existing systems:**
  - `wave-select.mjs`: `--briefs` skips the ranking but reuses `conflicts()`
    and `delivered()`.
  - `wave-classify.mjs`: rule 0 goes in front.
  - `wave-tick.mjs` and `wave-board.mjs`.
  - `reference/wave.md` start, tick, status.
  - 06's label strip, `refused` list and `held` flag.
- **Reference:** the proven wave skill's "Custom wave", `pause`, idle tick
  and board sections. That skill isn't in this repo. Every rule planning
  needs is stated above.
- **Hard constraints:**
  - `commands/wave.md` gains only the new argument names. The protocol goes
    in `reference/wave.md`.
  - REST only. Pure scripts with tests in their existing `.test.sh`.
- **Deployment:** `feat:`.
- **Expected shape:** one epic of about 15 points: `--briefs` with queued
  (M), pause with the paused gate and idle start (M), board fields (M).

## Constraints

- **Data / compliance:** the board and comments carry only Issue and PR
  numbers, phases and timings.

## Open questions

- **`pause` with an open PR.** Production refuses, which is simple but
  sometimes forces the maintainer to wait. Allow it when the brief is kept
  for the next bucket?
- **Idle start cost.** An hourly tick with no wave now runs selection every
  hour. Selection is one paginated Issues call, so that's fine. Confirm that
  `cannot continue` is reported once per state, not every hour (reuse the
  `wave-stall` marker pattern on a pinned Issue, or say nothing when the
  blockers haven't changed).
