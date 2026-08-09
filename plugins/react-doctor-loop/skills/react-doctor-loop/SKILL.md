---
name: react-doctor-loop
description: Continuously audit and fix confirmed React Doctor false-positive root-cause cohorts with Codex plan inference, exact benchmark evidence, fuzz regressions, local RDE parity, and review-only draft pull requests. Use when asked to run the React Doctor loop, mine ReactBench for false positives, harden a rule from benchmark evidence, or prepare repeated [loop] draft PRs without merging.
---

# React Doctor Loop

Run one gold path. Codex owns the reasoning; hooks enforce the boundaries.

## Start

1. Confirm `codex login status` says ChatGPT. Never use an API key, provider fallback, account rotation, or `codex exec`.
2. Read `AGENTS.md` and these repository skills in full:
   - `.agents/skills/benchmark-fp-fn-audit/SKILL.md`
   - `.agents/skills/find-similar-functions/SKILL.md`
   - `.agents/skills/rule-research/SKILL.md`
   - `.agents/skills/rule-writing/SKILL.md`
   - `.agents/skills/fuzz/SKILL.md`
   - `.agents/skills/run-parity/SKILL.md`
   - `.agents/skills/rule-validate/SKILL.md`
3. Read the complete rule catalog at `https://www.react.doctor/docs/rules`.
4. Use the benchmark and RDE paths named by those skills. Do not edit either corpus.
5. Fetch `origin/main`, create a fresh `loop/<rule>-<cohort>` branch from it, and handle one semantic root-cause cohort.

## Audit

Recompute from raw artifacts. Treat a cohort as a shared detector mistake, not every changed line or repeated callsite. Reverify every lead against current `origin/main`; close already-fixed or stale findings without editing.

For a confirmed cohort, record exact trials, files, spans, before/after diagnostics, task behavior, tests, the documented rule contract, and a nearby true-positive counterexample. Prioritize by affected-trial coverage, confidence, and reproducibility.

## Fix

Implement the narrowest detector change that explains the entire cohort. Search with truffler before and after. Add exact real-callsite regressions, adversarial true-positive controls, a deduplicated fuzz fixture, and a patch changeset. Do not weaken sibling cases or edit generated, benchmark, action, release, authentication, or loop-plugin files.

## Prove

Run in this order:

1. Focused rule tests while tuning the proof boundary.
2. Exact downloaded-job replay and a coverage ledger proving every cohort membership is represented with no missing or extra entries.
3. `FUZZ_RULE=<rule> FUZZ_STRICT=1 FUZZ_ITERATIONS=500 nr fuzz`, the deterministic fuzz tests, and the full fuzz suite.
4. `nr test`, `nr lint`, `nr typecheck`, and `nr format:check`.
5. Daytona parity against the exact PR base and head commits through `.agents/skills/run-parity/SKILL.md`. Reuse only a validated, exact-commit baseline cache; otherwise use its paired path. Inspect every added diagnostic, removed diagnostic, skipped project, and failure. A comparison exit code of `1` is expected for the intended removal.

Invoke each evaluator run through `node "$PLUGIN_ROOT/scripts/run-daytona-eval.mjs" <eval arguments>`. That wrapper reads only `DAYTONA_API_KEY` from the primary checkout's `.env.local`, strips every other credential from the child environment, preserves evaluator cleanup, and allows at most two bounded runs per UTC day. Never read, print, source, or copy `.env.local` yourself.

## Publish

Commit only the cohort fix. Push only the `loop/*` branch. Open a draft PR with a `[loop]` title and a body containing the root cause, scope boundary, cohort coverage, exact commands, parity interpretation, and the statement that maintainer approval is required.

Never mark the PR ready, merge, publish, tag, release, or modify authentication. Run `node "$PLUGIN_ROOT/scripts/complete.mjs" <rule> <cohort> <evidence.json> <parity.json>` after the draft PR exists. The Stop hook continues to the next cohort only after that command verifies the branch, evidence, parity, and draft PR.
