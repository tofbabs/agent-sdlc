# 0007. `.claude/agentic-sdlc.json` is shared with telemetry consent: one opener, a missing `schema` means 1

- Status: ACCEPTED
- Date: 2026-10-12
- Reversibility: ONE-WAY. Consuming projects that answered the consent prompt
  already have this file committed, with a `telemetry` key and no `schema`.
  Whatever the reader does with those files is what they get on upgrade.
- Amends: ADR-0006 (rules 1 and 3). The rest of ADR-0006 stands.
- Resolves: ARCH-1 of `backlog/EPIC-10.md`.

## Context

ADR-0006 makes `config.mjs` the only code that opens `.claude/agentic-sdlc.json`.
It rejects `schema` other than 1 and warns on unknown keys. It was written before
anyone checked who else already uses the file.

`scripts/consent.mjs` shipped first. It reads and writes the same file under a
`telemetry` key (`{ "share": bool, "terms": int }`) and never writes `schema`.
`/plan` and `/build` call `consent.mjs set` from the consent prompt, and
`export.mjs` calls `readConsent()` from a hook. Its contract is "reads never
throw: a session must not fail because of a bad config file". It also has a
latent bug: `set` on a file with a JSON syntax error parses it as `{}` and
overwrites it, which would erase a project's `plan` settings.

So there are three conflicts. Read literally, ADR-0006 would:

1. reject every consenting project's file, because `schema` is missing, so
   `/plan`'s `check` would stop on upgrade;
2. warn about `telemetry` as an unknown key on every `get`;
3. stop at consent's own reads and writes, because "only `config.mjs` opens the
   file" is already false.

## Options

- **A: Leave consent alone and only exempt it in prose.** This costs nothing
  now. But there are two parsers of one file with different error rules, and
  the clobber bug stays.
- **B: Move consent's file I/O into `config.mjs`, and keep consent's
  fail-soft meaning in `consent.mjs`.** There is one opener and one writer, and
  the clobber bug goes away. Consent keeps its "never throw" reads.
- **C: Have `readConfig()` validate `telemetry` strictly as well.** A
  hand-typed `"share": "yes"` would then stop `/plan`, and the hook read would
  need its own error path. That makes a privacy prompt a blocker for planning.
  Rejected.
- **D: Move consent into a file of its own.** That breaks every project that
  answered, and it needs a migration. Rejected.

## Decision

**B**, with these rules added to ADR-0006:

1. **One opener, one writer.** `config.mjs` is the only module that does file
   I/O on the path. It exports:
   - `readConfig(cwd)`, which is strict, validated and has the defaults applied;
   - `readRaw(cwd)`, which parses only: `null` when the file is missing, and a
     throw on invalid JSON or a non-object root;
   - `updateConfig(cwd, mutate)`, which reads the raw object, applies `mutate`,
     and writes it back as 2-space JSON with a trailing newline.

   `consent.mjs` keeps its `get`/`set` CLI and `readConsent()`, but goes through
   `readRaw()` (inside its existing try/catch, so it stays fail-soft) and
   `updateConfig()`.
2. **A missing `schema` means 1.** Rejection applies only to a `schema` that is
   present and is not the integer 1. Every file written before this ADR keeps
   working.
3. **The writer never destroys what it can't read.** `updateConfig` refuses,
   with a non-zero exit, a message and the file untouched, when the file is
   invalid JSON, its root isn't an object, or `schema` is present and not 1. It
   never writes defaults into the file. A file it creates starts with
   `"schema": 1`. A file without `schema` gets none added, because the edit
   stays minimal.
4. **`telemetry` is a registered top-level key owned by `consent.mjs`.**
   `readConfig()` neither warns about it nor validates its contents, and `get`
   does not serve it. Its meaning, including "a malformed value means
   unanswered, so ask again", lives in `consent.mjs` alone. This is the one
   deliberate exception to ADR-0006 rule 3's "wrong type fails loudly". The
   failure is still visible, because the user is asked again. But it must never
   stop a hook or a `/plan`.
5. A later key with the same needs (one that must be readable by a hook and
   fail soft) follows rule 4. Every other key follows ADR-0006 rule 3.

## Consequences

- Becomes easy: upgrading. A consenting project's file needs no edit, and
  `/plan` reads its `plan` settings next to `telemetry`.
- Becomes easy: there is one place to change the file format, and `consent set`
  can no longer erase settings it couldn't parse.
- Becomes hard: requiring `schema` later. That takes a `schema: 2` and a
  `feat!:`, as ADR-0006 already says for any breaking change.
- `consent set` now fails on an unparseable file where it used to "succeed" by
  erasing it. `consent.test.sh` gains that case.

## Revisit if

- A second hook-time reader needs this file. Then decide whether rule 4 should
  become a general "fail-soft key" flag in `config.mjs` rather than a
  per-key exception.
- Telemetry consent moves to per-developer storage (the brief's rejected
  `settings.local.json` option). Then `telemetry` leaves this file under a
  `schema` bump.
