---
description: Run a wave of brief Issues — `start` selects and boards them, `status` reads the board. Tick and phase are not available in this release.
argument-hint: start | status | tick | phase
allowed-tools: Read, Bash(node:*), Bash(gh api:*)
---

Subcommand: `$ARGUMENTS`.

Protocol → `cat ${CLAUDE_PLUGIN_ROOT}/reference/wave.md`, then follow the section for the subcommand. GitHub only through `gh api` (REST).

`tick` and `phase` → answer "not available in this release" and stop.
