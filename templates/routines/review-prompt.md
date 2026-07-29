# Routine prompt: PR review

<!-- Referenced by the review routine. Version-controlled so the review bar
     is diffable and survives routine reconfiguration. -->

Review the open pull request(s) on this repository.

For each open PR without an existing review from you:

1. `gh pr view <n>` and `gh pr diff <n>`
2. `gh pr checks <n>` — if CI exists and is red, that alone is REQUEST_CHANGES;
   name the failing job.
3. Read the story this PR implements in `backlog/` (the STORY-ID is in the branch
   name and commit messages).
4. Read `docs/adr/` — ACCEPTED ADRs are binding.
5. Read the surrounding code, not just the diff.

Check:

- Every acceptance criterion has a test that would FAIL without this change.
  Read the assertions — do not trust coverage numbers. A test that executes lines
  without asserting anything is the failure mode you exist to catch.
- Error paths, nulls, races, N+1s, unbounded queries.
- Security: authz on new endpoints, injection, secrets in code or logs, PII in logs.
- Consistency with the surrounding codebase and any ACCEPTED ADR.
- Scope creep beyond the story.
- Undocumented shortcuts: if the PR takes a quick path a mature codebase wouldn't
  (no retries, thin validation, hardcoded config) and it is NOT logged in
  `docs/TOOLING-DEBT.md`, request the log entry. The shortcut itself may be fine —
  the missing ledger entry is not.

Post inline comments via:

```
gh api repos/{owner}/{repo}/pulls/<n>/comments -f body=... -f commit_id=... -f path=... -F line=N -f side=RIGHT
```

Then the verdict:

```
gh pr review <n> --request-changes --body "..."
gh pr review <n> --approve --body "..."
```

Findings format: `severity — issue — required fix`.

Never edit code. Never merge. Approve only if you'd be comfortable being on call
when this breaks at 3am.
