# Feature: <name>

<!--
This is the ONLY document you write by hand. Everything downstream is generated
from it. Half a page to two pages. More and you are doing the planner's job;
less and it hallucinates the gaps.

The two sections that carry the most weight are `Scope — out` and `Technical
context`. Skimp on either and the pipeline goes wide and wrong.
-->

## Problem

What is broken or missing today. Who feels it, and how often.

## Users

Primary persona(s). What they are trying to get done.

## Outcome

What is true after this ships that is not true now.

## Success metric

The one number that moves. Baseline → target.

<!-- This is what makes the stories falsifiable. The planner hangs acceptance
     criteria off it. "Improve engagement" is not a metric. -->

## Scope — in

- The capabilities that are in.

## Scope — out

- Explicitly out.

<!-- THE MOST IMPORTANT SECTION. This is what stops the planner inventing epics.
     Without it you get a plausible, sprawling backlog. -->

## Value dependency

Does partial delivery have value, or does nothing land until everything ships?

<!-- Be honest. The planner is instructed to CHALLENGE whatever you say here.
     "Value requires all features" usually means "value TO THE END USER requires
     all features" — and there is still value in a proven contract and a testable
     seam. Most things called all-or-nothing are not. -->

## Technical context

<!-- CRITICAL on a greenfield repo. With no code, the architect cannot detect a
     stack — it must DECIDE one, and this is its evidence. Leave this blank and
     it will raise an ARCH handoff and stop to ask you, which is correct but
     slow. -->

- Existing systems this must integrate with:
- House stack / sibling repos to conform to:
- Hard constraints (must use / must not use):
- Deployment target:
- Team's existing expertise:
- Genuinely open questions:

## Constraints

- Data / compliance:
- Deadline (only if real):

## Open questions

Things you genuinely do not know. The planner should raise these as `ARCH-<n>`
handoffs for the architect rather than guessing at them.
