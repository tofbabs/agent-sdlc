#!/usr/bin/env bash
#
# preflight.sh — run the CI invariants locally, before pushing.
#
# THIS SCRIPT DOES NOT TAG, AND DOES NOT BUMP ANYTHING. It used to do both.
# release-please now owns the version, the tag and CHANGELOG.md:
#
#   1. Land conventional commits on main (feat: / fix: cut a release).
#   2. release-please opens a release PR bumping version.txt, the manifest and
#      plugins/agentic-sdlc/.claude-plugin/plugin.json, with generated notes.
#   3. Edit that PR's CHANGELOG section if the release deserves narrative.
#   4. Merge it. That tags, and merging is the human gate.
#
# Hand-editing a version file will be reverted by the next release PR and will
# fail the version-agreement check below in the meantime.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/plugins/agentic-sdlc/.claude-plugin/plugin.json"
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"
fail=0

note() { printf '  %s\n' "$*"; }
bad()  { printf '✗ %s\n' "$*" >&2; fail=1; }
ok()   { printf '✓ %s\n' "$*"; }

# 1. Structure.
if command -v claude >/dev/null 2>&1; then
  claude plugin validate "$ROOT" >/dev/null && ok "marketplace manifest valid"
  claude plugin validate "$ROOT/plugins/agentic-sdlc" >/dev/null && ok "plugin manifest valid"
else
  note "claude CLI not found — skipping plugin validate"
fi

# 2. A version in marketplace.json is silently beaten by plugin.json.
if grep -q '"version"' "$MARKETPLACE"; then
  bad "marketplace.json declares a version — plugin.json always wins, silently. Remove it."
else
  ok "version declared in exactly one place"
fi

# 3. The three version files must agree, or a release tags without moving the
#    string Claude Code actually reads — and reaches nobody.
PLUGIN=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['version'])")
TXT=$(tr -d '[:space:]' < "$ROOT/version.txt")
RPM=$(python3 -c "import json;print(json.load(open('$ROOT/.release-please-manifest.json'))['.'])")
if [ "$PLUGIN" = "$TXT" ] && [ "$PLUGIN" = "$RPM" ]; then
  ok "version files agree ($PLUGIN)"
else
  bad "version files disagree — plugin.json=$PLUGIN version.txt=$TXT manifest=$RPM"
  note "all three are machine-written; check extra-files in release-please-config.json"
fi

# 3b. This repo builds itself with its own plugin, pinned in .claude/settings.json
#     to the latest tag. release-please moves that ref in the release PR; if the
#     generic extra-file ever breaks, the repo silently keeps building with an old
#     release. Same failure as 3, aimed at ourselves.
SELF_REF=$(python3 -c "import json;print(json.load(open('$ROOT/.claude/settings.json'))['extraKnownMarketplaces']['sanimara']['source']['ref'])")
if [ "$SELF_REF" = "v$PLUGIN" ]; then
  ok "self-pin tracks the latest release ($SELF_REF)"
else
  bad "self-pin is $SELF_REF but plugin.json is $PLUGIN — .claude/settings.json ref must be v$PLUGIN"
  note "release-please moves it via the generic extra-file; do not hand-edit it"
fi

# 4. Shipped content edited on this branch needs a releasable commit, or the
#    change ships to no existing install. Advisory locally; enforced in CI
#    against the PR title, which is what gets squashed onto main.
if git -C "$ROOT" rev-parse --verify -q origin/main >/dev/null; then
  CHANGED=$(git -C "$ROOT" diff --name-only origin/main...HEAD || true)
  # grep -q with a pipe under pipefail causes SIGPIPE if grep finds a match and closes the pipe
  # before the producer finishes, making the whole pipeline fail. Capture first, then grep the output.
  if grep -q '^plugins/' <<< "$CHANGED"; then
    COMMITS=$(git -C "$ROOT" log --format=%s origin/main..HEAD)
    if grep -qE '^(feat|fix)(\([^)]*\))?!?:|^[a-z]+(\([^)]*\))?!:' <<< "$COMMITS"; then
      ok "plugins/ edited, and a feat/fix commit will cut a release"
    else
      bad "plugins/ edited with no feat: or fix: commit — this would ship to nobody"
      note "PR title is what gets squashed; retitle it feat:/fix: or split the PR"
    fi
  fi
fi

# 5. pair-log.mjs enforces the two limits that keep a PAIR story's carryover
#    linear. They were prose before and drifted in every measured story, so they
#    are now code — and code that ships in the plugin gets tested here.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/pair-log.test.sh" >/dev/null 2>&1; then
    ok "pair-log invariants hold"
  else
    bad "pair-log tests failed — run scripts/pair-log.test.sh to see which invariant broke"
  fi
  if "$ROOT/scripts/pair-run.test.sh" >/dev/null 2>&1; then
    ok "pair-run loop invariants hold"
  else
    bad "pair-run tests failed — run scripts/pair-run.test.sh to see which stop condition broke"
  fi
else
  note "node not found — skipping pair-log tests"
fi

# 6. meter.mjs is the instrument the whole cost programme rests on. Its totals
#    must reproduce byte-exactly and — the load-bearing case — a transcript with a
#    field missing must DEGRADE cleanly rather than silently report zeros, which
#    would make every downstream cost claim false. Same node guard as section 5.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/meter.test.sh" >/dev/null 2>&1; then
    ok "meter invariants hold"
  else
    bad "meter tests failed — run scripts/meter.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping meter tests"
