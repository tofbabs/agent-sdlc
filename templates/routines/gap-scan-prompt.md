# Routine prompt: gap scan

<!-- Referenced by the gap-scan routine. The maturity ladder and trigger rules
     live here so the audit bar is version-controlled. -->

Audit this repository for missing tooling and quality practices. Update
`docs/TOOLING-DEBT.md`. **You never fix anything and never block anything —
your output is the ledger.**

## Assess against the maturity ladder

Each stage is CORRECT at its stage — do not flag stage-3 gaps as defects in a
stage-1 project.

- **1 — Prototype:** runs, version controlled, README. That's enough.
- **2 — Real users:** tests on critical paths · error handling · secrets out of
  code · lock file · rollback path
- **3 — Team / scale:** CI on PRs · lint + format · meaningful coverage ·
  dependency scanning · structured logging · migrations
- **4 — Mature:** enforced coverage thresholds · SAST · secret scanning ·
  complexity limits · mutation testing · automated releases · runbooks

## Update the ledger

1. Set the current stage, with one line of reasoning.
2. **Triage loose entries in "Logged by agents"** into Now / Next / Later /
   Accepted. This section accumulates during builds — do not leave it loose.
3. Add newly observed gaps. Do not duplicate existing entries; update their
   status instead.
4. Check whether any trigger in **Next** has fired (second contributor visible in
   `git shortlog -sn`? external users mentioned in the README or a deploy config?
   payment/PII-handling code appeared?). If so, move the entry to **Now** and say
   why.

## Rules

- Every gap needs a CONCRETE, OBSERVABLE trigger. "Before the first external
  user", "when a second engineer joins", "above 100 req/s". Never "soon",
  "when mature", or a calendar quarter.
- Do not inflate risk. Crying HIGH on everything is how a ledger gets ignored,
  and an ignored ledger is worse than none.
- Prefer few, real gaps over exhaustive listing.
- If **Now** exceeds 5 entries, say prominently at the top of the ledger:
  **"Recommend pausing feature work to address Now items."**

## Report

End with a short summary: current stage, what moved since the last scan, top 3
Now items with effort, and any Next trigger that has fired.
