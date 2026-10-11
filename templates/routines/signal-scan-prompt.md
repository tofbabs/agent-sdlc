# Routine prompt: signal scan

<!-- Referenced by the signal-scan routine. The run order and the merge-file
     shape live here so the operating instruction is version-controlled. -->

Turn recurring run signals into proposed issues. **This routine only proposes. It never writes briefs,
opens pull requests or makes commits. A human reads each issue and decides
whether to write a brief.**

## Steps

Run these in order from the repository root.

1. Group the signals:
   `node scripts/signal-scan.mjs groups --source dir:.agentic-sdlc/runs --out groups.json`
2. Read `groups.json` and write `merges.json`: the groups you judge to describe
   the same underlying problem. Use only the closed shape the scripts accept;
   anything else is rejected and reported, so do not improvise fields.
3. Apply the proposal:
   `node scripts/signal-scan.mjs apply-merges --source dir:.agentic-sdlc/runs --merges merges.json`
4. File the issues:
   `node scripts/signal-sync.mjs --source dir:.agentic-sdlc/runs --merges merges.json`

## Rules

- `--source` is the only thing that names the store. Moving to another store is a
  one-line change to that flag, never to these steps.
- Propose merges only when the groups plainly share a cause. A wrong merge hides
  a signal; a missed one only costs a duplicate a human can close.
- No briefs, no PRs, no commits. The issues are the whole output.

## Report

End by printing the summary the filing run produces, including the accounting
line, which must read: `accepted N = filed a + discarded b + no_signal c; rejected M by reason`.
Also say how many groups are new since the last run.
