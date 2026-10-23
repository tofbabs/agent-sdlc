# Changelog

Each entry says what a consuming project must do. Usually nothing.

## [0.2.14](https://github.com/tofbabs/agent-sdlc/compare/v0.2.13...v0.2.14) (2026-10-23)


### Features

* wave core part 1 — brief Issues, selection, /wave start and status [EPIC-11] ([#58](https://github.com/tofbabs/agent-sdlc/issues/58)) ([f50f466](https://github.com/tofbabs/agent-sdlc/commit/f50f4661d5409f4a212f866b99b67029a8249172))
* wave core part 2 — phase lock, classifier, /wave tick [EPIC-12] ([#60](https://github.com/tofbabs/agent-sdlc/issues/60)) ([411f087](https://github.com/tofbabs/agent-sdlc/commit/411f0873a874187e07069757f5657b65b68a445f))


### Documentation

* plan wave core parts 3–4 from the proven wave skill (EPIC-13, EPIC-14) ([#61](https://github.com/tofbabs/agent-sdlc/issues/61)) ([9b5e391](https://github.com/tofbabs/agent-sdlc/commit/9b5e3917dcb178ebde3f065d22c493216cac4af1))

## [0.2.13](https://github.com/tofbabs/agent-sdlc/compare/v0.2.12...v0.2.13) (2026-10-12)


### Features

* **build:** /build resumes an existing feat/&lt;id&gt; [STORY-7-2] ([c89adbf](https://github.com/tofbabs/agent-sdlc/commit/c89adbfcbdcd6847e1b34cf7e4b217d64e33d425))
* **config:** config.mjs reader with the plan key; check and consent use it [STORY-10-1] ([0918dde](https://github.com/tofbabs/agent-sdlc/commit/0918dde60d84044362fe38d1d14b8e6a64eb0522))
* **gh:** REST-only gh [STORY-7-3] ([fffd1ea](https://github.com/tofbabs/agent-sdlc/commit/fffd1eab9c50e439c4e3664f8b2a4bc313c5dde7))
* **plan-artifacts:** /build resumes an existing feat/&lt;id&gt; [STORY-7-2] ([c89adbf](https://github.com/tofbabs/agent-sdlc/commit/c89adbfcbdcd6847e1b34cf7e4b217d64e33d425))
* **plan-artifacts:** plan --id &lt;id&gt; [STORY-7-1] ([4dc2bbf](https://github.com/tofbabs/agent-sdlc/commit/4dc2bbf7150f7481d9ebe8ba5da4d865940868c1))
* **plan:** config covers anchors and the planner's numbers end to end [STORY-10-2] ([02bd271](https://github.com/tofbabs/agent-sdlc/commit/02bd2713ca90bf9a222f373f1e061f42b54609d6))
* **plan:** plan --id &lt;id&gt; [STORY-7-1] ([4dc2bbf](https://github.com/tofbabs/agent-sdlc/commit/4dc2bbf7150f7481d9ebe8ba5da4d865940868c1))
* **review:** consumers read the body verdict [STORY-7-9] ([b25d2b0](https://github.com/tofbabs/agent-sdlc/commit/b25d2b0a3ebed280923c4959ad9bc2926058f32b))
* **review:** explicit reviewer model [STORY-7-4] ([9e4a1c1](https://github.com/tofbabs/agent-sdlc/commit/9e4a1c1adf88e274e535abdd15e91e4872785ce5))
* **review:** review only green heads [STORY-7-5] ([d9ef475](https://github.com/tofbabs/agent-sdlc/commit/d9ef4757512625c1c31b029cdadeb2b3548d23eb))
* **review:** round 1 is complete: BLOCKING tags and body verdict [STORY-7-6] ([278b2f9](https://github.com/tofbabs/agent-sdlc/commit/278b2f9074ff32875ea5dc61ffaf554c0ece9b77))
* **review:** round cap from config, "needs a human" [STORY-7-8] ([7622b96](https://github.com/tofbabs/agent-sdlc/commit/7622b960816d2d817404eda9c65184f150e91d3f))
* **review:** rounds 2+ only re-check [STORY-7-7] ([00dc05d](https://github.com/tofbabs/agent-sdlc/commit/00dc05d6a22b64ed874e8f4382da4a754ff434a6))


### Documentation

* add EPIC-10 plan ([153a912](https://github.com/tofbabs/agent-sdlc/commit/153a91295145c31508497407337588ceb8249773))
* add EPIC-7 plan ([a14bd0a](https://github.com/tofbabs/agent-sdlc/commit/a14bd0ac26f26cbedd4c221de1422ac38a75d945))
* mark EPIC-10 stories done [EPIC-10] ([7890da6](https://github.com/tofbabs/agent-sdlc/commit/7890da6fdfaf6ec01fa439786960be495dd8b974))
* record mode selection [EPIC-10] ([5e62713](https://github.com/tofbabs/agent-sdlc/commit/5e62713e6e129e404b20e22cb3ce4fc0ac4e67ec))


### Build System

* **preflight:** grandfather EPIC-7, planned before the epic size caps [EPIC-7] ([e6ff97b](https://github.com/tofbabs/agent-sdlc/commit/e6ff97b30c41c164bb5243dc89d2cd392d41ed87))

## [0.2.12](https://github.com/tofbabs/agent-sdlc/compare/v0.2.11...v0.2.12) (2026-10-12)


### Features

* **plan-artifacts:** /build stops when a merged dependency is not merged [STORY-9-2] ([f124a42](https://github.com/tofbabs/agent-sdlc/commit/f124a4238fc40aeb0e270903bcdee2c04237828f))
* **plan:** /plan EPIC-n fills in a stub; carry replaces a stub [STORY-9-4] ([f00f059](https://github.com/tofbabs/agent-sdlc/commit/f00f059d67ba347862170434c7a9fe708bb24e10))
* **plan:** planner splits a brief into linked epics; /plan runs check [STORY-9-3] ([eea2545](https://github.com/tofbabs/agent-sdlc/commit/eea2545820e45bf652177a7cb6f155792d182103))
* **plan:** planner splits briefs into linked epics with stubs, fill-in and /build link checks, part 2 of 3 [EPIC-9] ([6a9eef3](https://github.com/tofbabs/agent-sdlc/commit/6a9eef373535d4147bf8a9d6bdc15a6cd3021804))
* **plan:** reference/epic-budget.md, anchors, and pointer-only prose in planner/plan [STORY-9-1] ([0edd8b6](https://github.com/tofbabs/agent-sdlc/commit/0edd8b62d9099631cfa6c3312a059f6247c55e48))


### Bug Fixes

* **plan:** address PR [#52](https://github.com/tofbabs/agent-sdlc/issues/52) review comments [EPIC-9] ([4e1ef4f](https://github.com/tofbabs/agent-sdlc/commit/4e1ef4fac74115e774f3ebea04171c60510a8e7b))


### Documentation

* add EPIC-9 plan ([81d958d](https://github.com/tofbabs/agent-sdlc/commit/81d958d70bd5f1298b772ea637ae58d219684d05))

## [0.2.11](https://github.com/tofbabs/agent-sdlc/compare/v0.2.10...v0.2.11) (2026-10-12)


### Features

* **plan-artifacts:** check rejects over-cap and unsized epics [STORY-8-1] ([5fd815a](https://github.com/tofbabs/agent-sdlc/commit/5fd815ace776de5a01b6de431274ec16393aead3))
* **plan-artifacts:** enforce epic line budget and Depends-on links [STORY-8-2] ([993a4f0](https://github.com/tofbabs/agent-sdlc/commit/993a4f022fa0b62ddf5a72f2d3c0c2e4b92da9bb))
* **plan-artifacts:** epic size budget check, part 1 of 3 [EPIC-8] ([33b2079](https://github.com/tofbabs/agent-sdlc/commit/33b2079826a945ea590aec02e5dee40128db6866))


### Documentation

* add EPIC-6 and EPIC-7 plans, ADR-0005/0006 and open briefs ([356588f](https://github.com/tofbabs/agent-sdlc/commit/356588fcfe6226768a232729dc132819b3a6c025))
* add EPIC-6 and EPIC-7 plans, ADR-0005/0006 and open briefs ([edd2760](https://github.com/tofbabs/agent-sdlc/commit/edd27602e43cfffeef462f04f612a2d5ba0ecde8))
* add EPIC-8 plan ([97bd6ca](https://github.com/tofbabs/agent-sdlc/commit/97bd6ca76b787f2869ac9617c3cdffc49aa590f1))


### Build System

* **preflight:** run plan-artifacts check on epics changed on the branch [STORY-8-3] ([89d85fc](https://github.com/tofbabs/agent-sdlc/commit/89d85fc345db9a2569b66cb55b348c669368ecda))

## [0.2.10](https://github.com/tofbabs/agent-sdlc/compare/v0.2.9...v0.2.10) (2026-10-11)


### Bug Fixes

* **signal-scan:** address review round 1 [EPIC-5] ([93b273c](https://github.com/tofbabs/agent-sdlc/commit/93b273c303619d0da606c055b9c44a9c972e5c75))

## [0.2.9](https://github.com/tofbabs/agent-sdlc/compare/v0.2.8...v0.2.9) (2026-10-11)


### Features

* **agentic-sdlc:** Anonymous repo ID from a salted hash [STORY-4-2] ([5234a3d](https://github.com/tofbabs/agent-sdlc/commit/5234a3d2cf03dc18234387792a024ed37bd3ebc5))
* **agentic-sdlc:** Client identity — registration and token storage [STORY-4-5] ([1a3b9d6](https://github.com/tofbabs/agent-sdlc/commit/1a3b9d65958480ec7dc75f8fe557ef1066e47deb))
* **agentic-sdlc:** Client upload module — zero-dependency, non-blocking, hardened [STORY-4-3] ([be5b93d](https://github.com/tofbabs/agent-sdlc/commit/be5b93d5c40beb9860e68b84cef7abc32f5b38b6))
* **agentic-sdlc:** First-run consent prompt, checked-in config, and documented payload [STORY-4-1] ([53558d8](https://github.com/tofbabs/agent-sdlc/commit/53558d88b2cabead091fcf75d2f7aa613a043460))
* **agentic-sdlc:** Outcome events export [STORY-4-6] ([b1d6705](https://github.com/tofbabs/agent-sdlc/commit/b1d6705f1db35510182dd9e7f3c0e318ef71c572))
* **agentic-sdlc:** Re-consent on schema version change [STORY-4-7] ([1a6531a](https://github.com/tofbabs/agent-sdlc/commit/1a6531af7bccfef9a51c9088838c821a6204ada3))
* **agentic-sdlc:** Storage retention and deletion-on-opt-out [STORY-4-9] ([54e17c6](https://github.com/tofbabs/agent-sdlc/commit/54e17c6ed8d4b644e83f403fe3596da24867bd85))
* **agentic-sdlc:** telemetry export — consented, hardened upload of run reports [EPIC-4] ([8eefb8f](https://github.com/tofbabs/agent-sdlc/commit/8eefb8f73fdaf113e963c630c35e64917239c264))
* **agentic-sdlc:** v1 ingest endpoint — hardened edge validation [STORY-4-8] ([80ca164](https://github.com/tofbabs/agent-sdlc/commit/80ca1649f6140c9d1a2442ba5dbea2318da5e310))
* **agentic-sdlc:** Wire upload into the session lifecycle [STORY-4-4] ([a134085](https://github.com/tofbabs/agent-sdlc/commit/a13408507959bfcb3c29a9ecd05b3af98a8375f8))


### Bug Fixes

* **agentic-sdlc:** address Copilot review on telemetry export [EPIC-4] ([2a80fa1](https://github.com/tofbabs/agent-sdlc/commit/2a80fa174da406c2ec8c551f9846ffeb4b5f7aa9))
* **agentic-sdlc:** hook tests record consent with current terms; test scripts fail on any failing file [EPIC-4] ([c0f0b95](https://github.com/tofbabs/agent-sdlc/commit/c0f0b95397b202bfbe4134175ad0d110beddd7c7))
* meter hook aborts on macOS bash 3.2 when no subagents dir exists ([3469a35](https://github.com/tofbabs/agent-sdlc/commit/3469a35b028cee60c9fbb8155d3050ef91111007))
* meter hook aborts on macOS bash 3.2 when no subagents dir exists ([2cb89fe](https://github.com/tofbabs/agent-sdlc/commit/2cb89fee69095f2223d1f328c4ab61764898164a))


### Documentation

* add EPIC-4 plan ([5313a9e](https://github.com/tofbabs/agent-sdlc/commit/5313a9ed8df16035e595ae8ac56b1314189290b2))

## [0.2.8](https://github.com/tofbabs/agent-sdlc/compare/v0.2.7...v0.2.8) (2026-10-07)


### Features

* **agentic-sdlc:** headless pair-log writes that never hit a permission denial [EPIC-3] ([9e015be](https://github.com/tofbabs/agent-sdlc/commit/9e015beac94b595799dd5924e3e14a99184026e3))
* **agentic-sdlc:** navigator.md and driver.md switch to the new write shape [STORY-3-4] ([ef63f49](https://github.com/tofbabs/agent-sdlc/commit/ef63f494c879723b7d71f1d42778dedf423962b3))
* **agentic-sdlc:** pair-log.mjs accepts the new write shape for state/append/session [STORY-3-2] ([dcc6e6f](https://github.com/tofbabs/agent-sdlc/commit/dcc6e6fb6de263de3ad5671d775a551b5d5c5f16))
* **agentic-sdlc:** pair-run.mjs allows the new shape by default [STORY-3-3] ([c3461b1](https://github.com/tofbabs/agent-sdlc/commit/c3461b13b2a5ec72c1a79d8c1705fa2c4874c727))
* **agentic-sdlc:** Permission denials recorded in pair-run's meter line [STORY-3-1] ([45da0fe](https://github.com/tofbabs/agent-sdlc/commit/45da0fe93dabdb4b3a5f3af9531b75cc57c11bfe))
* **agentic-sdlc:** Sonnet agents use the sonnet alias, not a pinned version ([86723f2](https://github.com/tofbabs/agent-sdlc/commit/86723f29736f8d026114eeef0931af3bf7593390))
* **agentic-sdlc:** Sonnet agents use the sonnet alias, not a pinned version ([855b962](https://github.com/tofbabs/agent-sdlc/commit/855b96277445e4e988aa348dd942a696731dc7b7))


### Bug Fixes

* **agentic-sdlc:** address review round 1 [EPIC-3] ([87eec31](https://github.com/tofbabs/agent-sdlc/commit/87eec310597a033e3aad20bfdd91b79b74e01315))


### Documentation

* add EPIC-3 plan ([78a23f4](https://github.com/tofbabs/agent-sdlc/commit/78a23f4407f7ea27516c68d132b6adecd5d4eb0f))

## [0.2.7](https://github.com/tofbabs/agent-sdlc/compare/v0.2.6...v0.2.7) (2026-10-06)


### Features

* **agentic-sdlc:** /build per-story mode selection via mode-select.mjs [STORY-2-5] ([02ceb7c](https://github.com/tofbabs/agent-sdlc/commit/02ceb7ca90cecb7228dc657a26ff55d5abe2ad34))
* **agentic-sdlc:** /plan lane recommendation and override recording [STORY-2-4] ([6c7f844](https://github.com/tofbabs/agent-sdlc/commit/6c7f8440b368842d05f834f0367b5af0c3135b5d))
* **agentic-sdlc:** decision records with stable IDs [STORY-2-8] ([a9133ed](https://github.com/tofbabs/agent-sdlc/commit/a9133ed6138113bc131222736ad05b90585115d4))
* **agentic-sdlc:** mode selection — deterministic, auditable lane and pairing [EPIC-2] ([00e3562](https://github.com/tofbabs/agent-sdlc/commit/00e35629de9a7c2525b8a5fc2571f2b7c1c6262f))
* **agentic-sdlc:** mode-select.mjs — floors and scoring [STORY-2-3] ([08001a9](https://github.com/tofbabs/agent-sdlc/commit/08001a9890c60e4096672612cc1160332ff1f36c))
* **agentic-sdlc:** navigator on Sonnet by default, Opus by opt-in ([36b1881](https://github.com/tofbabs/agent-sdlc/commit/36b18818c26aea2f2b2c14196d40aeb797a4fab8))
* **agentic-sdlc:** Opus agents use the opus alias, not a pinned version ([24b37c7](https://github.com/tofbabs/agent-sdlc/commit/24b37c750db41909e4b6e261f6bc86ed8b148486))
* **agentic-sdlc:** outcome events, outcome sweep, and verdict rules [STORY-2-9] ([66bb632](https://github.com/tofbabs/agent-sdlc/commit/66bb632ad46f96df5a943d3ef8e4cdc639032332))
* **agentic-sdlc:** per-agent model overrides; architect on Opus ([3a71675](https://github.com/tofbabs/agent-sdlc/commit/3a716756452b1491ec6cda07b624ee0f4db604da))
* **agentic-sdlc:** per-agent model overrides; navigator on Sonnet, architect on Opus ([b7e94e3](https://github.com/tofbabs/agent-sdlc/commit/b7e94e3e60d277022d97e7de4a8b92a9b36d010d))
* **agentic-sdlc:** planner emits selection fields instead of the risk: line [STORY-2-2] ([8d9eb33](https://github.com/tofbabs/agent-sdlc/commit/8d9eb33d89abe0c09124e87424eeb91c211c560b))
* **agentic-sdlc:** runtime correction — PAIR to SOLO, and FAST to deliberate [STORY-2-7] ([a59aeec](https://github.com/tofbabs/agent-sdlc/commit/a59aeec0ebc4aa5c8731c4d4ac49708a504008e7))
* **agentic-sdlc:** runtime correction — SOLO to PAIR escalation [STORY-2-6] ([8d24b13](https://github.com/tofbabs/agent-sdlc/commit/8d24b13ada599b51924f458c399919186c778d2d))
* **agentic-sdlc:** selection-field schema module [STORY-2-1] ([da3d8fc](https://github.com/tofbabs/agent-sdlc/commit/da3d8fc0d310d9fb0b472ac9bcc132444257d60a))


### Bug Fixes

* **agentic-sdlc:** address PR [#36](https://github.com/tofbabs/agent-sdlc/issues/36) review — outcome attribution, report contract, dispatch [EPIC-2] ([3cf0a5f](https://github.com/tofbabs/agent-sdlc/commit/3cf0a5f29685d1832ddf42dac19b66e144efd4c2))
* **agentic-sdlc:** only the coder escalates; model checks require a clean run ([716c147](https://github.com/tofbabs/agent-sdlc/commit/716c14751dacbbda6537280c5cfa0fc800a784fb))
* **agentic-sdlc:** pair logs are local scaffolding, never committed [STORY-2-10] ([d77734c](https://github.com/tofbabs/agent-sdlc/commit/d77734cfded74f6ddc4d9bf2f551b7b383b1a13a))


### Documentation

* add EPIC-2 plan ([4a14cf5](https://github.com/tofbabs/agent-sdlc/commit/4a14cf57fec2b6df3468a6223c31dbde3b9ca42f))
* mark EPIC-2 stories done [EPIC-2] ([3603501](https://github.com/tofbabs/agent-sdlc/commit/36035012dbdeaf493c79621cd98ab8ea0631d565))

## [0.2.6](https://github.com/tofbabs/agent-sdlc/compare/v0.2.5...v0.2.6) (2026-10-06)


### Features

* **agentic-sdlc:** category vocabulary module [STORY-1-1] ([e2a87df](https://github.com/tofbabs/agent-sdlc/commit/e2a87df220d5d8c5dda216d6decdc02325dbafcc))
* **agentic-sdlc:** lifecycle hook and end-to-end report [STORY-1-6] ([2b3dcc2](https://github.com/tofbabs/agent-sdlc/commit/2b3dcc2a53e9c8eec9ba833a078162fb995c8202))
* **agentic-sdlc:** run report — a code-free decision trace per run [EPIC-1] ([f137b57](https://github.com/tofbabs/agent-sdlc/commit/f137b57c94fa10e18c82ef6960f9b54a7b158c35))
* **agentic-sdlc:** run-report.mjs — build section [STORY-1-3] ([325fa48](https://github.com/tofbabs/agent-sdlc/commit/325fa48f703785e328f0fd2dc7aadffab44231c8))
* **agentic-sdlc:** run-report.mjs — debt section [STORY-1-5] ([fc357ac](https://github.com/tofbabs/agent-sdlc/commit/fc357ac95beec7a35cf4926c5b3669681d47ba79))
* **agentic-sdlc:** run-report.mjs — review section [STORY-1-4] ([4a2cbb7](https://github.com/tofbabs/agent-sdlc/commit/4a2cbb768f424056a986cfb3c8a071b77fbf5513))
* **agentic-sdlc:** run-report.mjs — run, plan and cost sections [STORY-1-2] ([c7e5f81](https://github.com/tofbabs/agent-sdlc/commit/c7e5f81218f93786b126d825020df0d0a23d4237))


### Bug Fixes

* **agentic-sdlc:** stop a stale detached run report from clobbering newer state ([cdf75f1](https://github.com/tofbabs/agent-sdlc/commit/cdf75f1258cf8aca4731da74cc80bf1032804517))


### Documentation

* add EPIC-1 plan ([41b2fc5](https://github.com/tofbabs/agent-sdlc/commit/41b2fc5b91f43d5268907ce1e556d63196f7952a))
* mark EPIC-1 stories done [EPIC-1] ([5438826](https://github.com/tofbabs/agent-sdlc/commit/5438826d2e28e3ec1a428af38b7723b9d366931c))

## [0.2.5](https://github.com/tofbabs/agent-sdlc/compare/v0.2.4...v0.2.5) (2026-10-06)


### Features

* **agentic-sdlc:** cut TDD pair-loop cost — scripted loop, pair by risk, one behaviour per round ([6c34406](https://github.com/tofbabs/agent-sdlc/commit/6c34406b3de7222cbc8797b5ec27545753162069))
* **agentic-sdlc:** script the pair loop, pair by risk, one behaviour per round ([b31f8d5](https://github.com/tofbabs/agent-sdlc/commit/b31f8d5085575e509d060720b876b11e9f877de6))


### Bug Fixes

* **agentic-sdlc:** say pair-log read is the only log read, not the whole context ([4e38524](https://github.com/tofbabs/agent-sdlc/commit/4e38524041abf8da156d83629d65ca48292b21f7))

## [0.2.4](https://github.com/tofbabs/agent-sdlc/compare/v0.2.3...v0.2.4) (2026-09-27)


### Features

* **agentic-sdlc:** code comments say why, never what ([ade4aad](https://github.com/tofbabs/agent-sdlc/commit/ade4aad4fd38056004e915c100a03131aefb37dc))
* **agentic-sdlc:** code comments say why, never what ([90d57f1](https://github.com/tofbabs/agent-sdlc/commit/90d57f1f2245fb6b2f20675dd208bdd6951d16a5))

## [0.2.3](https://github.com/tofbabs/agent-sdlc/compare/v0.2.2...v0.2.3) (2026-09-27)


### Bug Fixes

* **agentic-sdlc:** claim backlog IDs across worktrees and carry plans onto build branches ([6a38edb](https://github.com/tofbabs/agent-sdlc/commit/6a38edb3f3d014f0ac2caee4f6ce302aa9ffc962))
* **agentic-sdlc:** claim backlog IDs across worktrees and carry plans onto build branches ([0d160ec](https://github.com/tofbabs/agent-sdlc/commit/0d160ece3431f75308fc9f001bb0956c9570e1d6))

## [0.2.2](https://github.com/tofbabs/agent-sdlc/compare/v0.2.1...v0.2.2) (2026-09-18)


### Features

* **agentic-sdlc:** add token meter + quality benchmark foundation; land no-risk cost cuts ([fb4893f](https://github.com/tofbabs/agent-sdlc/commit/fb4893f8f9b97fdc7616907a0435bc4c20d7fcd3))
* **agentic-sdlc:** add token meter + quality benchmark foundation; land no-risk cost cuts ([462ad96](https://github.com/tofbabs/agent-sdlc/commit/462ad969ad8e8c74d93953850731844d738601c6))

## [0.2.1](https://github.com/tofbabs/agent-sdlc/compare/v0.2.0...v0.2.1) (2026-09-17)


### Features

* **agentic-sdlc:** land every story as one squash commit on the epic branch; configurable base branch ([5083d69](https://github.com/tofbabs/agent-sdlc/commit/5083d69f59ca19e9991f2bf5856060ee03751599))
* **agentic-sdlc:** land every story as one squash commit on the epic branch; configurable base branch ([bd4c9d4](https://github.com/tofbabs/agent-sdlc/commit/bd4c9d4489b9dc36864f41f49a6770fc695f18e3))

## [0.2.0](https://github.com/tofbabs/agent-sdlc/compare/v0.1.7...v0.2.0) (2026-09-11)


### ⚠ BREAKING CHANGES

* the marketplace namespace is renamed from kodobe-sdlc to sanimara. Consuming projects must update .claude/settings.json -- the extraKnownMarketplaces key (kodobe-sdlc -> sanimara) and the enabledPlugins key (agentic-sdlc@kodobe-sdlc -> agentic-sdlc@sanimara) -- and re-install. The plugin name and version pins are unchanged.

### Features

* relicense MIT and rebrand kodobe-sdlc -&gt; sanimara ([6638259](https://github.com/tofbabs/agent-sdlc/commit/663825946977e0391bdda58e9aabda06917ab9ab))

## [0.1.7](https://github.com/tofbabs/agent-sdlc/compare/v0.1.6...v0.1.7) (2026-09-11)


### Documentation

* add LSP preflight SessionStart hook template ([39d1fa9](https://github.com/tofbabs/agent-sdlc/commit/39d1fa91e694f3da009e20d24ed9d9a8d21ba0a5))

## [0.1.6](https://github.com/tofbabs/agent-sdlc/compare/v0.1.5...v0.1.6) (2026-09-11)


### Documentation

* reframe README around audience, quality ladder, token gains and roadmap ([2d861a2](https://github.com/tofbabs/agent-sdlc/commit/2d861a20a25c11d546887e6bf16984cf2157de86))
* rewrite and restructure README into focused docs + add CONTRIBUTING ([50384bf](https://github.com/tofbabs/agent-sdlc/commit/50384bf7d5888f96a1a5d912fed97f1278f88934))
* split README into focused docs and add CONTRIBUTING ([c17e84d](https://github.com/tofbabs/agent-sdlc/commit/c17e84d277265733a59b834f4b66f92f4d0edbb6))

## [0.1.5](https://github.com/tofbabs/agent-sdlc/compare/v0.1.4...v0.1.5) (2026-09-11)


### Features

* **agentic-sdlc:** add code-reviewer agent and /review command ([e843852](https://github.com/tofbabs/agent-sdlc/commit/e8438524b66fce968b5d4d016960de28962de08a))
* **agentic-sdlc:** add code-reviewer agent and /review command ([994cd9d](https://github.com/tofbabs/agent-sdlc/commit/994cd9d8537a3f0eba3e591d35e03f0bb10599f5))
* **agentic-sdlc:** add the --fast lean lane, gated by a negative-test floor ([f6c0e6e](https://github.com/tofbabs/agent-sdlc/commit/f6c0e6ea1ff18f33faf93d3adfa4adeb849c1d66))
* **agentic-sdlc:** add the --fast lean lane, gated by a negative-test floor ([a6bab4b](https://github.com/tofbabs/agent-sdlc/commit/a6bab4bb01d9f65ec045b0a396f06969e632f558))
* **agentic-sdlc:** make agents navigate code with LSP, not grep ([9250024](https://github.com/tofbabs/agent-sdlc/commit/925002485ca133ff42036946265a91e40a4727e4))
* **agentic-sdlc:** make agents navigate code with LSP, not grep ([7f31742](https://github.com/tofbabs/agent-sdlc/commit/7f317420c116bfd3b9b6df049f3d1f4542a5bcb6))

## [0.1.4](https://github.com/kodobe/agent-sdlc/compare/v0.1.3...v0.1.4) (2026-08-24)


### Features

* **agentic-sdlc:** load PAIR and REVISE protocols on demand, bound the epic file ([4214d92](https://github.com/kodobe/agent-sdlc/commit/4214d92d6a7ee343c0f80d5967ee55dd2648cff4))
* **agentic-sdlc:** load PAIR and REVISE protocols on demand, bound the epic file ([8b81d5a](https://github.com/kodobe/agent-sdlc/commit/8b81d5a015223de1962732debffcea8e807dcc7f))

## [0.1.3](https://github.com/kodobe/agent-sdlc/compare/v0.1.2...v0.1.3) (2026-07-31)


### Features

* **build:** enforce pair-log carryover limits in code, not prose ([aa05bb8](https://github.com/kodobe/agent-sdlc/commit/aa05bb8cfc993dbf4f800d5ff416fbd86567e573))
* **build:** enforce pair-log carryover limits in code, not prose ([f9c5d46](https://github.com/kodobe/agent-sdlc/commit/f9c5d46e3c23db02fe9f1bf6c159163905fb7fb7))


### Bug Fixes

* **build:** stop pair stories costing O(alternations squared) ([27aed0a](https://github.com/kodobe/agent-sdlc/commit/27aed0a4195e77ee94b0e8883a3360fe694de028))
* **build:** stop pair stories costing O(alternations squared) ([445503d](https://github.com/kodobe/agent-sdlc/commit/445503d593b061785fd82b86e164a6fa9161beb8))


### Documentation

* **build:** design for cutting pair-log carryover cost ([827f020](https://github.com/kodobe/agent-sdlc/commit/827f020509ce7d2dd44aa504b45ea5b51aa69afa))

## [0.1.2](https://github.com/kodobe/agent-sdlc/compare/v0.1.1...v0.1.2) (2026-07-29)


### Features

* **agents:** add navigator agent and TDD pairing mode ([3e5405f](https://github.com/kodobe/agent-sdlc/commit/3e5405f859af31645e3e79e2e7671ff5fb1dc612))
* **agents:** add navigator agent and TDD pairing mode ([660bbe2](https://github.com/kodobe/agent-sdlc/commit/660bbe278fe0f65829a6a01e170f433623c062b2))


### Bug Fixes

* resolve plugin-namespaced agent names from /plan and /build ([d2e0980](https://github.com/kodobe/agent-sdlc/commit/d2e0980fde58428043872781c16ee97d8cf501a4))
* resolve plugin-namespaced agent names from /plan and /build ([243e36c](https://github.com/kodobe/agent-sdlc/commit/243e36cd9ccb924a0e031dd648e9d92b5b0e19fe))

## 0.1.1 — 2026-07-29

**Supersedes 0.1.0. Do not pin 0.1.0** — it shipped a stale `/build` and a README
pointing at a repository that does not exist. It is left on the remote rather than
retagged, because rewriting a published tag is the failure this repo exists to
prevent.

**Fixed**

- `commands/build.md` re-synced from `reward-fulfillment-app` (88 → 192 lines).
  0.1.0 was cut against a copy taken minutes before the source gained the
  epic-branch cascade: waves off `feat/EPIC-<n>`, sub-worktrees merged back
  `--no-ff`, the `#77` add/add analysis, and the rule that the epic PR is
  merge-committed rather than squashed so release-please still sees per-package
  scopes. Pinning 0.1.0 would have handed a project the pre-cascade `/build`.
- README install snippets point at `kodobe/agent-sdlc`, the actual repository.

**Noted, not fixed** — see the 0.1.0 known-issues list below, which still applies.
It gained one entry: `agents/coder.md` and `commands/build.md` now disagree about
whether the coder opens a PR.

> The gap between 0.1.0 and 0.1.1 is roughly forty minutes, and drift caused it.
> That is the argument for this repo, made faster than expected.

## 0.1.0 — 2026-07-29

Initial extraction from `reward-fulfillment-app/.claude/`, **verbatim**. The
agents and commands are byte-identical to what MyJara was running, so upgrading
MyJara to this release is a plumbing change with no behavioural change. That is
the point of the release: prove distribution works before changing meaning.

**Added**

- `agentic-sdlc` plugin: `planner`, `architect`, `coder` agents; `/plan` and
  `/build` commands.
- `templates/` — tooling-debt ledger, epic template, the two cloud-routine
  prompts, and a permissions baseline covering the three deny categories that are
  wrong in every project.

**Consuming projects must**

- Add `extraKnownMarketplaces` + `enabledPlugins` to `.claude/settings.json`
  (see README).
- **Delete local `.claude/agents`, `.claude/commands` and any symlinks to them.**
  A local copy is where drift starts.
- Keep their own `permissions.deny` — plugins do not contribute permissions.

**Known issues, deliberately carried forward**

- `agents/coder.md` still describes the pre-cascade flow: branch from `main` with
  `git checkout -b feat/<STORY-ID>`, then `gh pr create` and report the PR number.
  `commands/build.md` now branches stories off the **epic** branch and instructs
  the coder to "Commit; do NOT open a PR". The command's prompt overrides at
  runtime so `/build` behaves correctly, but the agent file misleads anyone
  invoking `coder` directly, and the two files shipped together disagree.
  **Reconcile in 0.2.0** — the agent should describe committing to the branch it
  was given, and leave PR policy to the command.
- `commands/plan.md` step 1 says "Planner is on 4.7". The `planner` agent is on
  Sonnet 5 and 4.7 is not in the current model range. It is a stale comment with
  no runtime effect — the agent's own frontmatter is what selects the model — but
  it contradicts the agent file shipped beside it. Left as-is to keep 0.1.0 a
  faithful copy. **Fix in 0.2.0.**
- Roughly twenty hard-coded project paths (`backlog/`, `docs/adr/`,
  `docs/TOOLING-DEBT.md`) and one hard-coded check command
  (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, `agents/coder.md`)
  are baked into the prompts. They are sensible defaults and match MyJara exactly;
  the `pnpm` line is the only one that would be actively wrong elsewhere.
  **Generalise in 0.2.0**, before onboarding a second project.
