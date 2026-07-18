---
name: fuzz
description: Fuzz React Doctor rules for crashes, slowness, false positives, and mutation-sensitive diagnostics with @react-doctor/fuzz. Use after rule tests pass, when investigating a fuzz finding, or whenever an eval, review, or user report confirms a new false positive.
---

# Fuzz rules

Use `packages/fuzz` after focused rule tests pass. Read its `README.md` for harness architecture and corpus setup.

## Run the harness

Run the target rule first:

```sh
FUZZ_RULE=<rule-id> FUZZ_STRICT=1 FUZZ_ITERATIONS=500 nr fuzz
```

Useful variants:

```sh
nr fuzz
FUZZ_RULE=<rule-id> FUZZ_SEED=42 nr fuzz
FUZZ_INVARIANTS=1 nr fuzz
FUZZ_CORPUS_DIR=<repository-directory> nr fuzz
FUZZ_RULE=<rule-id> FUZZ_PRINT_SILENT=1 nr fuzz
```

Confirm that the target rule fires. A silent rule only exercises early exits. If it stays silent, add a triggering shape to `packages/fuzz/src/snippet-pools.ts` and rerun.

Run the direct false-positive check when a rule change affects common syntax:

```sh
cd packages/fuzz
bun scripts/hunt-false-positives.ts
```

## Triage findings

Reproducers live in `packages/fuzz/tmp/fuzz-findings/`.

- **Crash**: minimize the program, add a no-throw regression test, fix the rule, and replay the seed
- **Slow case**: profile the pathological shape, bound the walk, and keep the existing threshold
- **Verdict drop**: fix detection that depends on incidental syntax, then add the rule to the robustness gate when appropriate
- **Invariant violation**: decide whether the rule should react to the rewrite; fix and test unexpected changes
- **False positive**: add the valid program to the rule tests and fuzz regression corpus

Replay one finding:

```sh
FUZZ_RULE=<rule-id> FUZZ_SEED=<seed> FUZZ_ITERATIONS=1 nr fuzz
```

## Preserve false positives

For every confirmed false positive:

1. Add a minimal fixture to `packages/fuzz/corpus/regressions/<rule-id>--<slug>.tsx`.
2. Include the rule ID, weakness class, and source in the fixture header.
3. Add a focused valid case to the rule test suite.
4. Add a generator snippet when the existing pools cannot produce the weakness.
5. Run `nr -C packages/fuzz test` and replay the target rule.

Use a stable weakness name such as `library-idiom`, `control-flow`, `wrapper-transparency`, `name-heuristic`, `alias-guard`, `cross-file`, `framework-gating`, `paren-shape`, `default-parameter`, `dynamic-computed`, `private-member`, or `copy-tracking`.

Project-level dead-code and dependency findings belong in core tests, not the rule fuzzer.

## Report results

Record the command, target-rule fire count, findings, replay seeds, corpus fixtures, and generator changes. Pass confirmed implementation findings to `rule-validate`.