fi

# 6b. consent.mjs holds the team-wide telemetry answer; a regression here either
#     nags users or exports without their say-so.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/consent.test.sh" >/dev/null 2>&1; then
    ok "consent store and wiring hold"
  else
    bad "consent tests failed — run scripts/consent.test.sh to see which check broke"
  fi
else
  note "node not found — skipping consent tests"
fi

# 6a. run-report.mjs derives the report that gets exported. Its cost section
#     must be the meter record verbatim, a missing input must be null and named
#     rather than zeroed, and no field may accept an unbounded string — the
#     report is code-free by schema, so a regression here is a leak. Same node
#     guard as above.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/run-report.test.sh" >/dev/null 2>&1; then
    ok "run-report invariants hold"
  else
    bad "run-report tests failed — run scripts/run-report.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping run-report tests"
fi

# 6a-hook. run-report.sh is the UserPromptSubmit/SessionEnd hook wrapping
#     run-report.mjs: its stdout must stay empty on every path (UserPromptSubmit's
#     stdout is injected into the model's context), SessionEnd must return well
#     under its shared 1.5s budget by spawning the report build detached, and a
#     missing node or run-report.mjs must degrade to exit 0 exactly like meter.sh.
#     Run under /bin/bash explicitly — macOS's bash 3.2 is the one that matters.
if command -v node >/dev/null 2>&1; then
  if /bin/bash "$ROOT/scripts/run-report-hook.test.sh" >/dev/null 2>&1; then
    ok "run-report hook invariants hold"
  else
    bad "run-report hook tests failed — run scripts/run-report-hook.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping run-report hook tests"
fi

# 6b. plan-artifacts.mjs keeps parallel sessions from colliding on backlog IDs
#     and makes a plan ship with its build branch. Same node guard as above.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/plan-artifacts.test.sh" >/dev/null 2>&1; then
    ok "plan-artifacts invariants hold"
  else
    bad "plan-artifacts tests failed — run scripts/plan-artifacts.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping plan-artifacts tests"
fi

# 6c. mode-select-fields.mjs is the single source of truth for selection-field
#     enums and evidence rules; mode-select.mjs (STORY-2-3+) and the planner
#     both read it instead of hardcoding a value a second time. Same node
#     guard as above.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/mode-select-fields.test.sh" >/dev/null 2>&1; then
    ok "mode-select-fields invariants hold"
  else
    bad "mode-select-fields tests failed — run scripts/mode-select-fields.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping mode-select-fields tests"
fi

# 6d. mode-select.mjs applies hard floors first, then the versioned ARCH-2
#     rubric, so the same inputs always produce the same decision and thresholds
#     retune without a code change. A floor a retune could remove, or a decision
#     that drifts between identical runs, is the failure this guards. Same node
#     guard as above.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/mode-select.test.sh" >/dev/null 2>&1; then
    ok "mode-select invariants hold"
  else
    bad "mode-select tests failed — run scripts/mode-select.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping mode-select tests"
fi

# 6b. Decision records: the ID is the join key every later outcome hangs off, so
#     its derivation and the store's idempotency on the identity tuple are
#     contract, not detail. Same node guard as above.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/decisions.test.sh" >/dev/null 2>&1; then
    ok "decision-record invariants hold"
  else
    bad "decisions tests failed — run scripts/decisions.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping decisions tests"
fi

# 6c. Outcome events, the gh sweep and the verdict rules: a verdict is only as
#     trustworthy as its fixture, and the accounting check is the proof that
#     every decision ends in exactly one state.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/outcomes.test.sh" >/dev/null 2>&1; then
    ok "outcome events, sweep and verdict invariants hold"
  else
    bad "outcomes tests failed — run scripts/outcomes.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping outcomes tests"
fi

# 6d. The anonymous repo ID: a per-clone random salt, stable across worktrees,
#     with nothing identifying the repo, user or machine anywhere in it.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/repo-id.test.sh" >/dev/null 2>&1; then
    ok "repo ID is stable, per-clone and anonymous"
  else
    bad "repo-id tests failed — run scripts/repo-id.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping repo-id tests"
fi

# 6e. The export client: queue, backoff and kill switch, against a local stub.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/export.test.sh" >/dev/null 2>&1; then
    ok "export client queues, backs off and honours the kill switch"
  else
    bad "export tests failed — run scripts/export.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping export tests"
fi

# 6f. The export client under failure: oversize, 401, 413, backoff, kill switch
#     and a black-hole endpoint, so telemetry can never hold a session open.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/export-resilience.test.sh" >/dev/null 2>&1; then
    ok "export client survives black holes, backoff and the kill switch"
  else
    bad "export resilience tests failed — run scripts/export-resilience.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping export resilience tests"
fi

# 7. The agent boot path is a cost surface: a byte added to coder.md is paid ~40
#    times on a PAIR story. The budget is ratchet-only — a file over its cap, or a
#    cap raised above origin/main, fails. reference/*.md is exempt by design.
if command -v node >/dev/null 2>&1; then
  if node "$ROOT/scripts/size-budget.mjs" >/dev/null 2>&1; then
    ok "size budget holds"
  else
    bad "size budget exceeded — run node scripts/size-budget.mjs to see which file grew"
  fi
else
  note "node not found — skipping size budget"
fi

[ "$fail" -eq 0 ] || { printf '\npreflight failed\n' >&2; exit 1; }
printf '\npreflight passed — push, then let the release PR do the rest\n'
