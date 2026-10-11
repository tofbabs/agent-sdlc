# 0006. Per-repo pipeline config: `.claude/agentic-sdlc.json`, read only through `config.mjs`

- Status: ACCEPTED
- Date: 2026-10-09
- Reversibility: ONE-WAY. Once consuming projects commit settings, moving the
  file or renaming a key breaks every one of them silently: the pipeline falls
  back to defaults and nobody notices.
- Resolves: ARCH-3 of `backlog/EPIC-7.md`. It also settles the "where the
  setting lives" open question in `docs/briefs/github-backlog/01-store-interface.md`
  and the config question in `docs/briefs/waves/02-wave-core.md`. Those briefs
  follow this ADR. They do not reopen it.

## Context

Three briefs need per-repo settings: the review round cap and reviewer model
(EPIC-7), the backlog store `repo|github` (github-backlog 01/02), and the wave
settings (waves 02). The constraints are:

- **Scripts read it as well as agents.** `mode-select.mjs` and the store
  adapter are plain Node, and the wave routines run in cloud sessions.
- **It must be committed.** A fresh, memoryless cloud session has only the
  checkout. Anything stored per user is invisible to it.
- **The boot path is at its byte cap.** Settings parsing can't live as prose
  in `agents/` or `commands/`.
- **Precedent:** `**Agent models:** <agent>=<m> …` in the project's
  `CLAUDE.md` (`reference/models.md`). This is the only per-repo setting today.
  The orchestrating command reads it because `CLAUDE.md` is already in its
  context.

Verified on 2026-10-09 (code.claude.com plugins-reference and settings-reference):
the plugin manifest's `userConfig` stores values under `pluginConfigs`, and that
key is read only from **user or managed** settings, never from the project's
committed `.claude/settings.json`. It reaches skill and agent text through
`${user_config.KEY}` and hooks through `CLAUDE_PLUGIN_OPTION_<KEY>`. It does not
reach Bash-tool scripts.

## Options

- **A: More `**Key:** value` lines in `CLAUDE.md`.** This follows the
  precedent, and agents see it for free. But a script has to regex prose that
  people edit by hand. There are no types and no nesting, so the store or
  wave settings would need a mini-language. Every byte is also loaded into
  every session's context, including sessions that never plan or review.
- **B: Plugin `userConfig`.** This is the native mechanism with a `/config` UI.
  But it is per user, not per repo, so a cloud session or a teammate never
  sees it, and scripts can't read it. Rejected.
- **C: A custom key in `.claude/settings.json`.** It's committed, but it lives
  in a file Claude Code owns and validates, and its unknown keys are stripped
  or warned about. That means it could break on any Claude Code release.
  Rejected.
- **D: A committed JSON file owned by the plugin, `.claude/agentic-sdlc.json`,
  read only through one shipped script.** It's typed and versioned. Scripts
  read it natively and agents read it through one `node` call. It sits beside
  the Claude config people already commit. It isn't `.agentic-sdlc/`, which is
  local run state and is gitignored (this repo's `.gitignore`).

## Decision

**D.** The per-repo config file is `.claude/agentic-sdlc.json` at the project
root, committed:

```json
{
  "schema": 1,
  "review": { "round_cap": 3 },
  "backlog": { "store": "repo" },
  "wave": { }
}
```

1. **One reader.** `plugins/agentic-sdlc/scripts/config.mjs` is the only
   code that opens the file. Commands and agents never parse it. They run
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs get <dotted.key>`, which
   prints the effective value with the default applied. Scripts import its
   exported `readConfig()`. Defaults live in that script, one copy only.
2. **Missing file = all defaults, exit 0.** No consuming project has to create
   the file, so adding it is not a breaking change.
3. **Fail loudly on bad input.** Invalid JSON, a wrong type, an
   out-of-range value, or `schema` other than 1 prints the key and the problem
   and exits non-zero. A command that gets a non-zero exit stops, and it never
   falls back to a default. An **unknown key** gets a warning on stderr and is
   ignored, so a project that sets a key from a newer plugin still works with
   an older one.
4. **Each owning brief adds its own keys.** EPIC-7 adds only
   `review.round_cap` (integer ≥ 1, default 3). github-backlog adds
   `backlog.store`, and waves 02 adds `wave.*`. Adding a key is additive and
   doesn't bump `schema`. Renaming or retyping one does, and needs a superseding
   ADR.
5. **Agent models stay where they are.** The `**Agent models:**` line in
   `CLAUDE.md` is already the per-repo model setting. It already covers
   `code-reviewer=<m>` and isn't moved in this ADR. Moving it would break every
   project that set it. So the configured reviewer model for STORY-7-4 is
   `code-reviewer=` on that line. Precedence stays `--model` / `--fable` >
   `**Agent models:**` > the documented fallback. **The fallback is
   `opus`**: the code-reviewer's frontmatter model, stated by name in
   `reference/models.md`. `/review` always passes `model:` explicitly, even
   when it resolves to the fallback. That way the spawn never depends on a
   default that nobody wrote down.

## Consequences

- Becomes easy: scripts and cloud routines read settings with no prose
  parsing. Each brief adds keys without touching the boot path, and a bad
  value fails at the first command instead of steering behaviour quietly.
- Becomes easy: the file has an obvious owner. It sits beside the
  `.claude/settings.json` that humans already maintain and commit, and no
  pipeline agent is told to write it.
- Becomes hard: renaming a key or moving the file. That takes `schema: 2`, a
  reader for both versions, and a `feat!:`.
- Becomes hard: per-user overrides of a repo setting. None are supported. The
  command-line flags are the per-run override.
- Two homes for settings. Agent models are in `CLAUDE.md` and everything else
  is in the JSON file. The split is deliberate. Moving models is a separate
  breaking change, and nothing here needs it.

## Revisit if

- Claude Code starts reading `pluginConfigs` (or an equivalent) from
  **project** settings and exposes it to Bash-tool processes. Then B would be
  native and per-repo.
- A second setting needs per-user override semantics.
- A brief needs `**Agent models:**` in a script. That is the moment to move
  models into the JSON file with a `schema` bump.
