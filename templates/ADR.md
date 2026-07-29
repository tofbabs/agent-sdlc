# <N>. <Title — the decision, as a statement>

<!-- HOUSE FORMAT. This deliberately differs from MADR and the other common ADR
     templates, which carry an "Options Considered" section and a
     "Recommendation" — i.e. an options paper for a human to adjudicate.

     That contradicts this pipeline's own architect agent, which is told: "The
     architect DECIDES. It does not produce an options paper for you to
     adjudicate." Rejected alternatives still appear here — but under Decision,
     as things already ruled out and why, not as a menu.

     Write an ADR only for a ONE-WAY DOOR. A decision that is cheap to reverse
     is resolved inline in the epic file, as `ARCH-<n>` with
     `reversibility: TWO-WAY`. -->

- **Status:** Proposed | Accepted | Superseded by <N> — *only a human moves this to Accepted*
- **Date:** <YYYY-MM-DD>
- **Deciders:** <who>
- **Context tags:** `area:<…>`, `milestone:<…>`
- **Upstream:** <a related ADR in a system this one depends on, if any>

## Context

The forces at play, and what is actually true — **cite source files for any claim
about a system you do not own**, e.g. `services/<their-service>/src/Middleware.ts:43-85`.
A claim from memory is how a spec ends up shipping contracts that do not exist.

State what we know and what we do not.

## Decision

**The decision, stated plainly in the first sentence.** Then the reasoning.

Rejected alternatives go here, each with why — particularly any that a reasonable
person would re-propose in six months. Naming them is most of what stops the same
argument recurring.

## Consequences

**Positive**
- What becomes easy or safe.

**Negative / risks**
- What becomes hard, and the mitigation.
- Be specific about residual risk. "It is safe *only because* X holds" is exactly
  the sentence that helps whoever changes X later.

## Revisit when

Concrete, observable conditions — the same bar the tooling ledger applies to
triggers. *"When the gateway runs at replicas ≥ 2"*, not *"when we have time"*.

---

<!-- Once ACCEPTED this ADR is BINDING:

     coder     — if a story requires contradicting it, STOP. Do not implement
                 around it. Report the conflict.
     reviewer  — REQUEST_CHANGES on code that violates it, even if the story's
                 own acceptance criteria are satisfied. -->
