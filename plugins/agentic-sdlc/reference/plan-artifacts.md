# Plan artifacts — claiming an ID and carrying the plan onto its branch

Read by `/plan` before STEP 1 and by `/build` before it creates its branch, in
both lanes. The script is the protocol; this file explains it.

---

## THE FAILURE THIS PREVENTS

`/plan` writes `backlog/<ID>.md` — and, via the architect, new ADRs and briefs —
into whatever checkout it runs in, untracked. `/build` cuts its branch from
`origin/<base>`, which has never seen them. With several sessions working in
parallel worktrees, a consuming repo measured three failures:

1. **Duplicate IDs.** Each run counted its own `backlog/` and picked the same
   `FAST-<n>`.
2. **Plans that never ship.** A merged PR carried a backlog file citing an ADR
   that existed only as an untracked file in another checkout.
3. **Stale copies in the main checkout.** Sessions kept updating the untracked
   plan (`Status: DONE`) while the copy that shipped said `TODO`, and the
   leftovers blocked `git switch` and fast-forwards of the integration branch.

---

## `/plan` — claim first, record what you wrote

**Claim the ID before the planner runs.** The orchestrator does this, never the
planner:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-artifacts.mjs claim FAST   # or EPIC
# → backlog/FAST-12.md   (created exclusively; the number is yours)
```

It takes the highest number across every worktree's `backlog/` and every local
and remote branch, adds one, and creates the file with an exclusive open. Two
sessions racing on the same number cannot both win. Pass the printed path to the
planner verbatim, and tell it to overwrite that file, not to pick a number.

**Debt goes in the plan, not the ledger.** At plan time the architect writes any
shortcut as a `### <title>` row under a `## Debt` section at the end of the
backlog file. `docs/TOOLING-DEBT.md` is shared by every branch, so editing it
from the planning checkout is how rows get stranded. `carry` moves the rows into
the ledger on the build branch.

**List every other new file on an `Artifacts` line** once the architect has run,
in the backlog file's header block:

```markdown
- Artifacts: docs/adr/0010-districts.md, docs/briefs/campaign/12-foo.md
```

Include each ADR the architect wrote and the brief if it isn't committed yet.
Write `none` if there are none. Never list `docs/TOOLING-DEBT.md` — `carry`
refuses it.

---

## `/build` — carry the plan as the branch's first commit

Right after the branch (or the epic's integration worktree) is created, from
inside it:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-artifacts.mjs carry FAST-12 --from <checkout /plan ran in>
```

It:

- copies `backlog/<ID>.md` and every `Artifacts` path onto the branch, and
  appends the `## Debt` rows to `docs/TOOLING-DEBT.md`;
- commits them as `docs: add <ID> plan`;
- deletes the **untracked** originals from the planning checkout. Tracked files
  are never touched.

It refuses (exit 2) and changes nothing when a listed file is missing, or already
on the branch with different content. That means someone else owns the path, and
a human decides. When `/build` runs in the same checkout `/plan` used, the files
are already present: `carry` just commits them and deletes nothing.

**After `carry`, the branch holds the only live copy.** Status markers, one-way
resolutions and REVISE notes go into the branch's `backlog/<ID>.md` and ship with
the PR. Never write to the planning checkout's `backlog/` again for this ID.
