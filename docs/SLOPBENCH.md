# SlopBench — methodology

SlopBench (in [`packages/benchmark`](../packages/benchmark)) measures how good a
model is at frontend engineering, with a deliberate focus on **how much React /
TypeScript slop it emits**. It extends the DeepSWE / Harbor approach with a
second, continuous quality axis.

## Why two axes

Correctness-only benchmarks reward a working feature regardless of how it was
built. Real frontend review cares about both: does it work, *and* is it clean?
SlopBench keeps a hard **functional gate** (hidden behavioral tests) and adds a
**slop score** computed purely by static analysis on the diff:

```
reward = functional_pass × (slop_score / 100)
```

- `functional_pass ∈ {0,1}` — the DeepSWE-style gate.
- `slop_score ∈ [0,100]` — higher = cleaner.

Reporting both separately (plus per-dimension subscores) lets a leaderboard rank
by correctness, by cleanliness, or by the product. Setting the slop weight to
zero recovers a pure correctness benchmark.

## How the slop score is computed

The verifier (`slop-verify`, the `@react-doctor/benchmark` package) runs
**offline** over the agent's diff against the task's base commit:

1. **React Doctor** (`--json --no-score --no-dead-code`) — the canonical React
   diagnostic engine, scoped to the files the agent changed. Its five categories
   map to the `react-correctness`, `react-performance`, `accessibility`, and
   `maintainability` dimensions; specific bundle/waterfall rules are rerouted to
   the `bundle` and `async-waterfall` dimensions.
2. **TypeScript strictness** (AST, no type-checker needed) — explicit `any`,
   `as` casts, non-null `!`, and `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error`.
3. **Composition** (AST, distilled from Vercel's composition-patterns) —
   boolean-prop soup and function-valued render props.
4. **deslop heuristic** — nested ternaries.

Each finding is weighted `severity × category × rule-impact`, the per-dimension
penalty is **size-normalized** by the diff's added lines (so large legitimate
features are not punished as hard as the same violations in a tiny diff), and
each dimension scores `clamp(100 − penalty, 0, 100)`. The composite is the
profile-weighted mean across dimensions.

Every number lives in [`scoring-profiles/default.json`](../packages/benchmark/scoring-profiles/default.json)
(mirrored by `src/constants.ts`); the `scoringVersion` is stamped into every
report so scores are reproducible and comparable.

### Why local scoring (not the react.doctor score API)

React Doctor's canonical 0–100 score is a remote API call. Benchmark grading is
**air-gapped** (`allow_internet = false`), so SlopBench computes its own
deterministic score from the offline `diagnostics[]`. The remote API is never on
the grading path.

## Reference influences

The dimensions and checks are grounded in:

- **React Doctor rules** — the React correctness/performance/a11y/security engine.
- **deslop skill** — indirection, dead code, nested ternaries, near-duplicates.
- **Vercel [react-best-practices]** — waterfalls, bundle, re-render, rendering tiers.
- **Vercel [composition-patterns]** — boolean-prop soup, render-props, compound components.
- **Vercel [next-best-practices]** — RSC boundaries, async APIs, `next/image`, bundling.

To avoid double-counting, [`rule-overlap.md`](../packages/benchmark/rule-overlap.md)
records which tool owns each signal; SlopBench only adds checks for gaps React
Doctor does not already cover (TS strictness + composition).

[react-best-practices]: https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices
[composition-patterns]: https://github.com/vercel-labs/agent-skills/tree/main/skills/composition-patterns
[next-best-practices]: https://github.com/vercel-labs/next-skills#next-best-practices

## Task families

- **produce-clean** — implement a working feature; slop is measured on the diff.
  Measures the slop a model emits *unprompted* (the instruction never mentions
  quality).
- **handle-slop** — the seed ships working-but-sloppy code; a small change is
  requested. Measures whether the model *adds* slop or cleans what it touches.
- **explicit-deslop** *(v2)* — the instruction asks to clean up while preserving
  behavior; isolates capability from inclination.

## Anti-gaming

- Scanners run over the whole diff, not a fixed file the agent can target.
- Suppression escape hatches (`@ts-ignore`, eslint-disable-style comments) are
  themselves scored as slop.
- Tests, fixtures, generated files, and lockfiles are excluded from grading, so
  an agent neither earns credit for tests nor is charged for vendored slop.
- Hidden tests are applied only at grade time.

## Reproducibility

- React Doctor + the verifier are installed from a single pinned checkout in the
  base image (`tasks/_base/Dockerfile`); pin `REACT_DOCTOR_REF` for a release.
- `doctorVersion` + `scoringVersion` are recorded in every `slop-report.json`.
- `scripts/validate-all.sh` asserts every task's reference solution still passes
  and scores `reward > 0` — run it before cutting a benchmark release.

See [`packages/benchmark/README.md`](../packages/benchmark/README.md) for the run
and authoring workflow.
