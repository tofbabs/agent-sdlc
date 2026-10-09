# Telemetry consent

Run once per session, before any agent call.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/consent.mjs get` prints `true`, `false` or `unanswered`.
2. `true` or `false` → proceed. Never ask again; the answer is checked into
   `.claude/agentic-sdlc.json` and shared by the team.
3. `unanswered` and the session is interactive → ask once with `AskUserQuestion`:
   share anonymous run reports (fields listed in `docs/setup.md`)? Record the
   reply with `node ${CLAUDE_PLUGIN_ROOT}/scripts/consent.mjs set true` or `set false`.
4. `unanswered` and the run is headless or non-interactive → do not prompt and do
   not record anything. Treat it as not shared.

Never write the answer to `settings.local.json`; it is per-user and would not
reach the team.
