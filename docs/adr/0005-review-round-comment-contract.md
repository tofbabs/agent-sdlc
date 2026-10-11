# 0005. Review round-comment contract v2: blocking tags, body verdict, round cap

- Status: ACCEPTED
- Date: 2026-10-09
- Reversibility: ONE-WAY. Round comments are permanent PR history, and
  `run-report.mjs` and `/review`'s round counting read them across releases. A
  shape published once has to be parseable from then on.
- Resolves: ARCH-4 of `backlog/EPIC-7.md`
- Works within: ADR-0001 (finding-line prefix, `verdict` and `severity`
  vocabularies, schema 1). Nothing in ADR-0001 changes.

## Context

The round comment the code-reviewer posts today (`agents/code-reviewer.md`
OUTPUT) already carries `- verdict:` and `- reviewed sha:` lines. Each finding
line is `F<n>: <SEVERITY> [<finding_category>] — …`, the prefix ADR-0001 fixed.
Every finding is treated as blocking. REVISE addresses all of them, and APPROVE
requires zero. Brief `waves/01` wants three things: findings tagged BLOCKING or
NON-BLOCKING, the verdict read from the body instead of GitHub review state
(GitHub stores a PR author's own review as COMMENTED), and a configurable
round cap that ends in "needs a human".

These read the comment: `run-report.mjs` (`FINDING_LINE`, `roundVerdict`, which
prefers GitHub state today), `commands/review.md` (round `k`, reviewed sha, the
guard), `reference/coder-revise-mode.md` (verdict, F-ids), and
`commands/build.md` REVISE. `outcomes.mjs` doesn't parse the comment, because it
only receives `--findings N`. `templates/routines/review-prompt.md` only invokes
`/review` and echoes its one-line result. The only parsers are inside the
plugin.

## Options

- **A: Derive blocking from severity** (BLOCKER/MAJOR block, MINOR doesn't).
  This adds no new token. But the brief asks for a tag *and* a severity, and a
  MAJOR maintainability note on a correct PR is exactly what shouldn't cost a
  round.
- **B: Put the tag first**, as in `F1: BLOCKING MAJOR [cat] — …`. This reads
  well, but it breaks ADR-0001's prefix. `FINDING_LINE` would read `BLOCKING`
  as the severity and drop the finding silently, in this release and in any
  older reader of the same PR.
- **C: Put the tag after the category**, as in `F1: MAJOR [cat] BLOCKING — …`.
  It keeps ADR-0001's prefix byte for byte, so every existing parser still
  reads severity and category. The tag is one closed token in a fixed slot.

## Decision

**C.** The round comment contract, as of this ADR:

```markdown
## Review — round <k>
- verdict: REQUEST_CHANGES | APPROVE
- reviewed sha: <full 40-hex head sha reviewed>

- F1: <SEVERITY> [<finding_category>] BLOCKING — <issue> — <required fix>
- F2: <SEVERITY> [<finding_category>] NON-BLOCKING — <issue> — <suggestion>
- F3: <SEVERITY> [<finding_category>] BLOCKING RESOLVED — <one-line ruling>
```

1. **Tag.** The token after `]` is exactly `BLOCKING` or `NON-BLOCKING`.
   **A finding line with no tag reads as BLOCKING.** Every round posted before
   this ADR was blocking in effect, so in-flight PRs keep their meaning.
2. **Status.** An optional `RESOLVED` after the tag means a later round
   accepted the fix or the dispute. A finding with no `RESOLVED` is open.
   Rounds 2 and up re-list every earlier finding by its stable ID with its
   ruling. Readers count only open findings. `run-report.mjs` skips
   `RESOLVED` lines, so a fixed finding isn't counted again as a finding of
   the later round.
3. **Verdict rule.** `verdict: REQUEST_CHANGES` if and only if at least one
   finding is open and BLOCKING. Otherwise the verdict is `APPROVE`, with
   any open NON-BLOCKING findings listed as advisory. REVISE never acts on
   them. The verdict vocabulary is unchanged: only `APPROVE` or
   `REQUEST_CHANGES` appears in a body.
4. **The body is the record.** Every reader takes the verdict and reviewed sha
   from the body lines. GitHub review state is used only for a body that has
   no `- verdict:` line, which means legacy or hand-written. The reviewer still
   posts the GitHub review event (APPROVE or REQUEST_CHANGES, falling back to
   COMMENT on a 422), but that is a signal for humans, not data.
   `run-report.mjs`'s `roundVerdict` flips to reading the body first.
5. **Round cap.** The cap comes from `review.round_cap` (ADR-0006, default 3).
   It replaces both the hardcoded `k ≥ 4` in `review.md` and the "round cap
   reached" line in `code-reviewer.md`. When round `k` = cap and its verdict is
   REQUEST_CHANGES, `/review` reports **"needs a human"** and posts **nothing**.
   The cap adds no token to any comment, so no parser has to learn it.
   REVISE uses the same cap. `/build` doesn't start a revise round whose
   re-review would be refused (round `k` ≥ cap), and
   `coder-revise-mode.md`'s "Max 3" becomes "the configured cap".
6. **Rounds 2 and up only re-check.** A new finding (a new F-id) is allowed only
   if it is BLOCKING and about security, data loss or a broken contract.
   Anything else noticed late goes nowhere. This is a reviewer rule, not a
   parser rule, so the contract above doesn't change.

**Release signal: `feat:`, not `feat!:`.** A consuming project doesn't have to
do anything:

- The `verdict:` and `reviewed sha:` lines already exist.
- The tag sits after ADR-0001's prefix, and an untagged line keeps its old
  meaning.
- The verdict vocabulary and the run-report schema are unchanged.
- "needs a human" posts nothing.
- `.claude/agentic-sdlc.json` is optional.
- Every parser ships in the same plugin release.
- The copied routine template still works unchanged, because it delegates to
  `/review`.

The PR body must still list the **behaviour changes** under a "Behaviour
changes" heading:

- the cap drops from 4 rounds to 3 by default
- APPROVE can carry advisory NON-BLOCKING findings
- `/review` skips red or pending CI
- the reviewer model is always passed

## Consequences

- Becomes easy: a clean round 1 ends review. Self-authored PRs read as
  approved, and wave workers can parse the verdict with no GitHub review state
  at all.
- Becomes easy: old comments and old readers keep working, because nothing
  in the shape is removed or reordered.
- Becomes hard: adding any further token to a finding line. The slot after
  `]` now holds `<TAG>[ RESOLVED]`. Anything else needs a superseding ADR.
- Becomes hard: a reviewer that wants to raise a late, non-critical finding.
  By design, it can't.
- `run-report`'s schema doesn't record blocking versus non-blocking, so 03 can't
  group on it yet. This is logged as debt in EPIC-7.

## Revisit if

- After the next three epics, the median review round count is above 1. That
  means NON-BLOCKING is being under-used or rule 6 is too loose.
- A NON-BLOCKING finding on a merged PR turns out to be the cause of a
  `post_merge_fix` or `post_merge_revert` outcome event.
- `run-report` or the signal routine needs the tag as a report field. That
  is an ADR-0001 schema change, made there.
