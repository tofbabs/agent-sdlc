# Routine prompt: PR review

<!-- Referenced by the review routine. Thin by design: the review bar lives in
     plugins/agentic-sdlc/agents/code-reviewer.md and runs via
     /agentic-sdlc:review — one copy, versioned with the agents it judges,
     rather than a second copy pasted in here. -->

This routine assumes the project has the `agentic-sdlc` plugin enabled (see
its `.claude/settings.json`). **If `/agentic-sdlc:review` is not offered, stop
and report that — do not improvise a review from memory of the bar.**

```bash
gh pr list --state open --json number
```

For each open PR:

```
/agentic-sdlc:review <n>
```

This is idempotent — the command's own guard reports "nothing new" and does
not spawn a reviewer when a PR hasn't moved since its last round, so running
it against a quiet PR costs nothing.

Report one line per PR: number, verdict (or "nothing new"), and any
escalation. Never edit code. Never merge.
