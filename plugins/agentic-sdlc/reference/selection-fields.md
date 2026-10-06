# Selection fields — what each one means, and how to pick evidence

The planner writes one `- select: ...` line per story or FAST task instead of
a free-text `risk:` line. `mode-select.mjs` and `/build` read it to decide a
lane and a pairing mode from evidence, not from a human's gut read of prose.

**Field names, enum values and the line's exact syntax are not repeated
here** — they live in one place, `mode-select-fields.mjs`, so they are never
declared a second time and cannot drift. Run it to see the current spec:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/mode-select-fields.mjs
```

Use `parse()` / `format()` from that module for the line itself; this file is
only the field-by-field judgment call of what value to write.

## Field meanings

- **risk_class** — the brief's named floor this story/task touches, or
  `none` if it touches no floor. Pick the single class that would hide the
  worst bug, not every class that's loosely nearby.
- **one_way_doors** — count of decisions this story/task makes that are
  expensive to unpick later (a schema shape, a published contract, a vendor
  choice). Usually `0`; an `ARCH-<n>` handoff is the more honest tool for an
  actual one-way door, not a buried count.
- **existing_pattern** — `yes` if the story/task follows a pattern the
  codebase already has an example of; `no` if it's introducing a new one.
  Mirrors the old `risk: none: follows <pattern>` idiom — say which pattern in
  the technical notes, not in this field.
- **modules_crossed** — count of modules/files the change is expected to
  touch meaningfully (not every import). A plumbing story on one module is
  `1`; a story that threads a change through several layers is higher.
- **review_bounced** — `yes` only when this exact story/task already came
  back from code review once (a REVISE round). Always `no` for a story's
  first pass.
- **risk_kind** — whether the risk lives in *code* (logic, control flow) or
  *data* (sourcing, seeding, migration content), independent of `risk_class`.
  `none` with `data` is the non-destructive data story — sourcing or seeding
  that touches no floor — and is the only combination that routes a SOLO
  coder onto Opus; every other `risk_class` already forces PAIR. Write `code`
  when the work is logic.

## Evidence

Every value carries exactly one citation: the brief line it came from
(`brief:L<n>` or `brief:L<n>-L<m>`) or the acceptance criterion that implies
it (`AC<n>`). Cite the most specific source — an AC that states the risk
directly outranks a brief line that only hints at it. Never leave a field
uncited and never stack two citations on one field: `mode-select-fields.mjs`
rejects both.

## Fallback (AC4): a backlog file with no `- select:` line

A story or FAST task written before this story landed carries no `- select:`
line at all. `mode-select.mjs` and `/build` treat that as a deliberate
fallback, not a parse error:

- No `- select:` line found for a story/task → fall back to today's prose
  `risk:` rule (infer lane/pairing from the `risk:` field and the ACs, as
  `/build`'s MODE SELECTION already does).
- The fallback **must be recorded** — the run report or build output marks
  that story/task `fallback: true` so the gap is visible, not silent.
- A `- select:` line that *is* present but fails to parse (unknown field, bad
  enum, missing evidence) is a different case and is **not** this fallback —
  it is a plan-time authoring error and should fail loudly, the same way
  `mode-select-fields.mjs`'s `parse()` already does.

`mode-select-fields.mjs` exports `findSelectLine(block)` so a reader can tell
the two apart before calling `parse()`: it returns `null` when no `- select:`
line exists (the fallback case) and the raw line when one exists but may still
fail `parse()` (the authoring-error case).

Implementing the fallback behaviour itself — scoring, `/build`'s read path —
is `mode-select.mjs` (STORY-2-3) and its wiring into `/build` (STORY-2-5).
This file documents the contract those stories build against.
