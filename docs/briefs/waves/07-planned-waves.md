# Feature: planned waves, so the next wave is the one the maintainer chose

## Problem

Under autopilot (03), tick opens the next wave the moment the current one
closes (04's idle start, and the existing close path). Automatic selection
then picks that wave, not the maintainer. A maintainer who knows today what
wave 7 should be, while wave 6 is still running, has no way to say so short
of waiting for the close and racing the routine with `start --briefs`.

The proven wave skill added planned waves for this. Its daily triage now
reserves the next buckets ahead of time, and tick opens them exactly.

## Users

- **The maintainer,** planning one or more waves ahead.
- **A triage routine** (08, or a project's own) that writes buckets for the
  maintainer to edit.

## Outcome

`/agentic-sdlc:wave plan --wave 7 --briefs 20,21,22` reserves exactly those
briefs. When wave 6 closes, tick's `start` opens them and nothing else.
`status` lists every planned bucket, lowest first, with what each brief is
waiting on.

## Success metric

Waves opened by autopilot that weren't the bucket the maintainer had chosen
→ **0**, measured over the first five autopilot waves after this ships.

## Scope — in

- **`plan --wave <N> --briefs <n>,…`.** It only writes `wave:planned:<N>`.
  It never opens a wave or adds a phase label.
  - **Validate** (stop on the first failure):
    - N is above every existing `wave:<n>`;
    - each brief is open, labelled `brief`, parses, and carries no
      `wave:<n>`;
    - no conflict inside the list;
    - every `Depends on` is closed as completed, in the active wave, in a
      lower planned bucket, or in the list.
  - **Write.** A brief that is already in another bucket moves. Rerunning
    for the same N replaces the bucket.
  - `plan --wave <N> --clear` empties the bucket.
- **`start` step 1b.** Before automatic selection: if any open brief carries
  `wave:planned:<k>`, open the lowest k exactly, as a custom wave (04) in
  Issue-number order, with no ranking and no topping up.
  - A brief that waits on an open dependency **outside** the bucket is
    dropped back to the pool with a notice: "Brief #n dropped from planned
    wave k: waiting on #d". A dependency inside the bucket is `wave:queued`
    as usual.
  - A held brief (06) is dropped the same way, with the reason `held`.
  - If every brief would drop, change nothing, notify "planned wave k cannot
    start" with what each brief waits on, and stop.
  - A conflict inside the bucket stops, and the plan needs fixing.
  - The opened wave still takes N = highest `wave:<n>` + 1, and its planned
    labels come off.
- `start --briefs` removes `wave:planned:<k>` from the briefs it takes.
- **`status`** lists the planned buckets and says the lowest is what `start`
  would open.
- **Hard rule:** never select automatically while a planned bucket exists.

## Scope — out

- Filling buckets automatically. That is 08.
- Opening several planned buckets at once. The next one waits for the
  current wave to close.
- Any change to plan ids. A brief in a bucket isn't planned yet, so `plan
  --id` is unaffected. Say so in the reference.

## Value dependency

It is useful the moment a maintainer plans one wave ahead. It reuses 04's
custom-wave open path, so it can't ship before 04.

## Technical context

- **Existing systems:** 04's `--briefs` path and `wave:queued`,
  `wave-select.mjs`, `reference/wave.md`, and 06's label strip.
- **Reference:** the proven wave skill's "Planned wave", `start` 1b,
  `plan --wave`, `status` and hard rules. That skill isn't in this repo.
  Every rule planning needs is stated above.
- **Hard constraints:**
  - **`wave:planned:<N>` is never a `wave:<n>` label.** Every reader that
    takes "highest `wave:<n>`" or matches `wave:<digits>` must skip it, with
    a test in `wave-select` and in the tick payload.
  - REST only, pure scripts, `commands/wave.md` gains only the argument
    names.
- **Deployment:** `feat:`.
- **Expected shape:** about 10 points: `plan` validate and write (M), start
  1b with status (M).

## Constraints

- **Data / compliance:** notices carry only Issue numbers.

## Open questions

- **A label per bucket** (`wave:planned:7`) means a label per future wave
  number. Fine at the scale production ran. Confirm, or delete the label
  once its bucket is empty.
