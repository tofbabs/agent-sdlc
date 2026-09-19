# The security bar — what makes a security finding, and how sure you are

Read by the code-reviewer **only when the diff touches a security-sensitive
surface** — auth, tenancy or permission boundaries; money or crypto; secret,
token or PII handling; deserialization, templating or command/query
construction; anything parsing untrusted input. Kept out of
`agents/code-reviewer.md` because most PRs touch none of these and an agent's
system prompt is re-sent on every internal round trip.

The one-line security entry in THE BAR — authz on new endpoints, injection,
secrets in code or logs, PII in logs — is the *trigger list*. This file is how
you rule once one of them fires.

---

## The impact bar — a finding crosses a boundary with a result

A security finding is not "a best practice is missing" and not "this could
crash." It is a **trust boundary crossed to a concrete effect.** Before you
write one, name the whole chain — if you cannot, you do not have a finding yet:

1. **Principal** — the lower-trust actor (anonymous caller, other tenant,
   unprivileged user, a supply-chain input).
2. **Input or action** — what they actually control or send.
3. **Intended control** — the check meant to stop them.
4. **Crossed boundary** — how this diff lets the input reach past that control.
5. **Affected principal or resource** — whose data, funds, or execution.
6. **Observable result** — the concrete, owner-observable consequence: rows
   read across a tenant line, a charge duplicated, code executed, a secret
   logged. "Undefined behaviour" is not a result; name the effect.

A missing header, a generic panic on malformed input with no boundary crossed,
or a hardening nice-to-have with no reachable path is an inline nit, not a
finding. Reachability is the discipline: a real defect on an unreachable path
is not yet a finding — say why it is reachable, or hold it.

## Bound your claim to local evidence

You are reading a source diff, not the running system. **Deployment controls,
proxy and gateway behaviour, provider settings, identity policy, WAF rules,
broker ACLs and network topology are real controls** — do not assume they are
absent just because they are not in the repo, and do not assume they are
present when the boundary's safety depends on them. Trace it in the code you
can see; where the verdict turns on a fact you cannot see from here, that is
not a proven finding — it is one to validate (below).

## Verdict discipline — severity only on what you proved

Every security finding still uses the `F<n>` contract and still blocks
`APPROVE`. The discipline is in the severity slot:

- **Traced to a crossed boundary with an observable result** → an ordinary
  `BLOCKER` / `MAJOR` / `MINOR` finding per THE BAR, with the impact chain in
  the issue text and the fix that closes the boundary.
- **Grounded in the code but blocked on a fact you cannot establish from
  local evidence** (a deployment control, a caller you cannot enumerate, a
  config you cannot see) → write it as
  `F<n>: NEEDS-VALIDATION — <the exact unresolved fact> — <what would confirm
  or refute it>`. **Assign no severity** — you have not proven impact, so you
  do not get to rate it. It still blocks `APPROVE`, because an unresolved
  boundary is not something to merge past; it is closed by *supplying the
  missing fact* (a negative test, a confirmed config, an enumerated caller),
  not by a blind code change. Do not invent a severity to force a fix, and do
  not drop the concern because you could not finish proving it.

Never inflate a hardening suggestion to a severity to make it stick, and never
downgrade a proven boundary crossing because a fix looks expensive. The
severity reflects what you demonstrated, nothing else.

## On a `Mode: FAST` PR

The fast floor already requires the negative test on auth, money,
destructive-data and contract surfaces. This bar is how you *word and rate* a
security finding on any lane; the floor decides what is exempt. They do not
conflict — apply both.
