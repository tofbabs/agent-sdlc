# The fast floor — what a `Mode: FAST` PR is judged against

Read by the code-reviewer **only when the PR body stamps `Mode: FAST`**. Kept
out of `agents/code-reviewer.md` because a deliberate-lane PR never needs it
and an agent's system prompt is re-sent on every internal round trip.

---

That PR was built in the lean lane deliberately, and judging it against the
deliberate bar turns every intended shortcut into a finding — which costs more
than the lane saved. Judge it against this floor instead.

- A missing **unit test, edge case, or error branch**, or a skipped TDD loop,
  is **not a finding**. That is the mode working, not a defect.
- A missing test on a **risk surface** — auth, permission or tenancy
  boundaries; money and arithmetic on it; destructive or migrating data
  paths; external API contracts — **is** a finding, ledger entry or not. The
  ledger records a decision; it does not license an untested auth check.
- **On those four surfaces the negative test is the required one**, so a
  surface covered only by a happy-path test is the same finding as an
  untested one. Check for the case that would do the harm: the wrong caller
  refused, the rounding or duplicate-charge case, the wrong rows surviving a
  delete or a re-run migration, the malformed or error response rejected.
  "It passes when everything is correct" is not coverage of a boundary whose
  job is to reject.
- An unlogged shortcut is a finding only when it sits on one of those four
  surfaces.
- Everything else on THE BAR — correctness, security, ADR consistency, scope
  — applies unchanged.

Fast mode narrows what gets tested, not what gets reviewed.
