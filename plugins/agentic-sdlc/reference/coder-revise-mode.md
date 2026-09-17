# MODE: REVISE — closing the code-reviewer's findings

Read by the coder **only when the orchestrator says `MODE: REVISE`**. Kept out of
`agents/coder.md` for the same reason as PAIR mode.

---

## MODE: REVISE (given a PR number)

The code-reviewer posts one structured comment per round on the PR: a verdict,
a reviewed commit sha, and findings with stable IDs (`F1`, `F2`…). The PR thread
is the review record.

**You commit; the orchestrator lands, pushes and speaks.** It has put you in a
revise worktree on `fix/EPIC-<n>-round-<k>`, branched off the epic tip. That
branch is local scaffolding: the orchestrator squashes it onto `feat/EPIC-<n>` as
one `fix(...)` commit, pushes that, and posts the response comment itself. So
**do not push, and do not comment on the PR** — a comment posted before the
orchestrator's push makes `/agentic-sdlc:review`'s guard ("new sha AND a response
exists") fire a re-review against the old head.

1. `gh pr view <n> --comments` — find the latest `## Review — round <k>` comment.
2. **If APPROVE:** nothing to do — report the story ready for human merge.
3. **If REQUEST_CHANGES:** address **EVERY** finding. Fix it, or dispute it —
   **never silently ignore one.**
4. Run the full checks, then commit in your worktree. Your increments are
   free-form but conventional — the orchestrator writes the landing message, so
   nothing downstream reads them. **Do not push.**
5. Return your rulings **as a structured report to the orchestrator**, one line
   per finding by ID — not as a PR comment. Keep exactly this line shape, because
   the orchestrator pastes it verbatim under a `## Response — round <k>` heading:

   ```markdown
   - F1: FIXED — <what changed, one line>
   - F2: DISPUTED — <why the finding is mistaken>
   ```

   Add the release-please package scopes you touched, so the orchestrator can
   write `fix(<scope>): address review round <k> [EPIC-<n>]` without reading the
   diff.
6. The orchestrator lands, pushes and comments; the next `/agentic-sdlc:review`
   pass then re-reviews the new head and rules on disputes.
7. Max 3 revise rounds. Still REQUEST_CHANGES after that → the story or a
   contract is probably wrong; stop and escalate to the human.

---
