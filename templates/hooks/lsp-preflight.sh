#!/usr/bin/env bash
#
# lsp-preflight.sh — a SessionStart hook for the agentic-sdlc pipeline.
#
# The agents (coder, architect, planner, navigator) are LSP-first: they are told
# to use the `LSP` tool — not `Grep` — for anything semantic, and to fall back to
# grep only "for a language with no server running". The `LSP` tool needs a
# code-intelligence plugin / language server installed FOR THE PROJECT'S LANGUAGE,
# ON THIS MACHINE. Nothing in the plugin can install that for you, and it is not
# available in cloud sessions at all.
#
# This hook closes the gap between "the contract says install it" and "anyone
# checks". On session start it detects the project's language(s) from their
# manifest files, checks whether a matching language server is on PATH, and — if
# one is missing — feeds a note into the session so both you and the agents know
# the LSP tool will not resolve for that language and navigation will fall back to
# grep (correct, just noisier).
#
# It is ADVISORY ONLY: it never fails the session, never installs anything, and
# never touches the network. Copy it into <project>/.claude/hooks/ and register it
# (see templates/hooks/settings.hooks.json).
#
# The server names below are the common ones per language. The exact binary your
# team's code-intelligence plugin ships may differ — this hook treats a language
# as covered if ANY known server for it is on PATH, and the lists are meant to be
# edited to match your setup.

set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$PWD}"

# Emit a message back into the session as SessionStart additionalContext. Prefers
# structured JSON (safely escaped by python3); falls back to plain stdout, which
# Claude Code also adds to the session context on SessionStart.
emit() {
  local msg="$1"
  if command -v python3 >/dev/null 2>&1; then
    MSG="$msg" python3 -c 'import json,os; print(json.dumps({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":os.environ["MSG"]}}))'
  else
    printf '%s\n' "$msg"
  fi
}

# In a cloud session the LSP tool is unavailable regardless of what is installed,
# so there is nothing to detect — just set expectations and stop.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  emit "LSP preflight: cloud session — the LSP tool is unavailable here, so the LSP-first agents will navigate with Grep/Glob. This is expected; no action needed."
  exit 0
fi

have_file() {
  # true if any of the given root-relative paths exists (globs allowed)
  local p
  for p in "$@"; do
    # shellcheck disable=SC2086
    if compgen -G "$root/$p" >/dev/null 2>&1; then return 0; fi
  done
  return 1
}

have_server() {
  # true if any of the given server binaries is on PATH
  local s
  for s in "$@"; do
    if command -v "$s" >/dev/null 2>&1; then
      found_server="$s"
      return 0
    fi
  done
  return 1
}

present=()
missing=()
found_server=""

# lang | detection markers | candidate servers | install hint
check_lang() {
  local lang="$1" markers="$2" servers="$3" hint="$4"
  # shellcheck disable=SC2086
  have_file $markers || return 0            # language not present in this project
  # shellcheck disable=SC2086
  if have_server $servers; then
    present+=("$lang ($found_server)")
  else
    missing+=("$lang — install one of: $servers  [$hint]")
  fi
}

check_lang "TypeScript/JavaScript" \
  "package.json tsconfig.json jsconfig.json" \
  "typescript-language-server vtsls tsserver" \
  "npm i -g typescript typescript-language-server"

check_lang "Python" \
  "pyproject.toml requirements.txt setup.py setup.cfg Pipfile" \
  "pyright pyright-langserver basedpyright pylsp pyls" \
  "pip install pyright  (or python-lsp-server)"

check_lang "Rust" \
  "Cargo.toml" \
  "rust-analyzer" \
  "rustup component add rust-analyzer"

check_lang "Go" \
  "go.mod" \
  "gopls" \
  "go install golang.org/x/tools/gopls@latest"

check_lang "Ruby" \
  "Gemfile *.gemspec" \
  "ruby-lsp solargraph" \
  "gem install ruby-lsp"

check_lang "Java" \
  "pom.xml build.gradle build.gradle.kts" \
  "jdtls" \
  "install eclipse.jdt.ls (jdtls)"

check_lang "C/C++" \
  "CMakeLists.txt compile_commands.json Makefile" \
  "clangd" \
  "install clangd (LLVM)"

if [ "${#present[@]}" -eq 0 ] && [ "${#missing[@]}" -eq 0 ]; then
  # No recognised language manifest at the root — nothing to check.
  exit 0
fi

join_list() {   # print args separated by ", "
  local out=""
  local item
  for item in "$@"; do
    if [ -z "$out" ]; then out="$item"; else out="$out, $item"; fi
  done
  printf '%s' "$out"
}

if [ "${#missing[@]}" -eq 0 ]; then
  emit "LSP preflight: language server present for $(join_list "${present[@]}"). LSP-first navigation is available."
  exit 0
fi

msg="LSP preflight: no language server found for: $(printf '%s; ' "${missing[@]}")"
if [ "${#present[@]}" -gt 0 ]; then
  msg="$msg  (present for: $(join_list "${present[@]}").)"
fi
msg="$msg  The LSP tool will not resolve for the language(s) above, so the agents will fall back to Grep/Glob — correct, just noisier. Install a language server to restore LSP-first navigation."
emit "$msg"
exit 0
