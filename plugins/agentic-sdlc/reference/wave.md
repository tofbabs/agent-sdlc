# Wave protocol

A wave is a set of brief Issues built together. Brief Issues are parsed by
`brief-issue.mjs`; selection and the board are pure scripts, so every GitHub
call is yours and goes through `gh api` (REST) only, never the porcelain subcommands.

Scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts/`.

## start

1. Fetch the open Issues with `gh api` and save the payload.
2. `node wave-select.mjs <payload>`. If it reports `wave-active` (an Issue
   already labelled `wave:active`), **refuse**: say which Issues hold the wave
   and change nothing — no label, no comment, no edit.
3. Otherwise create the labels `wave`, `wave:active`, `wave:<N>` and the
   `phase:*` labels the selected briefs need, each only if missing.
4. Create the epic Issue with `gh api`, labelled `wave` and `wave:active`.
   Only the epic carries `wave:active`; on a selected brief it would make the
   next selection refuse.
5. Label each selected brief `wave:<N>` and its start phase `phase:<name>`
   (from the `wave-select.mjs` phases).
6. Build the board JSON and pipe it to `node wave-board.mjs`.
7. Post the board as a comment on the epic Issue. On later runs find the
   comment by its first-line marker `<!-- wave-board:<n> -->` and edit it in
   place with `gh api`; never post a second board.

## status

Read the board comment and the Issues with `gh api`, re-render with
`wave-board.mjs`, and print it. `status` writes nothing: no label, no comment,
no edit.

## tick, phase

`tick` is not available in this release; `phase` is not available in this release. Say so and do nothing else.

## Board content

Only Issue and PR numbers, phases and timings. No titles, bodies or
free text.
