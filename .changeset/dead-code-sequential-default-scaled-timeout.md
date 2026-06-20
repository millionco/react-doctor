---
"@react-doctor/core": patch
"react-doctor": patch
"deslop-js": patch
---

Run dead-code analysis sequentially by default and scale its timeout to the repo size — fixing a silent drop of all dead-code findings on large supply-chain scans.

Dead-code (deslop reachability) is CPU-bound, like the oxlint lint pass. Running them concurrently oversubscribed the cores: deslop's parse pool and the oxlint pool each size to all cores, so together they demanded ~2x the cores, thrashed, and the parse pass missed its in-worker timeout. On a large repo (where the pass already runs near the cap) the supply-chain pass bleeding into the dead-code phase was enough to tip it over, and the fail-open path then silently dropped EVERY dead-code finding — observed dropping all ~349 findings on ~2/3 of supply-chain-on Sentry scans, with no user-visible error.

Dead-code now runs strictly after lint with the full core budget — fastest per-phase and never oversubscribed (overlapping two CPU-bound passes buys no wall-clock anyway). `REACT_DOCTOR_DEAD_CODE_OVERLAP=on` still forces the overlap, but the two pools now SPLIT the core budget — deslop's parse pool is capped via the new `DESLOP_PARSE_CONCURRENCY` env and lint shrinks to the remainder — so they sum to the cores instead of doubling them.

The dead-code phase + in-worker timeouts now scale with the project's source-file count (and inversely with the dead-code core share when overlapped) instead of a flat cap, so a large repo's legitimately-long pass isn't reclaimed before it finishes; the ceiling still reclaims a genuinely wedged worker, and an explicit `REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS` override is honored verbatim. This supersedes the previous memory-gated dead-code overlap and replaces the flat dead-code phase cap with the size-scaled budget.
