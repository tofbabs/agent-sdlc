# Feature: tick delivers on a closed Issue, reports red CI, and keeps its labels honest

## Problem

`wave tick` merged in #60 (EPIC-12). Release PR #59 would ship it. It
gets six things wrong that the proven wave skill only found by running waves
in production:

1. **"Delivered" means any merged PR.** `wave-classify.mjs:8` and
   `wave-tick.mjs:33` count `pr.merged` as done.
   - GitHub auto-closes an Issue only on a merge into the default branch. A
     project whose base is `staging` gets a closed wave and an open brief
     Issue still labelled `phase:done`, so the next `start` selects it again.
   - A human who reopens a delivered Issue for more work gets a loop: start
     picks it, tick marks it done at once, the wave closes, and start picks
     it again.
   - A `Part of #n` PR that merges is either invisible or counted as
     delivered.
2. **Red CI is detected and never reported.** The classifier returns
   `ci_failure` and the failing checks (STORY-12-2 AC3 says "so the command
   can post one CI-failure comment"), but nothing posts it. The brief waits in
   `phase:revise` for the 3h stall notice.
3. **The round-cap rule can't fire.** The classifier blocks only when
   `round > review.round_cap`, but `/review` refuses to post a round past the
   cap (`review-rounds.md` "Round cap"). A brief that is still
   REQUEST_CHANGES at the cap sits in `ci` forever, with a stall notice and no
   `blocked`.
4. **A human can't park a brief.** Tick recomputes the phase every run and
   overwrites a hand-set `phase:blocked`. The only lever left is closing the
   Issue as not planned, which misstates the record and makes every
   dependent unreachable.
5. **Re-selected briefs carry stale labels.** `start` labels a brief
   `wave:<N>` and a phase without removing an old `wave:<n>` or
   `phase:done` (`reference/wave.md` start step 5). Item 1 makes this happen
   on every staging-based repo.
6. **Selection hides what it refuses.** An Issue whose header doesn't parse
   is named only when nothing at all is selected. A brief whose `Brief:` path
   isn't on the base yet is selected anyway. Its plan phase then fails twice
   and blocks.

## Users

- **The maintainer** who merges and then trusts the board.
- **Projects whose integration branch isn't the default branch.** That is
  every project with a `staging` base.

## Outcome

- A brief is `done` only when its Issue is closed. Tick closes the Issue
  itself when a `Closes/Fixes/Resolves #n` PR merged after the Issue's latest
  `reopened` event.
- A merged partial PR, or a Closes PR from before a reopen, with no open PR,
  is `blocked` with a record of what landed. It is never silently replanned.
- Red CI produces one comment per head sha that the REVISE loop can act on.
- A brief at the round cap without approval reaches `blocked` once the
  at-cap round's Response is posted.
- A maintainer holds a brief with a `<!-- wave-hold -->` comment, and tick
  keeps it `blocked` until that comment is deleted.
- Every brief `start` refuses is named in `start` and `status` output, with
  its reason.

## Success metric

Briefs selected again after their work merged, on the first consuming
project whose base isn't its default branch: **→ 0** across its first three
plugin-run waves. The proven skill hit this in production; there is no plugin
baseline, because no project runs plugin waves yet. The leading measure is
a regression fixture per numbered problem above, each failing on the code at
`341185f`: **0 → 6**.

## Scope — in

- **Delivery:**
  - The payload adds `reopened_at` (from the Issue events tick already
    fetches) and, per PR, `merged_at` and its closing keyword
    (`closes|fixes|resolves` or `part-of`).
  - Classifier: `done` only when `issue_state == closed`. A qualifying
    Closes merge returns `close_issue: {pr, sha}`, which the command applies
    (close as completed, then post `Landed on <base> via PR #p (commit
    <short>)`), and the brief is `done`. When GitHub already closed the
    Issue (a default-branch base), post nothing.
  - A Part-of merge, or a Closes merge older than the reopen, with no open PR
    → `blocked`. The command posts one `<!-- wave-partof pr=<p> -->` comment
    listing what that PR says is left. A `labeled phase:build` event newer
    than the marker clears the block.
  - `wave-tick.mjs` `isTerminal` follows the same rule.
- **CI failure:** tick posts `<!-- wave-ci sha=<head> -->` plus
  `## CI failed — <short sha>` with the failing check names and log URLs,
  once per head sha. The existing comment is the dedup key, as `wave-stall`
  is.
- **Reachable round cap:** `blocked` when the latest round number equals
  `review.round_cap`, its verdict isn't APPROVE, and its `## Response` is
  posted. So the round at the cap still gets its revise, which is the
  plugin's current intent, and then the brief stops.
- **Human hold, as an explicit marker:**
  - A maintainer holds a brief by commenting `<!-- wave-hold -->` on its
    Issue, optionally followed by a reason. The payload gains `held: true`
    when such a comment exists and its `author_association` is `OWNER`,
    `MEMBER` or `COLLABORATOR`. Anyone else's marker is ignored.
  - Classifier, right after "Issue closed → done": `held` → `blocked`, and
    no other rule runs for that brief. The board's reason is `hold`.
  - Deleting the comment releases the hold. The next tick classifies the
    brief as usual.
  - Tick never posts, edits or deletes a `wave-hold` comment, and never
    keeps a `phase:blocked` label that neither a hold nor its own evidence
    (lock outcome, cap, partof marker) supports. A hand-set label with no
    marker is recomputed, as today.
  - `start` doesn't select a held brief. It goes in `refused` with the
    reason `held`.
- **Start hygiene:**
  - Before labelling a selected brief, `start` removes any other
    `wave:<digits>` label and every `phase:*` label. The pattern must not
    match `wave:planned:<N>` (brief 07).
  - `wave-select.mjs` returns `refused: [{number, reason}]` on every run,
    not only when nothing is selected. `start` and `status` print it.
    Reasons are the parser's named errors, plus `brief-missing-on-base` and
    `held`.
  - The payload gains `brief_exists` per brief, which the command sets by
    checking the `Brief:` path on `origin/<base>`. Only the path form is
    checked. A `Brief: inline` or `Brief: #n` header (github-backlog 02) is
    exempt.
- **Tests:** a fixture per problem above in the existing `.test.sh` files.
  Don't add new ones.

## Scope — out

- **The lock grammar and stale-lock clearing.** They take effect only once
  a worker writes markers, so they ship with EPIC-13 STORY-13-1 and EPIC-14
  STORY-14-4.
- Custom, queued, paused and planned waves (04, 07).
- Making relation lines lenient. The strict parser stays, and only its
  reporting changes.
- A `wave:deferred` label. ARCH-3 stands: close as not planned to abandon,
  hold to wait.

## Value dependency

Each fix stands alone. 1 and 5 together stop delivered work being
re-planned, which is the costly one. Ship them as one `fix:` PR, because
they touch the same classifier, tick and select payloads.

## Technical context

- **Existing systems:** `scripts/wave-classify.mjs`, `wave-tick.mjs`,
  `wave-select.mjs`, `ci-state.mjs`, `round-state.mjs`, `reference/wave.md`
  (start, tick, payload), `reference/review-rounds.md` (round cap).
- **Reference:** the proven wave skill's tick, start and hard rules as of
  2026-10-26. That skill isn't in this repo. Every rule planning needs is
  stated above.
- **Hard constraints:**
  - Pure scripts over payloads. The command makes every `gh api` call.
    REST only.
  - The board and comments carry only numbers, phases, timings and check
    names.
  - `commands/wave.md` doesn't grow (boot-path budget).
- **Deployment:** `fix:`. **Release PR #59 is held until this merges,** so
  no release ever ships `wave tick` with "any merged PR = delivered".
- **Expected shape:** one epic of about 15 points: delivery (M), classifier
  rules (CI comment, cap, hold: M), start hygiene (M).

## Constraints

- **Data / compliance:** the `wave-partof` comment repeats only PR and Issue
  numbers and the PR's own "left to do" lines. It never copies Issue text into
  an agent prompt. A `wave-hold` reason is shown to humans only, never fed to
  an agent.
- **Deadline:** before the next release, which is #59.

## Open questions

None open. Settled while scoping:

- **Hold #59?** Yes, until this merges.
- **How tick tells a human hold from a stale label:** an explicit
  `wave-hold` marker comment from someone with write access.
- **The round cap** blocks once the at-cap round's Response is posted.
- **The `Landed` comment on a default-branch repo:** post nothing.
