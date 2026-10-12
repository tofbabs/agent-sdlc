Loaded by `/review` on demand; the rules a review round follows beyond the command itself.

## CI gate

`scripts/ci-state.mjs` reads the head's REST check-runs payload and prints one
JSON line: `{"state":"green|pending|red|none","failing":[...],"pending":[...]}`.

- **pending** (any run not `completed`): report "waiting on CI". Post no round,
  spawn nothing, create no worktree.
- **red** (any `completed` run concluding `failure`, `timed_out`, `cancelled`,
  `action_required` or `startup_failure`): report "CI red: <failing jobs>".
  Post nothing. Red wins over pending, since a failed job already decides it.
- **green** (all completed; `success`, `neutral` and `skipped` are not
  failures): proceed to step 2. Pass `CI: green` to the reviewer.
- **none** (zero checks reported): assume green, proceed, and pass
  `CI: none reported (assumed green)` so the reviewer notes it.

The command does not poll or retry; the next invocation re-reads CI.
