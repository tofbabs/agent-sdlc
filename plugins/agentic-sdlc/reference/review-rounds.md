How a review round is gated, written, read and posted. `/review` loads it on demand; `code-reviewer` writes rounds and the coder's REVISE mode reads them.

## CI gate

`scripts/ci-state.mjs` reads the head's REST check-runs payload and prints one
JSON line: `{"state":"green|pending|red|none","failing":[...],"pending":[...]}`.

- **pending** (any run not `completed`): report "waiting on CI". Post no round,
  spawn nothing, create no worktree.
- **red** (any `completed` run concluding `failure`, `timed_out`, `cancelled`,
  `action_required` or `startup_failure`): report "CI red: <failing jobs>".
  Post nothing. Red wins over pending, since a failed job already decides it.
- **green** (all completed; `success`, `neutral` and `skipped` are not
  failures): proceed to step 2. Pass `CI: green` to the reviewer.
- **none** (zero checks reported): assume green, proceed, and pass
  `CI: none reported (assumed green)` so the reviewer notes it.

The command does not poll or retry; the next invocation re-reads CI.

## Round comment contract

```markdown
## Review — round <k>
- verdict: REQUEST_CHANGES | APPROVE
- reviewed sha: <the head sha you reviewed>

- F1: <SEVERITY> [<finding_category>] <BLOCKING|NON-BLOCKING> — <issue> — <required fix>
- F2: <SEVERITY> [<finding_category>] <BLOCKING|NON-BLOCKING> RESOLVED — <issue> — <how it was closed>
```

- **Finding line**: `F<n>: <SEVERITY> [<finding_category>] <BLOCKING|NON-BLOCKING>` — the tag sits after the category.
- **Round number** `k`: the orchestrator passes it; it is the highest prior `## Review — round <k>` on the PR, any author.
- **IDs are stable across rounds.** An unfixed `F2` stays `F2`; never renumber. New findings continue the numbering.
- **RESOLVED**: a finding closed this round (`FIXED` confirmed, or a `DISPUTED` accepted) is re-listed under its ID with `RESOLVED` after the tag. It no longer counts as open.
- **Untagged** (legacy) finding lines read as `BLOCKING`.
- **Verdict**: `REQUEST_CHANGES` if and only if an open `BLOCKING` finding exists; otherwise `APPROVE`. `NON-BLOCKING` findings are advisory and never revised. Add "Ready for human merge" to an `APPROVE` body.
- On a re-review, rule on every ID in the coder's `## Response — round k`.

## Posting

Inline comments first, only where a finding has a specific line (about 5):

```bash
gh api repos/{owner}/{repo}/pulls/<n>/comments -f body=... -f commit_id=... -f path=... -F line=N -f side=RIGHT
```

Then the round comment as the GitHub verdict:

```bash
gh api repos/{owner}/{repo}/pulls/<n>/reviews -f event=<REQUEST_CHANGES|APPROVE> -f body="<the round comment>"
```

On HTTP 422 (the reviewing identity authored the PR), post the identical body with `event=COMMENT` and say so in the report. A PR author's own review is stored as `COMMENTED`, so the **comment body is authoritative** for verdict and reviewed sha; the review state is only a fallback (`scripts/round-state.mjs` implements this).

If the head sha moved or the reviewer hit a blocker and "needs a human", it posts nothing; no comment, no verdict.

## Round cap

The cap is `review.round_cap` (default 3). When the rounds posted equal the cap and the last verdict is `REQUEST_CHANGES`, `/review` reports "needs a human" and posts nothing; it refuses before the reviewer is spawned, so the comment carries no cap token. A cap of 2 refuses the third round. `/build` REVISE stops at the same cap.
