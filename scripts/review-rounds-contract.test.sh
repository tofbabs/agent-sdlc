#!/usr/bin/env bash
#
# review-rounds-contract.test.sh — the round comment contract lives in one
# on-demand reference; the boot-path files only point at it and at round-state.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
P="$ROOT/plugins/agentic-sdlc"
REF="$P/reference/review-rounds.md"
REVIEWER="$P/agents/code-reviewer.md"
CMD="$P/commands/review.md"

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }
has() { grep -qE -- "$2" "$1" 2>/dev/null && ok "$3" || bad "$3"; }
lacks() { grep -qE -- "$2" "$1" 2>/dev/null && bad "$3" || ok "$3"; }

[ -f "$REF" ] && ok "reference/review-rounds.md exists" || bad "reference/review-rounds.md missing"

has "$REF" '^## Round comment contract' "contract section heading"
has "$REF" 'F<n>: <SEVERITY> \[<finding_category>\] <BLOCKING\|NON-BLOCKING>' "finding line puts the tag after the category"
has "$REF" 'RESOLVED' "contract states RESOLVED for re-listed findings"
has "$REF" '[Uu]ntagged.*BLOCKING|legacy.*BLOCKING' "untagged legacy line reads as BLOCKING"
has "$REF" 'REQUEST_CHANGES.*(only|iff|if and only if).*BLOCKING|open BLOCKING.*REQUEST_CHANGES' "REQUEST_CHANGES only for an open BLOCKING finding"
has "$REF" 'NON-BLOCKING.*(advisory|never revised)' "NON-BLOCKING findings are advisory"
has "$REF" '(body|comment).*authoritative|authoritative.*(body|comment)' "body verdict and sha are authoritative"
has "$REF" 'needs a human.*(posts? nothing|no comment)|posts? nothing.*needs a human' "needs a human posts nothing"

has "$REF" '^## Rounds 2\+' "rounds 2+ section heading"
has "$REF" '<last reviewed sha>\.\.<head>' "rounds 2+ review only the range since the last reviewed sha"
has "$REF" 'resolved.*Response|Response.*resolved' "a finding the response resolved is ruled on from the response"
has "$REF" '(otherwise|unresolved|not resolved).*(stays|remain|left) open|stays open' "an unresolved finding stays open"
has "$REF" '(new|outside).*finding.*BLOCKING.*(security).*(data loss).*(broken contract)' "new findings kept only if BLOCKING and security, data loss or broken contract"

has "$REVIEWER" 'reference/review-rounds\.md' "code-reviewer points at the contract"
lacks "$REVIEWER" 'gh api repos/\{owner\}/\{repo\}/pulls/<n>/reviews -f event' "code-reviewer no longer carries the posting recipe"
has "$REVIEWER" '^- verdict: ' "code-reviewer keeps a minimal template with verdict"
has "$REVIEWER" '^- reviewed sha: ' "code-reviewer template keeps reviewed sha"
has "$REVIEWER" 'BLOCKING' "code-reviewer template tags findings"

has "$CMD" 'round-state\.mjs' "/review reads the previous round via round-state"
lacks "$CMD" 'Note its reviewed sha' "/review no longer re-derives the verdict in prose"
has "$CMD" '[0-9a-z>]\.\.<?head' "round k+1 spawn prompt carries the range since the last reviewed sha"
has "$CMD" '(earlier|previous|prior) findings' "round k+1 spawn prompt carries the earlier findings"
has "$CMD" 'Response — round' "round k+1 spawn prompt carries the author's response"
has "$REVIEWER" 'Rounds 2\+' "code-reviewer points rounds 2+ behaviour at the reference section"

[ "$(wc -c < "$CMD")" -le 4477 ] && ok "review.md within cap" || bad "review.md over 4477 B cap"
[ "$(wc -c < "$REVIEWER")" -le 8552 ] && ok "code-reviewer.md within cap" || bad "code-reviewer.md over 8552 B cap"

exit $fail
