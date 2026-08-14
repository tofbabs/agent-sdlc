# MODE: REVISE — closing the review routine's findings

Read by the coder **only when the orchestrator says `MODE: REVISE`**. Kept out of
`agents/coder.md` for the same reason as PAIR mode.

---

## MODE: REVISE (given a PR number)

The review routine posts one structured comment per round on the PR: a verdict,
a reviewed commit sha, and findings with stable IDs (`F1`, `F2`…). The PR thread
is the review record.

1. `gh pr view <n> --comments` — find the latest `## Review — round <k>` comment.
2. **If APPROVE:** nothing to do — report the story ready for human merge.
3. **If REQUEST_CHANGES:** address **EVERY** finding. Fix it, or dispute it —
   **never silently ignore one.**
4. Run the full checks. Commit:
   `fix(<scope>): address review findings [<STORY-ID>]` and push.
5. Reply on the PR with ONE comment, ruling on each finding by ID:

   ```markdown
   ## Response — round <k>
   - F1: FIXED — <what changed, one line>
   - F2: DISPUTED — <why the finding is mistaken>
   ```

6. The routine's next pass re-reviews the new head and rules on disputes.
7. Max 3 revise rounds. Still REQUEST_CHANGES after that → the story or a
   contract is probably wrong; stop and escalate to the human.

---
