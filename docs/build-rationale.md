# Why `/build` branches and lands the way it does

Back to the [Concepts](concepts.md) reference.

This is the reasoning a human needs **once** to trust `/build`'s branch topology
and model choices. It used to live inline in `commands/build.md`, where the
orchestrator re-read it on every invocation — ~1.5 KB of history and argument
paid for on each `/build`, for content that changes no decision an agent makes
mid-run. The normative rules stay in `build.md`; the *why* lives here.

If you are only running the pipeline, you never need this file. If you are
changing the branch rules, read it first — every rule in `build.md`'s BRANCH
TOPOLOGY and COST NOTE follows from what is below.

---

## Why squashing inside the epic is safe now — and was not in #77

#77 forbade squashing inside an epic, and its diagnosis was right for the shape
it measured: EPIC-4 shipped five stories **stacked on each other's unmerged
branches**, #74 carried both STORY-4-1's and STORY-4-3's commits, and seven files
came back as add/add conflicts on the second pass — none of them a real
difference of opinion.

But squashing was only half the cause. The failure needed **both** halves:

- a child branched off a parent branch whose work was **not yet landed**, so the
  child carried the parent's own commit SHAs; **and**
- a squash of that parent, which rewrote the same work under a *new* SHA.

The child then had no common ancestor for those files, and git could only call it
add/add. Reproduce either half alone and nothing happens; reproduce both and the
conflict is deterministic.

Invariant 1 (a story branches only from the epic tip, after its `depends_on` have
landed) removes the first half outright. A story branches from the epic tip
*after* its parents have landed, so the parent's **squash commit is already in
the child's ancestry** — not the parent's pre-squash SHAs. The child's landing is
then an ordinary three-way merge against a shared ancestor, usually a
fast-forward. Same-wave siblings share the epic tip as their base and never carry
each other's commits at all, so they are independent by construction.

This is empirically checked, not argued: branch a story from the epic tip, land
it with `git merge --squash`, branch the next story from the **new** tip, have it
edit the same file, and land it — clean, with a first-parent log of exactly one
conventional commit per story. Do the #77 shape instead — stack the child on the
unmerged parent, squash the parent — and the add/add returns.

So the rule that replaces "never squash inside an epic" is not weaker, it is
narrower and load-bearing: **never branch a story off `origin/<base>` or off
another story's branch.** That stacking is what #77 actually measured.

#77's own fix — wait for the parent to land on `<base>` — also worked, but it
paid for correctness with a human merge cycle per story. The epic branch buys the
same correctness for free, and the per-story squash buys one changelog line per
story on top.

## Why merge `origin/<base>` in early, and re-gate after every resolution

Divergence is cheap to resolve while you still remember the epic and expensive
once the branch is a week old. Merging (not rebasing) keeps the pushed history
stable so review threads stay anchored. An epic branch lives longer than a story
branch did, so if the epic runs long, merge `origin/<base>` in **between waves**
too — do not save it all for the end.

After any conflict resolution — and after every squash landing — re-run the
full gate. Tests alone are not enough: a resolution that drops a closing brace
from a type file still passes every test and fails only at `build`, with the
error reported at the *next* declaration rather than the damage. That is from #73
and it still applies — the merges moved, the lesson didn't.

## Why the epic PR is merge-committed, never squashed

This is load-bearing for release-please, not a style preference, and it is
unaffected by the per-story squashes inside the branch.

`release-please-config.json` maps each package to its own component and reads
**per-package conventional commits** — `feat(bff):`, `feat(field-pwa):`. Squashing
the epic PR collapses every story into one commit with one scope, so exactly one
package gets a version bump and every other package the epic touched is silently
missed. EPIC-5 touched four.

Merge-committing preserves each story's own landing commit — which is exactly one
scoped conventional commit per story, which is what release-please needs. Use
**"Create a merge commit"** on the epic PR — never "Squash and merge". Squash
stays correct for the single-story `/build STORY-<id>` path, where there is only
one scope anyway.

---

## The cost model behind the model choices

Coder is on Sonnet 5 by default — it runs the most turns, so it dominates spend,
and the cheapest capable model belongs there. In a PAIR story the navigator is on
Opus 4.8 (the escalation tier) — cheaper hands, better eyes — and it runs every
other turn, which is the other half of why pairing roughly doubles a story's cost
and why mode selection matters.

**Escalate a specific story's coder to Opus 4.8** when it's genuinely hard: novel
algorithm, tricky concurrency, or a story that's already come back twice. Override
the model on that invocation rather than changing the agent's default — one hard
story shouldn't multiply your rate across every easy one.

**Never Fable on the coder or navigator.** It belongs on the architect, where
turns are few and judgment is dense. In the loops its cost compounds across
volume for decisions that are mostly local and cheap to redo.

**The model tier is the small lever; the context curve is the big one.** A PAIR
story's spend is dominated by how much context is re-sent per turn, not by the
per-token rate. Model choice scales the rate. Whether the agents are fresh scales
the *shape* — flat or quadratic — and on EPIC-15 that shape was worth more than
any tier decision here. Get freshness right first.

> The exact arithmetic of that context curve — how re-sent bytes are actually
> billed (cache reads at 0.10×, not full rate), and the per-spawn boot cost the
> earlier model omitted — is corrected in
> `docs/superpowers/specs/2026-07-31-pair-log-carryover-design.md` and measured
> per lane by `plugins/agentic-sdlc/scripts/meter.mjs`. The ranking above
> (freshness first, tier second) is unchanged by the correction; only the
> magnitudes moved.
