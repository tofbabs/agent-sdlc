#!/usr/bin/env bash
#
# review-model.test.sh — the reviewer's model is always stated, never inherited.
#
# /review's spawn used to make `model:` optional, so with no override the
# reviewer ran on whatever prose the agent files nudged toward. These pin the
# resolved-model contract in the docs the orchestrator actually reads.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
P="$ROOT/plugins/agentic-sdlc"
REVIEW="$P/commands/review.md"
MODELS="$P/reference/models.md"
AGENT="$P/agents/code-reviewer.md"

fail=0
check() { # name, command...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '✓ %s\n' "$name"; else printf '✗ %s\n' "$name" >&2; fail=1; fi
}
has()  { grep -Eq -- "$2" "$1"; }
lacks() { ! grep -Eqi -- "$2" "$1"; }

# AC1: model: is a mandatory argument of the spawn, not a bracketed option.
check "review spawn passes model unconditionally" lacks "$REVIEW" '\[model:'
check "review spawn names a model argument" has "$REVIEW" 'model: *<'

# AC3: with no override the fallback is stated by name, in models.md.
check "models.md states opus as the code-reviewer fallback" \
  has "$MODELS" 'code-reviewer.*fallback.*`opus`|fallback.*`opus`.*code-reviewer'

# review.md must load models.md on every run, since the fallback lives there.
check "review always reads models.md" lacks "$REVIEW" 'only when|--fable`, `--model` or'

# AC2: precedence is one ordered list, so the fallback ranks below both the
# flag and the CLAUDE.md line instead of floating in prose.
check "models.md ranks the opus fallback third, under flag and CLAUDE.md line" \
  has "$MODELS" '^3\. .*`opus`'
check "models.md keeps --fable as the flag shorthand ahead of config" \
  has "$MODELS" '^1\. .*--model'

# AC4: Fable is only an explicit override, so no boot-path prose nudges the
# reviewer toward it or frames Opus as a cost compromise.
check "code-reviewer model note does not steer toward Fable" \
  lacks <(sed -n '1,20p' "$AGENT") 'fable'
check "review description does not advertise Fable escalation" \
  lacks <(sed -n '2p' "$REVIEW") 'fable|escalat'

exit $fail
