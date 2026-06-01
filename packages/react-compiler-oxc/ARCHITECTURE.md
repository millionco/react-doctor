# Architecture

This document is the deep reference for `react-compiler-oxc` — a Rust + [oxc](https://oxc.rs)
reimplementation of the React Compiler (`babel-plugin-react-compiler`, vendored at
`../react-compiler/src`). It covers the four-IR pipeline and every pass in order,
the TypeScript ↔ Rust file mapping, the parity methodology, the test-harness map,
and an honest analysis of the known limitations.

For a quick start (build/test/run, public API, status), see
**[README.md](./README.md)**.

---

## The four IRs

The compiler lowers JavaScript/TypeScript through four representations:

```
oxc AST  ──lower──▶  HIR  ──BuildReactiveFunction──▶  ReactiveFunction  ──codegen──▶  compiled JS
         (BuildHIR)       (CFG of basic blocks)                          (nested scope tree)
```

1. **oxc AST** — the parsed source (oxc's typed AST, TS + JSX source type).
2. **HIR** (High-level IR) — a control-flow graph of basic blocks; instructions are
   in SSA form after `EnterSSA`. Lives in `src/hir/`.
3. **ReactiveFunction** — a nested tree of reactive scopes, statements, and
   terminals built from the HIR CFG. Lives in `src/reactive_scopes/`.
4. **Output JS** — assembled as an oxc `Program` and printed via `oxc::codegen`.
   JSX is preserved verbatim (the compiler does not lower JSX).

---

## Pipeline map (~40 stages, in order)

The canonical stage list is `STAGE_ORDER` in `src/passes/mod.rs`. `compile_to_stage`
runs the pipeline up to any named stage. Stages 1–27 operate on the HIR; stage 27
(`BuildReactiveFunction`) converts to the ReactiveFunction IR; stages 28–40 are
ReactiveFunction passes; codegen follows.

### Stage 1 — Lowering (oxc AST → HIR)

| # | Stage | Rust module | Purpose |
| --- | --- | --- | --- |
| 1 | `HIR` | `build_hir/` | Parse oxc AST → HIR (basic blocks, instructions, terminals). Raw lowering output. |

### Stages 2–3 — Cleanup (HIR)

| # | Stage | Rust module | Purpose |
| --- | --- | --- | --- |
| 2 | `DropManualMemoization` | `passes/drop_manual_memoization.rs` (+ `prune_maybe_throws.rs`) | Rewrite `useMemo` / `useCallback` to their bodies; remove unreachable code after throw. |
| 3 | `MergeConsecutiveBlocks` | `passes/merge_consecutive_blocks.rs` (+ `inline_iife.rs`) | Inline IIFEs; fold blocks joined by trivial gotos. |

### Stages 4–8 — SSA & optimization (HIR)

| # | Stage | Rust module | Purpose |
| --- | --- | --- | --- |
| 4 | `SSA` | `passes/enter_ssa.rs` | Rename to SSA form, insert phi nodes. |
| 5 | `EliminateRedundantPhi` | `passes/eliminate_redundant_phi.rs` | Remove trivial phis. |
| 6 | `ConstantPropagation` | `passes/constant_propagation.rs` | SCCP: constant folding + conditional pruning. |
| 7 | `InferTypes` | `type_inference/infer_types.rs` | Unification-based type inference. |
| 8 | `OptimizePropsMethodCalls` | `passes/optimize_props_method_calls.rs` | Simplify the `.call(this, …)` pattern. |

### Stages 9–14 — Mutation / aliasing / reactivity analysis (HIR)

| # | Stage | Rust module | Purpose |
| --- | --- | --- | --- |
| 9 | `AnalyseFunctions` | `passes/analyse_functions.rs` | Traverse nested functions; record scope use. |
| 10 | `InferMutationAliasingEffects` | `passes/infer_mutation_aliasing_effects.rs` (+ `_signature.rs`, `_apply.rs`) | Compute mutation/aliasing signatures. |
| 11 | `DeadCodeElimination` | `passes/dead_code_elimination.rs` | Remove unused assignments. |
| 12 | `InferMutationAliasingRanges` | `passes/infer_mutation_aliasing_ranges.rs` | Infer lifetime ranges of mutable values. |
| 13 | `InferReactivePlaces` | `passes/infer_reactive_places.rs` | Identify reactive vs non-reactive places. |
| 14 | `RewriteInstructionKindsBasedOnReassignment` | `passes/rewrite_instruction_kinds.rs` | Mark reassignments. |

### Stages 15–19 — Reactive scope construction (HIR)

| # | Stage | Rust module | Purpose |
| --- | --- | --- | --- |
| 15 | `InferReactiveScopeVariables` | `passes/infer_reactive_scope_variables.rs` | Assign co-mutating places to reactive scopes. |
| 16 | `MemoizeFbtAndMacroOperandsInSameScope` | `passes/memoize_fbt_and_macro_operands_in_same_scope.rs` | Mark fbt/macro operands for same-scope memoization. |
| 17 | `OutlineFunctions` | `passes/outline_functions.rs` | Extract nested closures/callbacks as top-level functions. |
| 18 | `AlignMethodCallScopes` | `passes/align_method_call_scopes.rs` | Align scope boundaries at method-call sites. |
| 19 | `AlignObjectMethodScopes` | `passes/align_object_method_scopes.rs` | Align scope boundaries for object methods. |

### Stages 20–26 — Scope shaping & dependency propagation (HIR)

| # | Stage | Rust module | Purpose |
| --- | --- | --- | --- |
| 20 | `PruneUnusedLabelsHIR` | `passes/prune_unused_labels_hir.rs` | Remove unreachable labels. |
| 21 | `AlignReactiveScopesToBlockScopesHIR` | `passes/align_reactive_scopes_to_block_scopes_hir.rs` | Align reactive scope boundaries to block boundaries. |
| 22 | `MergeOverlappingReactiveScopesHIR` | `passes/merge_overlapping_reactive_scopes_hir.rs` | Merge overlapping reactive scopes. |
| 23 | `BuildReactiveScopeTerminalsHIR` | `passes/build_reactive_scope_terminals_hir.rs` | Extract scope boundaries + terminal conditions. |
| 24 | `FlattenReactiveLoopsHIR` | `passes/flatten_reactive_loops_hir.rs` | Flatten reactive loops into a single scope. |
| 25 | `FlattenScopesWithHooksOrUseHIR` | `passes/flatten_scopes_with_hooks_or_use_hir.rs` | Flatten scopes containing hooks / `use`. |
| 26 | `PropagateScopeDependenciesHIR` | `passes/propagate_scope_dependencies_hir.rs` (+ `propagate_scope_dependencies_hir/`) | Compute minimal dependencies per scope. |

The dependency-collection subsystem lives in `passes/propagate_scope_dependencies_hir/`:
`minimal_deps.rs` (DeriveMinimalDependenciesHIR), `optional_chain.rs` (optional-chain
dependency paths), `hoistable_loads.rs` (loads hoistable to scope entry),
`resolve_loc.rs` (line:col operand resolution).

### Stage 27 — HIR → ReactiveFunction

| # | Stage | Rust module | Purpose |
| --- | --- | --- | --- |
| 27 | `BuildReactiveFunction` | `reactive_scopes/build.rs` | Convert the post-dependency HIR CFG into the nested `ReactiveFunction` tree. |

### Stages 28–40 — ReactiveFunction passes

| # | Stage | Rust module | Purpose |
| --- | --- | --- | --- |
| 28 | `PruneUnusedLabels` | `reactive_scopes/prune_unused_labels.rs` | Remove unreachable label targets. |
| 29 | `PruneNonEscapingScopes` | `reactive_scopes/prune_non_escaping_scopes.rs` | Remove scopes with no external references (escape analysis). |
| 30 | `PruneNonReactiveDependencies` | `reactive_scopes/prune_non_reactive_dependencies.rs` | Remove static dependencies. |
| 31 | `PruneUnusedScopes` | `reactive_scopes/prune_unused_scopes.rs` | Remove scopes with no instructions. |
| 32 | `MergeReactiveScopesThatInvalidateTogether` | `reactive_scopes/merge_reactive_scopes_that_invalidate_together.rs` | Merge scopes with identical dependencies. |
| 33 | `PruneAlwaysInvalidatingScopes` | `reactive_scopes/prune_always_invalidating_scopes.rs` | Remove scopes invalidating every render. |
| 34 | `PropagateEarlyReturns` | `reactive_scopes/propagate_early_returns.rs` | Hoist early returns into scope conditions. |
| 35 | `PruneUnusedLValues` | `reactive_scopes/prune_unused_lvalues.rs` | Remove unused local declarations. |
| 36 | `PromoteUsedTemporaries` | `reactive_scopes/promote_used_temporaries.rs` | Hoist temporaries to scope level. |
| 37 | `ExtractScopeDeclarationsFromDestructuring` | `reactive_scopes/extract_scope_declarations_from_destructuring.rs` | Lift destructure patterns in scope declarations. |
| 38 | `StabilizeBlockIds` | `reactive_scopes/stabilize_block_ids.rs` | Canonicalize block-id numbering. |
| 39 | `RenameVariables` | `reactive_scopes/rename_variables.rs` | Assign fresh identifiers; compute the uniqueIdentifiers set. |
| 40 | `PruneHoistedContexts` | `reactive_scopes/prune_hoisted_contexts.rs` | Final cleanup; mark hoisted context references. |
| 41 | `ValidatePreservedManualMemoization` | `reactive_scopes/validate_preserved_manual_memoization.rs` | When `enablePreserveExistingMemoizationGuarantees \|\| validatePreserveExistingMemoizationGuarantees`: validate every `useMemo`/`useCallback` was preserved (inferred deps match source deps, no originally-memoized value became unmemoized). A failure surfaces a recoverable verbatim bailout under `@panicThreshold:"none"`. Pipeline complete — ready for codegen. |

### Codegen (ReactiveFunction → JS)

| Component | Rust module | Purpose |
| --- | --- | --- |
| Codegen (CodegenReactiveFunction) | `codegen/codegen_reactive_function.rs` | Emit the memoized oxc AST: `import { c as _c } from "react/compiler-runtime"`, `const $ = _c(N)`, per-scope change-detection blocks, the `Symbol.for("react.memo_cache_sentinel")` form, and appended outlined functions. |
| Code printing | `codegen/mod.rs::print_program` | Print the assembled oxc `Program` via `oxc::codegen`. |
| Cache-slot hashing | `codegen/hash.rs` | Cache-slot hash mixing (and fast-refresh SHA/HMAC). |

---

## TypeScript ↔ Rust file mapping

The TS source root is `../react-compiler/src`.

| TS source | Rust module |
| --- | --- |
| `HIR/BuildHIR.ts` | `build_hir/{mod,builder,lower_statement,lower_expression,post}.rs` |
| `HIR/HIR.ts` | `hir/{model,value,terminal,instruction,place,ids}.rs` |
| `HIR/Environment.ts` | `environment/{mod,config}.rs` |
| `HIR/Globals.ts` | `environment/globals.rs` |
| `HIR/ObjectShape.ts` | `environment/shapes.rs` |
| `Optimization/PruneMaybeThrows.ts` | `passes/prune_maybe_throws.rs` |
| `Inference/DropManualMemoization.ts` | `passes/drop_manual_memoization.rs` |
| `Inference/InlineImmediatelyInvokedFunctionExpressions.ts` | `passes/inline_iife.rs` |
| `HIR/MergeConsecutiveBlocks.ts` | `passes/merge_consecutive_blocks.rs` |
| `SSA/EnterSSA.ts` | `passes/enter_ssa.rs` |
| `SSA/EliminateRedundantPhi.ts` | `passes/eliminate_redundant_phi.rs` |
| `Optimization/ConstantPropagation.ts` | `passes/constant_propagation.rs` |
| `TypeInference/InferTypes.ts` | `type_inference/infer_types.rs` (+ `provider.rs`) |
| `Optimization/OptimizePropsMethodCalls.ts` | `passes/optimize_props_method_calls.rs` |
| `Inference/AnalyseFunctions.ts` | `passes/analyse_functions.rs` (+ rules-of-hooks → `passes/validate_hooks_usage.rs`) |
| `Inference/InferMutationAliasingEffects.ts` | `passes/infer_mutation_aliasing_effects{,_signature,_apply}.rs` |
| `Optimization/DeadCodeElimination.ts` | `passes/dead_code_elimination.rs` |
| `Inference/InferMutationAliasingRanges.ts` | `passes/infer_mutation_aliasing_ranges.rs` |
| `Inference/InferReactivePlaces.ts` | `passes/infer_reactive_places.rs` |
| `SSA/RewriteInstructionKindsBasedOnReassignment.ts` | `passes/rewrite_instruction_kinds.rs` |
| `ReactiveScopes/InferReactiveScopeVariables.ts` | `passes/infer_reactive_scope_variables.rs` |
| `ReactiveScopes/MemoizeFbtAndMacroOperandsInSameScope.ts` | `passes/memoize_fbt_and_macro_operands_in_same_scope.rs` |
| `Optimization/OutlineFunctions.ts` | `passes/outline_functions.rs` (+ `outline_jsx.rs`, `name_anonymous_functions.rs`) |
| `ReactiveScopes/AlignMethodCallScopes.ts` | `passes/align_method_call_scopes.rs` |
| `ReactiveScopes/AlignObjectMethodScopes.ts` | `passes/align_object_method_scopes.rs` |
| `HIR/PruneUnusedLabelsHIR.ts` | `passes/prune_unused_labels_hir.rs` |
| `ReactiveScopes/AlignReactiveScopesToBlockScopesHIR.ts` | `passes/align_reactive_scopes_to_block_scopes_hir.rs` |
| `HIR/MergeOverlappingReactiveScopesHIR.ts` | `passes/merge_overlapping_reactive_scopes_hir.rs` |
| `HIR/BuildReactiveScopeTerminalsHIR.ts` | `passes/build_reactive_scope_terminals_hir.rs` |
| `ReactiveScopes/FlattenReactiveLoopsHIR.ts` | `passes/flatten_reactive_loops_hir.rs` |
| `ReactiveScopes/FlattenScopesWithHooksOrUseHIR.ts` | `passes/flatten_scopes_with_hooks_or_use_hir.rs` |
| `HIR/PropagateScopeDependenciesHIR.ts` | `passes/propagate_scope_dependencies_hir.rs` |
| `HIR/DeriveMinimalDependenciesHIR.ts` | `passes/propagate_scope_dependencies_hir/minimal_deps.rs` |
| `HIR/CollectOptionalChainDependencies.ts` | `passes/propagate_scope_dependencies_hir/optional_chain.rs` |
| `ReactiveScopes/BuildReactiveFunction.ts` | `reactive_scopes/build.rs` |
| `ReactiveScopes/PruneUnusedLabels.ts` | `reactive_scopes/prune_unused_labels.rs` |
| `ReactiveScopes/PruneNonEscapingScopes.ts` | `reactive_scopes/prune_non_escaping_scopes.rs` |
| `ReactiveScopes/PruneNonReactiveDependencies.ts` | `reactive_scopes/prune_non_reactive_dependencies.rs` |
| `ReactiveScopes/PruneUnusedScopes.ts` | `reactive_scopes/prune_unused_scopes.rs` |
| `ReactiveScopes/MergeReactiveScopesThatInvalidateTogether.ts` | `reactive_scopes/merge_reactive_scopes_that_invalidate_together.rs` |
| `ReactiveScopes/PruneAlwaysInvalidatingScopes.ts` | `reactive_scopes/prune_always_invalidating_scopes.rs` |
| `ReactiveScopes/PropagateEarlyReturns.ts` | `reactive_scopes/propagate_early_returns.rs` |
| `ReactiveScopes/PruneTemporaryLValues.ts` | `reactive_scopes/prune_unused_lvalues.rs` |
| `ReactiveScopes/PromoteUsedTemporaries.ts` | `reactive_scopes/promote_used_temporaries.rs` |
| `ReactiveScopes/ExtractScopeDeclarationsFromDestructuring.ts` | `reactive_scopes/extract_scope_declarations_from_destructuring.rs` |
| `ReactiveScopes/StabilizeBlockIds.ts` | `reactive_scopes/stabilize_block_ids.rs` |
| `ReactiveScopes/RenameVariables.ts` | `reactive_scopes/rename_variables.rs` |
| `ReactiveScopes/PruneHoistedContexts.ts` | `reactive_scopes/prune_hoisted_contexts.rs` |
| `Validation/ValidatePreservedManualMemoization.ts` | `reactive_scopes/validate_preserved_manual_memoization.rs` |
| `ReactiveScopes/CodegenReactiveFunction.ts` | `codegen/codegen_reactive_function.rs` |
| `Entrypoint/Gating.ts` + `Entrypoint/Program.ts` | `gating.rs` + `compile.rs::apply_gating` |
| `Entrypoint/Suppression.ts` | `suppression.rs` |
| `Entrypoint/Options.ts` + `Utils/TestUtils.ts` | `compile.rs::ModuleOptions::from_source` |
| `Entrypoint/Imports.ts` | `codegen/codegen_reactive_function.rs` |

---

## Parity methodology

The oracle is **the TypeScript React Compiler itself**, run by its fixture harness
(`../react-compiler/src/__tests__/runner/harness.ts`). This crate does not generate
oracles; it verifies against the TS compiler's committed snapshots.

### Oracle types

| Oracle | Source | What it captures |
| --- | --- | --- |
| `.expect.md` `## Code` | `../react-compiler/src/__tests__/fixtures/compiler/**/*.expect.md` | Final compiled JS (`forgetResult.code`), honoring each fixture's first-line pragmas (`@compilationMode`, `@gating`, `@outputMode`, `@expectNothingCompiled`, `'use no memo'`, validations). Omitted if the oracle threw. |
| `.hir` | TS verify CLI: `npx tsx src/verify/cli.ts <file> --hir --stage <S>` | HIR dump at a named stage. |
| `.rfn` | TS oracle's `printReactiveFunctionWithOutlined` | ReactiveFunction tree at a stage. |
| compiler-only (`.cc.code`) | `../react-compiler/src/verify/capture-code.ts` | React-Compiler output **without** chained downstream plugins (fbt/idx) or prettier — isolates the compiler's own output. **A scored corpus oracle** for the 39 proven class-A fixtures (see *Corpus integrity + dual-oracle*). |

### Formatting-independent comparison

The TS compiler emits via babel-generator; this crate emits via oxc-codegen. To
compare semantics rather than formatting, both sides are routed through the same
`canonicalize` (in `src/codegen/mod.rs`):

```text
oracle_canonical = canonicalize(result.code)   // re-parse babel output, normalize, print via oxc
rust_canonical   = print_program(rust_ast)     // already an oxc AST, printed via the same Codegen
```

`canonicalize` = oxc `Parser` (TS+JSX `SourceType`) → `Normalizer` visitor →
`oxc::codegen::Codegen` with fixed `CodegenOptions`. It is idempotent
(`canonicalize(canonicalize(x)) == canonicalize(x)`, proven by
`tests/codegen_parity.rs::canonicalization_is_idempotent`).

The `Normalizer` performs only **behavior-preserving** rewrites:

1. **Drop empty statements** — the TS compiler emits a no-op `;` for catch-binding
   `DeclareLocal(Catch)`; prettier strips it in `.expect.md`. It is a no-op per the
   ECMAScript spec, so dropping it on both sides makes the two forms agree.
2. **Normalize JSX text whitespace** — applies the exact JSX-spec algorithm
   (babel's `cleanJSXElementLiteralChild`, the same `trim_jsx_text` lowering uses):
   strip whitespace touching a newline, remove blank lines, collapse interior
   newlines to a single space, drop whitespace-only children that would trim away.
   Both forms render identically at runtime.

Because each normalization preserves behavior, **a difference that survives
canonicalization is a real program difference**, not a printer artifact.

### Corpus integrity + dual-oracle (no fabricated refs)

The corpus is scored against **two oracle kinds**, chosen per fixture by an optional
4th `manifest.tsv` column (default `.expect.md`). The split is explicit, committed,
and auditable:

- **`.expect.md`** (`<name>.code`, **1359** fixtures): the FULL fixture-harness
  pipeline — React Compiler **then** chained `babel-plugin-fbt` / `babel-plugin-idx`
  **then** prettier.
- **`.cc.code`** (`<name>.cc.code`, **39** fixtures): the React Compiler **alone**,
  captured byte-verbatim via `../react-compiler/src/verify/capture-code.ts`
  (`npx --no-install tsx src/verify/capture-code.ts <ABS_FIXTURE>`, run from the
  `react-compiler` dir; `BabelPluginReactCompiler` + the shared-runtime type provider
  with the snapshot harness's exact plugin options AND parser selection — it now mirrors
  `harness.ts`'s `parseInput` (HermesParser for `@flow`, comment-free; `@script`
  source-type), `validatePreserveExistingMemoizationGuarantees` from the first-line
  pragma, `assertValidMutableRanges`, a no-op `logger`, `enableReanimatedCheck:false`,
  `target:'19'` — **no** fbt/idx plugins, **no** prettier). A fixture is routed here
  **only** after proving its divergence from `.expect.md` is a downstream plugin
  (`fbt(...)`→`fbt._(...)`, bare `idx(...)`→a safe-nav ternary), a prettier reformat, or
  a parser/generator artifact in the FULL pipeline that is NOT part of the React
  Compiler's own output (`timers` JSX whitespace, `tagged-template-literal` re-indent,
  `existing-variables-with-c-name` leading-pragma-comment, the `@flow` HermesParser
  comment-strip, babel-generator's `\uXXXX` non-ASCII escape), **and** the Rust
  compiler-only output canonical-matches the capture (proven via `compiler_only_parity`).
  All **39/39** match, and `corpus_parity_report` hard-asserts `cc_matched == cc_total`.
  Each `.cc.code` entry is preceded by a `# <name>: <reason>` comment.
  **Genuine compiler bugs are never routed here** — they are code-fixed.

- `tests/fixtures/corpus/manifest.tsv` lists every fixture:
  `<sanitized-name>  <ext>  <fixture-path>  [<oracle-kind>]` (4th column optional,
  default `.expect.md`; `#` lines are reason comments). **1398 entries.**
- `examples/regen_corpus.rs` re-derives every ref from its oracle (the `.expect.md`
  `## Code` block, or `capture-code.ts` stdout), preserving the `#` reason comments +
  4th column, and **drops** any `.expect.md` entry whose oracle threw. It currently
  rewrites **0** refs (1359 `.code` + 39 `.cc.code` unchanged, 0 dropped) — every ref
  is byte-identical to its source-of-truth.
- `examples/verify_corpus_integrity.rs` independently re-derives **every** `.cc.code`
  ref from `capture-code.ts` (plus a strided sample of `.code` refs) and asserts
  byte-identity — a second, independent reader proving no ref was hand-edited.
- `examples/seed_corpus.rs` is the one-time seeder: it walks the entire fixture tree,
  keeps only fixtures with a `## Code` block whose source oxc can parse, and records
  manifest entries + source copies.
- Supporting dev tools: `examples/{dump_stage,diff_fixture,compiler_only_parity,triage_buckets,list_other,codegen_file,dump_mismatch_diffs}.rs`.

---

## Test-harness map

`cargo test -- --include-ignored` → **184 passed, 0 failed**.

| Harness (`tests/`) | Tests | Coverage |
| --- | --- | --- |
| (unit, `src/`) | 80 | Core data structures, passes, environment, HIR/reactive printing, hash, suppression. Run with `cargo test --lib`. |
| `codegen_parity.rs` | 16 | Stage 7 emitter vs **134** stored `.code` refs under canonical comparison; idempotence + round-trip checks; `@emitHookGuards` / `@enableEmitInstrumentForget`. |
| `corpus_parity.rs` | 1 | Full corpus dual-oracle: **1398/1398 (100.0%)** (1359 base `.expect.md` + 39 compiler-only `.cc.code`, 39/39 hard-asserted), PANIC=0, UNSUPPORTED=0, MISMATCH=0. Run with `-- --nocapture`. |
| `hir_parity.rs` | 5 | Post-lowering HIR vs **89** refs (measured + strict full-parity gate). |
| `hir_parity_stage2.rs` | 20 | Early passes: DropManualMemoization, MergeConsecutiveBlocks, SSA, EliminateRedundantPhi, ConstantPropagation, OptimizePropsMethodCalls, InferTypes — full parity. |
| `hir_parity_stage3.rs` | 23 | Mutation/aliasing/typing: AnalyseFunctions, DeadCodeElimination, InferMutationAliasingEffects, InferMutationAliasingRanges, RewriteInstructionKinds, InferReactivePlaces. |
| `hir_parity_stage4.rs` | 32 | 12 reactive-scope passes (InferReactiveScopeVariables → PropagateScopeDependenciesHIR), strict full-parity gates. |
| `reactive_parity.rs` | 2 | 14 ReactiveFunction passes (BuildReactiveFunction → PruneHoistedContexts) via `.rfn` refs, strict gate. |
| `cfg.rs` | 5 | Control-flow outline printer (`print_control_flow`). |

**Strict gates** are marked `#[ignore]` and require every fixture to match exactly;
run them with `--include-ignored`. **Measured gates** report `matched/total` and only
fail at zero matches — used for stages where minor printer differences are tolerated.

---

## Honest 100% — how the last 6 mismatches were resolved

This is an honest accounting. The corpus is at **1398/1398 (100.0%)**, PANIC=0,
UNSUPPORTED=0, MISMATCH=0. The last 6 mismatches split into **3 genuine CLASS-B
compiler bugs (CODE-FIXED — never oracle-swapped)** and **3 CLASS-A capture-tool
fidelity gaps** (`capture-code.ts` was made faithful to the harness, then the
proven-class-A fixtures were promoted to `.cc.code`).

### CLASS B — genuine compiler bugs, CODE-FIXED (stay on `.expect.md`, now match)

| Fixture(s) | Root cause + fix (IR stage) |
| --- | --- |
| `should-bailout-without-compilation-infer-mode`, `should-bailout-without-compilation-annotation-mode` | **render-unsafe side effect.** A component/hook that reassigns a module-level global at render (`someGlobal = 'wat'`) is a `StoreGlobal`→`MutateGlobal` aliasing effect that `inferMutationAliasingRanges` records as a `Globals` diagnostic (`appendFunctionErrors`/`shouldRecordErrors`, gated `!isFunctionExpression && env.enableValidations`). The TS returns `Err` (`Pipeline.ts:527`); under `@panicThreshold:"none"` it bails **verbatim**. The Rust port discarded the top-level ranges-pass return value, so it wrongly compiled + gated. Fix (`compile.rs`): surface a `RENDER_SIDE_EFFECT_ERROR` for a direct top-level `MutateGlobal`/`MutateFrozen`/`Impure` effect (the per-instruction render-side-effect path — never a bubbled nested-fn effect, so callback global mutations like `allow-modify-global-in-callback-jsx` stay untouched) → recoverable verbatim bailout. |
| `gating__dynamic-gating-bailout-nopanic` | **unpreservable manual memoization.** A manual `useMemo(() => identity(value), [])` whose inferred dep (`value`) ≠ source deps (`[]`). Ported `validatePreservedManualMemoization` (`reactive_scopes/validate_preserved_manual_memoization.rs`) on the post-`pruneHoistedContexts` reactive IR (`compareDeps`/`validateInferredDep`/`isUnmemoized` + StartMemoize-operand scope-completion). Two prerequisite faithfulness fixes (the prior round's ~21-fixture regression was an artifact of these gaps): (a) `validate_preserve_existing_memoization_guarantees` now **defaults `false`**, matching the harness's `firstLine.includes('@validatePreserveExistingMemoizationGuarantees')` override; (b) `PruneNonEscapingScopes` now marks `FinishMemoize.pruned` when all memo decls are unscoped or in pruned scopes (`PruneNonEscapingScopes.ts:1067-1119`'s `transformInstruction`), so a correctly-pruned non-escaping `useMemo` does not false-positive as unmemoized. +1, 0 regressions. |

### CLASS A — capture-tool fidelity gaps, `capture-code.ts` made faithful then PROMOTED

The compiler-only capture for these diverged from the Rust output because of a
parser/generator artifact **in the FULL pipeline that the React Compiler's own output
does not contain**. The capture tool was made faithful, then each was promoted to
`.cc.code` only after `canonicalize(rust) == canonicalize(capture)` (proven 3/3).

| Fixture(s) | Artifact + faithfulness fix |
| --- | --- |
| `fbt__recursively-merge-scopes-jsx`, `repro-no-value-for-temporary-reactive-scope-with-early-return` | `.expect.md` bakes in the fbt transform AND a leading `// @flow` comment. The capture previously kept the comment (it used `@babel/parser`). `capture-code.ts` now mirrors `harness.ts`'s `parseInput` exactly — **HermesParser** for `@flow` files (comment-free), `@script` source-type — so the capture drops the comment, matching the React Compiler's real flow output and the Rust output. Promoted (`downstream-plugin:fbt + flow-parser:comment-strip`). |
| `fbt__fbt-param-with-unicode` | babel-generator's `jsesc` escapes the non-ASCII `☺`→`☺` in the bare `<fbt:param>` JSX attribute. To faithfully match the React Compiler's own output, the bare fbt-operand JSX-attribute codegen path (`codegen_reactive_function.rs::escape_non_ascii`) now escapes non-ASCII codepoints to `\uXXXX` (UTF-16 code units) — scoped to that path only (the non-fbt path already uses a JS-string expression container, so `jsx-string-attribute-non-ascii` is unaffected). Promoted (`downstream-plugin:fbt + babel-generator:non-ascii-escape`). |

(Earlier this stage: the two `new-mutability__transitivity-*` bugs were CODE-FIXED via
`typedCapture`/`typedCreateFrom`/`typedMutate` aliasing signatures registered in
`environment::shapes` — restoring the precise single `Capture` effect at
`InferMutationAliasingRanges` so the frozen `useMemo({a})` scope is not over-merged; they
stay on the base `.expect.md` oracle, byte-exact at strict
`InferMutationAliasingRanges` IR-stage parity (`tests/hir_parity_stage3.rs`, 97/97). And
`existing-variables-with-c-name`, mislabeled a "cache-import UID-collision" bug, was
proven a prettier leading-pragma-comment artifact — the `_c`→`_c2` rename is already
correct — and promoted to `.cc.code`, not oracle-swapped.)

---

## Cross-cutting subsystems

| Feature | Rust module | Notes |
| --- | --- | --- |
| Gating (`@gating` / `@dynamicGating`) | `gating.rs` + `compile.rs::apply_gating` | Wrap compiled functions in feature-flag conditionals. |
| Suppression (eslint / Flow) | `suppression.rs` | Parse and apply suppression directives. |
| Module options / pragmas | `compile.rs::ModuleOptions::from_source` | First-line pragma parsing. |
| Import management | `codegen/codegen_reactive_function.rs` | Synthesize cache + gating imports. |
| fbt / custom macros | `passes/memoize_fbt_and_macro_operands_in_same_scope.rs` + codegen | Mark fbt/macro operands (no braces). |
| Hooks validation | `passes/validate_hooks_usage.rs` | Rules of Hooks. |
| JSX | `build_hir/lower_expression.rs` + `codegen/mod.rs` | Lowered to HIR, emitted verbatim (not transformed). |
| Control-flow outline (CFG) | `printer.rs` + `print_control_flow` | Debug/agent outline; drives the CLI binary. |
