# Feature: wave roadmap, which fills the planned buckets ahead of time

> **Parked.** Don't plan or build this until a second consuming project runs
> waves on a backlog of 20 or more open briefs. Until then, 07's hand-written
> buckets are enough. Its brief Issue stays out of the wave pool while
> parked (see the README).

## Problem

07 lets a maintainer reserve the next waves by hand. On a backlog of 20 or
more briefs, choosing buckets that respect dependencies, conflicts and a
sensible size is the same walk every day. The proven wave skill's daily
triage does that walk and caps each planned bucket at 8 briefs, although its
automatic selection is uncapped. The plugin has no cap and no way to plan
more than one wave ahead without a human doing the walk.

## Users

- **The maintainer** who wants to see the next two or three waves and edit
  them, not build them.

## Outcome

`/agentic-sdlc:wave plan --auto [--waves K]` fills planned buckets
`N+1 … N+K` from the pool through 07's `plan --wave`. It never moves a brief
that already has a planned bucket. `status` shows the buckets, plus any
brief file that no Issue tracks.

## Success metric

Planned buckets that `start` opened without a human editing them, on a
backlog of 20 or more briefs: **0 → most**, measured over five waves.
Buckets that failed `plan --wave` validation → **0**.

## Scope — in

- **A pure walk** in a new script with a `.test.sh`:
  - Sort the unplaced pool briefs by priority, then dependents, then Issue
    number (the same sort as `start`).
  - Place each brief in the first bucket where every dependency sits in an
    earlier bucket, in the active wave, or in the same bucket (where it will
    be queued), no `Conflicts with` partner is in that bucket, and the
    bucket holds fewer than `wave.capacity` briefs.
  - A brief that fits nowhere stays in the pool, with the reason.
- **Pins:** a brief that already carries `wave:planned:<k>` stays in
  bucket k and counts toward its capacity. Re-planning a bucket is a human
  `plan --wave <k>` or `--clear`.
- **`wave.capacity`** (default: none, meaning unbounded, which keeps today's
  behaviour). It caps auto-filled buckets only. Automatic `start` with no
  planned bucket is unchanged.
- **Untracked briefs:** `status` lists brief files under the briefs folder
  on `<base>` that no open Issue's `Brief:` line names, excluding READMEs.
- An optional daily routine template that runs `plan --auto` (03's
  templates).

## Scope — out

- **Re-ranking priorities.** The priority labels stay human-set or
  project-set. A project's own ranking policy (deadlines, change caps,
  anti-flap rules) stays in that project.
- Any store other than GitHub labels.
- Creating Issues for untracked briefs. It lists them only.

## Value dependency

It needs 07, because `plan --wave` is its only write. It is useful alone
from the first run. A project that plans by hand loses nothing.

## Technical context

- **Existing systems:** `wave-select.mjs` (sort, `conflicts()`,
  `delivered()`), 07's `plan --wave`, and `config.mjs` (ADR-0006, additive
  key).
- **Reference:** the proven wave skill's triage steps "Fill the buckets" and
  "Reserve the planned buckets". That skill isn't in this repo. Every rule
  planning needs is stated above.
- **Hard constraints:** pure script, REST only, no new
  `commands/` bytes beyond the `--auto` flag.
- **Deployment:** `feat:`.
- **Expected shape:** about 8 points: the walk (M) and the capacity key with
  untracked-brief listing (S).

## Constraints

- **Data / compliance:** output carries Issue numbers and brief paths only.

## Open questions

- **Should auto-placed briefs be re-planned daily?** Production re-plans
  every run and keeps pins in a separate store. With GitHub as the only
  state, the plugin can't tell an auto placement from a human one without a
  marker. This draft treats every placement as a pin. That is simpler, at
  the cost of staleness.
- ~~**Build it at all?**~~ **Parked** behind the trigger at the top of this
  brief.
