//! Full-corpus canonical-codegen-parity harness (Stage 8, part B).
//!
//! Measures how much of the React Compiler fixture suite
//! (`react-compiler/src/__tests__/fixtures/compiler`) the Rust codegen
//! reproduces. The oracle for every fixture is the committed `.expect.md`
//! snapshot the upstream test harness writes (`react-compiler/src/__tests__/
//! runner/harness.ts`). A fixture is included here **iff** that snapshot has a
//! `## Code` section AND oxc can parse the fixture source — i.e. the compiler
//! produced a `result.code` for it under the fixture's own first-line pragmas
//! (`@compilationMode`, `@outputMode`, `@gating`, `@expectNothingCompiled`,
//! `'use no memo'`, validations, …) and the Rust pipeline can at least parse it.
//! The corpus spans the FULL emitting-fixture universe (see the `seed_corpus`
//! note on [`PARITY_FLOOR`]): 1398 of the 1421 fixtures whose oracle emits a
//! `## Code` block are seeded + scored; the other 23 are excluded only because
//! oxc cannot parse them (chiefly `.flow` Flow-syntax fixtures). The `## Code`
//! block is stored verbatim (modulo one canonicalization-neutral line-split, see
//! below) as `tests/fixtures/corpus/<sanitized>.code`, with its source copied
//! alongside as `<sanitized>.src.<ext>` and a `manifest.tsv` listing
//! `<sanitized>\t<ext>\t<original-abs-path>`.
//!
//! ## Reproducing the corpus refs
//!
//! The refs are regenerable from the committed oracle snapshots with
//! `cargo run --example regen_corpus` (run from this crate). That tool reads each
//! fixture's `.expect.md`, extracts the `## Code` block (honoring every pragma —
//! it IS the harness's pragma-honoring `forgetResult.code`, formatted by
//! prettier), and **drops** any fixture whose oracle has no `## Code` block (the
//! compiler threw / emitted nothing). The only transformation applied is to split
//! a trailing line-comment off the prepended `react/compiler-runtime` import line
//! (the harness's `retainLines` collides them onto one line; oxc would otherwise
//! drop that comment on reprint — see `regen_corpus.rs` for the full rationale).
//! That split is canonicalization-neutral.
//!
//! ## Fixtures the oracle throws on are EXCLUDED (not scored)
//!
//! 36 manifest candidates (`error.*` validation fixtures + a handful of
//! `*__error.*` / preserve-memo bailouts) have **no** `## Code` block: the real
//! compiler raises a `CompilerError` and emits no `result.code`. There is nothing
//! to match, so they are excluded from the denominator entirely. (An earlier
//! version of this corpus stored fabricated, validation-suppressed memoized refs
//! for these and silently scored them as matches — that inflated parity and has
//! been removed.)
//!
//! ## Canonical comparison
//!
//! Identical to the Stage-7 `codegen_parity` harness: a fixture *matches* iff
//! `canonicalize(oracle_result_code) == canonicalize(codegen(fixture_source))`,
//! routing both sides through the same oxc parser+printer so only real
//! program/AST differences surface.
//!
//! ## Buckets
//!
//! Every non-matching fixture is categorized:
//! - **PANIC**: the Rust pipeline panicked (a hard bug — must never happen; the
//!   harness catches it via [`std::panic::catch_unwind`] and reports the fixture).
//! - **UNSUPPORTED**: [`compile_to_reactive`] returned a structured error for at
//!   least one top-level function (a not-yet-supported construct); the emitter
//!   left that function as its original source, so the output canonical-differs.
//! - **MISMATCH**: the pipeline produced output that canonical-differs from the
//!   oracle (no structured error).
//!
//! The measured metric is a *report*, not a hard gate: [`corpus_parity_report`]
//! prints `matched/total` plus the bucket sizes and a sample of each bucket's
//! fixtures, and only asserts the floor recorded in [`PARITY_FLOOR`] so a
//! regression is caught while the long tail stays a measured number.

use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use react_compiler_oxc::{
    ModuleOptions, canonicalize, codegen, compile_to_reactive_with_options,
};

/// The minimum matched-fixture count the report asserts. Pinned at the measured
/// value so any real regression trips it; the long-tail bucket sizes stay a
/// measured (printed) number rather than a brittle gate.
///
/// ## Stage-10 final honest measurement (1192/1398 = 85.3%, formatting fully neutralized)
///
/// `regen_corpus` rewrites **0** refs (1398 unchanged, 0 dropped) — every `.code`
/// ref is the verbatim `## Code` block from its `.expect.md` oracle; a sample of
/// 50 (incl. the `array-from-*` and `nonmutated-spread-*` semantic-fix clusters)
/// was independently re-derived from `.expect.md` and confirmed byte-identical.
/// Final buckets: PANIC=0, UNSUPPORTED=6, MISMATCH=200.
///
/// Stage-10 mutation-aliasing/typing fixes (+4 over the 1188 floor): the array
/// iteration methods `filter`/`flatMap`/`every`/`some`/`find`/`findIndex` were
/// missing `mutableOnlyIfOperandsAreMutable: true`, and
/// `areArgumentsImmutableAndNonMutating` only checked the operand value kind —
/// it dropped the TS function-shape branch (a known function arg like global
/// `Boolean` decides the call by its signature's param effects) and the
/// frozen-lambda-with-mutating-params branch. With both ported faithfully,
/// `arr.filter(Boolean)` now takes the operand-only-mutable fast path (aliases
/// the receiver instead of transitively mutating it), recovering the
/// `repro-array-filter-known-nonmutate-Boolean` / `new-mutability__array-filter`
/// cluster. Separately, `buildSignatureFromFunctionExpression` now synthesizes a
/// rest temporary for no-rest callbacks (`rest ?? createTemporaryPlace`), so the
/// map/filter aliasing inner-Apply (3 args against a 1-param callback) stays on
/// the locally-declared-function path instead of bailing to the default capture
/// path — fixing the IMAE/ranges IR for the array-map lambda cluster.
///
/// FORMATTING-VOID vs REAL (the Stage-10 directive): of the original 240 Stage-9
/// mismatches, only ~6 were ever genuinely formatting-void; the JSX-whitespace
/// neutralization in `codegen::canonicalize` recovered the 4 that truly were
/// (prettier-rewrapped JSX describing identical runtime children), and the
/// remaining mismatches are ALL real-semantic. The normalizer was audited to
/// confirm it hides nothing: every fixture whose diff *looked* formatting-only
/// after stripping ws/quotes/`;` turned out to differ on a LOAD-BEARING token the
/// normalizer deliberately preserves — operator-precedence parens
/// (`x + (a ? b : 2)` vs `x + a ? b : 2` in `for-logical`), optional-chaining
/// grouping (`(props?.a).b` vs `props?.a.b`), `??`/`||` grouping
/// (`unused-logical-assigned-to-variable`), IIFE vs uncalled-arrow
/// (`useMemo-with-optional`, `capturing-function-skip-computed-path`), or a
/// runtime template/JSX string (`timers`, `tagged-template-literal`). These are
/// genuinely different programs, so the metric reflects SEMANTIC parity only.
///
/// REMAINING 204 REAL gaps, categorized by root cause (semantic, not formatting):
///   * **63** — different cache-slot COUNT `_c(N)` (different memoization: extra/
///     missing reactive scope, fixable in the InferReactiveScope / mutation-range
///     passes). e.g. `allocating-primitive-as-dep` O=_c(2)/R=_c(4),
///     `capturing-func-no-mutate` O=_c(5)/R=_c(3).
///   * **76** — same cache count but different statements/exprs/deps, including the
///     operator-precedence/paren-emission cluster above (a codegen
///     `needs-parens` gap) and outlined-fn ordering/dedup-rename
///     (`computed-call-evaluation-order` `_temp`/`_temp3` swap,
///     `bug-ref-prefix-postfix-operator` `id`/`id_0` rename). Genuinely fixable.
///   * **24** — different `$[i]` slot index set (different dependency tracking /
///     scope shape). Genuinely fixable in PropagateScopeDependenciesHIR.
///   * **23 fbt + 18 gating** — DEFERRED-EXOTIC: `fbt`/`fbs` macro lowering and the
///     `@gating` codegen transform are whole-feature ports out of this stage's
///     scope; they reliably differ on memo-block shape and are tracked, not fixed.
///
/// ## Stage-10 semantic-parity round 2 (1169 -> 1172, all real semantics)
///
/// Ported `findNonMutatedDestructureSpreads` faithfully in
/// `InferMutationAliasingEffects`: a rest spread (`{...rest}`) of a known-frozen
/// value (component props / hook params) that is never itself mutated is created
/// as `Frozen` rather than `Mutable`. This keeps the downstream read-only
/// property loads (`rest.z`) out of a reactive scope, matching the oracle's
/// memo-block shape and cache-slot count. Recovered the `nonmutated-spread-props`,
/// `nonmutated-spread-props-local-indirection`, and `nonmutated-spread-hook-return`
/// fixtures; all three are now byte-exact at every HIR/reactive/codegen stage in
/// the IR-parity harness.
///
/// ## Stage-10 semantic-parity round (1152 -> 1161, all real semantics)
///
/// Per the Stage-10 directive — *formatting differences must not count, real
/// semantic gaps must be fixed* — two changes lifted the honest count:
///   * **JSX-whitespace formatting neutralization** (`codegen::canonicalize`'s
///     `Normalizer`): the canonicalizer now applies the exact JSX-spec whitespace
///     trim (`trim_jsx_text`, babel's `cleanJSXElementLiteralChild`) to BOTH sides,
///     so a prettier-rewrapped multi-line oracle JSX and the single-line Rust
///     emission — which describe the *same* runtime children — compare equal.
///     Significant same-line whitespace is preserved and `<fbt>`/`<fbs>` subtrees
///     are exempt (matching `BuildHIR`'s fbt branch), so no real difference is
///     hidden. Of the 240 Stage-9 mismatches, only **6** were genuinely
///     formatting-void (the triage's "79" mostly mislabeled real cache-count
///     differences); this fixed **4** of them. The other 2 (`timers`,
///     `tagged-template-literal`) are *not* formatting-void — they are babel-
///     generator artifacts that change a JSX/template runtime string, which the
///     normalizer deliberately does not touch. (+4)
///   * **`Array` global ObjectShape + polymorphic `Array.from` signature**
///     (`environment/shapes.rs`): the `Array` constructor object and its
///     `isArray`/`from`/`of` statics were missing, so `Array.from(x)` fell to the
///     untyped default and never extended its argument's mutable range. Adding the
///     shape with `from`'s `[ConditionallyMutateIterator, ConditionallyMutate,
///     ConditionallyMutate]` positional effects (verbatim from `Globals.ts`, anon
///     ids `<generated_64..66>` pinned against the `InferTypes` oracle) makes the
///     `array-from-*` cluster memoize identically to the oracle. The Rust HIR now
///     matches the oracle byte-for-byte through `PropagateScopeDependenciesHIR`;
///     `array-from-captures-arg0` is added to the IR-stage harness (its
///     `InferTypes`..`PropagateScopeDependenciesHIR` `.hir` + `.code` refs) so the
///     fix is regression-protected at the IR level. (+5)
///
/// ## Stage-9 corpus expansion to the full emitting universe (denominator honesty)
///
/// The corpus was expanded from 1334 to **1398** fixtures so the denominator is
/// the *honest emitting-fixture universe*, not a subset. A prior seeding pass had
/// only ever repaired existing manifest entries (`regen_corpus.rs` explicitly does
/// not expand the set), so ~87 fixtures whose `.expect.md` DOES emit a `## Code`
/// block were silently absent — and they skewed toward harder control-flow
/// variants (useMemo-*, useCallback-*, repro-*), which inflated the reported
/// percentage. `examples/seed_corpus.rs` now walks the ENTIRE fixture tree and
/// seeds every emitting fixture oxc can parse:
///   * The true emitting universe is **1421** fixtures (`grep -rl '^## Code$'`).
///   * **1398** of those are now in the corpus and scored.
///   * **23** are NOT seeded because oxc cannot parse them (chiefly `.flow`
///     Flow-syntax fixtures + a few constructs oxc's `tsx` parser rejects, e.g.
///     `allow-ref-initialization`, `component-declaration-basic.flow`,
///     `type-cast-expression.flow`). They can never match (the pipeline can't
///     parse them), so scoring them would only add 0/N noise; `seed_corpus`
///     reports them explicitly rather than hiding them.
/// Adding the 64 seedable fixtures moved the count 1112/1334 -> 1152/1398: +40
/// matched, +24 into MISMATCH (mostly typescript-types / control-flow), i.e. the
/// new fixtures DO skew harder — confirming the prior denominator was optimistic.
///
/// ## Stage-9 Program-layer fidelity fixes (memo/forwardRef + import merge)
///
///   * **`React.memo`/`React.forwardRef` callback discovery** (`Program.ts`
///     `findFunctionsToCompile` + `getComponentOrHookLike`'s memo/forwardRef
///     branch): an inline `(arrow)function` passed to `React.memo(...)` /
///     `React.forwardRef(...)` at the top level is now discovered and compiled
///     (classified `Component` when it calls hooks/JSX), instead of being left
///     verbatim. (`infer-function-React-memo`, `infer-function-forwardRef`,
///     `outlining-in-react-memo`.)
///   * **Outlined-function insertion site** (`insertNewOutlinedFunctionNode`):
///     outlined functions from a `FunctionDeclaration` are inserted right *after*
///     the function (`insertAfter`), while those from an (Arrow)FunctionExpression
///     are appended to the END of the module (`pushContainer('body', …)`). The
///     emitter previously always nested them inline. (`outlining-in-func-expr`,
///     `outlining-in-react-memo`.)
///   * **Runtime-import merge** (`Imports.ts::addImportsToProgram`): when a
///     non-namespaced named import from `react/compiler-runtime` already exists,
///     `c as _c` is spliced into that declaration's specifier list rather than
///     prepended as a second import. (`babel-existing-react-runtime-import`.)
///
/// ## Stage-9 cheap-wins round: TDZ hoisting + TS type-cast exprs (1074 -> 1102)
///
/// Two faithful `BuildHIR` additions closed the largest cheap UNSUPPORTED/ts
/// buckets (UNSUPPORTED fell 33 -> 6, MISMATCH-ts edged down):
///   * **BlockStatement TDZ hoisting** (`BuildHIR.ts`'s `case 'BlockStatement'`,
///     ported as `lower_block_statements`): for each statement, a hoistable
///     block binding referenced before its declaration — from inside a nested
///     function (`fnDepth > 0`) or because it is a `hoisted` (function-decl)
///     binding — is pre-declared with a `DeclareContext`
///     (`HoistedConst`/`HoistedLet`/`HoistedFunction`) at first reference, and
///     `Environment.addHoistedIdentifier` marks it a context identifier so its
///     later loads/stores become `LoadContext`/`StoreContext`. Both the function
///     body and nested blocks now route through this. This made the entire
///     `hoisting-*` / `hoisted-*` / `repro-hoisting*` / `recursive-function-
///     expression` cluster compile at exact IR + codegen parity (the HIR was
///     previously structurally inconsistent — a captured-but-not-context
///     binding — and panicked downstream in `prune_non_escaping_scopes`). (+~24.)
///   * **`TSAsExpression` / `TSSatisfiesExpression`** now lower to the
///     `TypeCastExpression` HIR value (the type-annotation source text is
///     preserved and re-emitted as `v as T` / `v satisfies T`), matching the TS
///     `lowerExpression` cases; `TSNonNullExpression`/`TSInstantiationExpression`
///     already stripped to the inner expression. (+the `ts-as-expression-*` /
///     `ts-instantiation-*` / `allow-ref-type-cast-in-render` default-value
///     cases.)
///
/// ## Stage-9 Program/Entrypoint layer (the headline rose from 977 to 1051)
///
/// The Rust side now goes through the whole-module `compile_module`
/// (`Entrypoint/Program.ts::compileProgram`), which makes the Program-level
/// decisions the per-function pipeline cannot. The gain breaks down as:
///   * **Per-function + module-scope opt-out** (`'use no forget'`/`'use no memo'`,
///     and `@customOptOutDirectives`): a function carrying an opt-out directive is
///     left verbatim (not compiled); a module-scope opt-out leaves the whole file
///     unchanged. (+~21, the `use-no-memo`/opt-out subset.)
///   * **`shouldSkipCompilation`**: a file that already imports `c` from
///     `react/compiler-runtime` is returned unchanged. (skip-useMemoCache.)
///   * **`@outputMode:"lint"` / `@noEmit`**: analysis-only, emit nothing — the
///     file is returned unchanged. (+~43, the `effect-derived-computations__*`
///     `@validateNo…_exp @outputMode:"lint"` cluster + others.)
///   * **`@compilationMode`** (`infer`/`syntax`/`annotation`): only the
///     mode-eligible functions are compiled; the rest are left verbatim.
///   * **`@ignoreUseNoForget`**: per-function opt-out is disabled (the function is
///     compiled, directive retained). (ignore-use-no-forget.)
///   * **Deduped runtime import**: the `import { c as _c }` is inserted once, only
///     when a compiled function used a cache slot, and skipped if already present.
/// These honor each fixture's first-line pragmas faithfully (the harness's
/// `parseConfigPragmaForTests`); the refs are unchanged (regenerated from
/// `.expect.md`).
///
/// ## Stage-8b honesty correction (the headline number dropped from 1083 to 914)
///
/// A prior Stage-8b round reported 1083/1370. That was inflated: ~176 of those
/// "matches" were against **fabricated** refs that did not reflect the true
/// compiler oracle. The integrity audit found two root causes, both now fixed by
/// regenerating every ref from the committed `.expect.md` `## Code` block (see the
/// module docs + `examples/regen_corpus.rs`):
///   * **36 error fixtures** whose oracle THROWS (no `## Code`) were stored with
///     validation-suppressed memoized refs and scored as matches. They are now
///     excluded — the denominator dropped 1370 -> 1334.
///   * **~130 pragma-gated fixtures** (`@compilationMode:"infer"`,
///     `@outputMode:"lint"`, `@gating`, `@expectNothingCompiled`, `'use no memo'`,
///     `@enablePreserveExistingMemoizationGuarantees`) had refs generated in
///     forced `compilationMode:'all'`, diverging from the true pragma-honoring
///     oracle. The Rust pipeline does not yet honor these pragmas (Stage 9), so
///     they now correctly fall into MISMATCH/UNSUPPORTED.
/// The old refs were also reformatted to single-line JSX (matching the Rust
/// emitter), hiding a genuine JSX-whitespace codegen gap that the true
/// prettier-formatted oracle exposes.
///
/// ## Stage-8b faithful codegen fixes applied on top of the honest baseline
///
///   * **try/catch catch-binding empty statement** (`CodegenReactiveFunction`):
///     `InstructionKind::Catch` now emits a bare `;` (TS `t.emptyStatement()`),
///     not `None`. Previously dropping it removed the leading `;` before every
///     `try` and corrupted labeled-block structure. (+~17 try/catch fixtures.)
///   * **unary word-operator spacing**: `typeof`/`void`/`delete` now emit a space
///     before the operand (`typeof x`, not `typeofx`).
///   * **function directives**: `'use strict'`/`'worklet'` directives are now
///     emitted at the top of the function body (TS `body.directives`), before the
///     `const $ = _c(N)` cache preface.
///   * **canonicalizer formatting-independence** (`codegen::canonicalize`): the
///     normalization pass now drops empty statements and newline-only JSX
///     whitespace before printing, on BOTH sides. The raw `result.code` contains
///     a `;` (the TS catch-binding `t.emptyStatement()`) and `retainLines` JSX
///     newlines that prettier strips in `.expect.md`; normalizing both forms to
///     what JS/JSX treats as void makes the comparison truly printer-independent
///     (and lets the faithful try/catch `;` emission match). This alone recovered
///     +63 fixtures that were only differing on JSX line-breaking / empty `;`.
///
/// ## Stage-11 FINAL honest measurement (1231/1398 = 88.1%, formatting fully neutralized)
///
/// `regen_corpus` rewrites **0** refs (1398 kept, 0 dropped, 1398 unchanged) — every
/// `.code` ref is the verbatim `## Code` block from its `.expect.md` oracle. A second,
/// independent reader (`examples/verify_corpus_integrity`) re-derived a 63-fixture
/// sample (the 5 Stage-11 IR-locked clusters — `arrow-expr-directive`,
/// `function-expr-directive`, `destructure-{array,object}-declaration-to-context-var`,
/// `ts-enum-inline` — plus an evenly-strided 52-fixture slice across the whole
/// alphabetical manifest) straight from `.expect.md` and confirmed every one
/// byte-identical to the stored `.code` (0 divergences). Final buckets: **PANIC=0,
/// UNSUPPORTED=3, MISMATCH=164** (down from the Stage-10 PANIC=0/UNSUPPORTED=6/
/// MISMATCH=200). Stages 1-10 intact: the full `cargo test -- --include-ignored` run
/// is green across every binary (lib 63, cfg 5, codegen_parity 7 = the 86 codegen
/// refs, hir_parity 5, stage2 20, stage3 23, stage4 32, reactive_parity 2) with the
/// strict `_full` IR gates all at 100%; `cargo build` is clean with 0 warnings.
///
/// IR refs added this stage: **200** files (5 fixtures × 40 per-stage `.hir`/`.rfn`/
/// `.code` refs), all freshly generated from the per-stage oracle and exercised by
/// the directory-walking `hir_parity_stage*` harness (strict `_full` variants).
///
/// Remaining 167 REAL gaps (164 MISMATCH + 3 UNSUPPORTED), categorized by root cause:
///   * **fbt = 34** (DEFERRED-EXOTIC): `fbt`/`fbs` macro lowering is a whole-feature
///     port out of this stage's scope; reliably differs on memo-block shape.
///   * **gating/use-no-memo = 22** (DEFERRED-EXOTIC): the `@gating` codegen transform
///     (`_temp = isFooEnabled() ? Component_optimized : Component_unoptimized`) is a
///     whole-feature port; tracked, not fixed.
///   * **typescript-types = 15** (14 MISMATCH + 1 UNSUPPORTED): the residual here is
///     NOT type-only constructs (those were cleared — enum/satisfies/as/non-null/
///     props-annotation gating) but unrelated scope/dependency/value-kind divergences
///     in `.ts`/`.tsx` fixtures that the coarse `": "`-substring subcategory bins as
///     ts-types (e.g. `hook-call-freezes-captured-memberexpr`,
///     `nested-function-with-param-as-captured-dep`).
///   * **try/catch/finally = 5**: control-flow scope/dependency divergences inside
///     try-blocks (e.g. `destructuring-mixed-scope-declarations-and-locals`,
///     `…array-map-named-callback-cross-context`).
///   * **tagged-template = 2**: babel-generator template/JSX runtime-string artifacts
///     (`bug-ref-prefix-postfix-operator`, `inner-function__…array-map-simple`).
///   * **cache-size residual / other = 89** (87 MISMATCH + 2 UNSUPPORTED): the long
///     tail of REAL semantic divergences — residual cache-slot `_c(N)` count
///     differences (extra/missing reactive scope), `$[i]` slot-index-set differences
///     (dependency-tracking shape in PropagateScopeDependenciesHIR), outlined-fn
///     ordering/dedup-rename, and operator-precedence paren-emission. All genuinely
///     fixable in the inference/scope/dep passes; none are formatting-void (the
///     `canonicalize` normalizer routes both sides through oxc parse+print and was
///     audited to hide nothing — every diff that *looked* formatting-only differs on
///     a load-bearing token the normalizer preserves).
///
/// ## Stage-11 cache-size fix: `forceMemoizePrimitives` honors the resolved config
///
///   * **`PruneNonEscapingScopes` primitive-forcing** (`PruneNonEscapingScopes.ts`
///     :408-413): the `forceMemoizePrimitives` option resolves to `enableForest ||
///     enablePreserveExistingMemoizationGuarantees`. The Rust port previously
///     hardcoded it to `true`, so fixtures that set
///     `@enablePreserveExistingMemoizationGuarantees:false` were forcing
///     primitive-producing instructions (Binary/PropertyLoad/etc.) to be memoized.
///     That spuriously kept an allocating-call scope alive whenever its result was
///     only consumed to compute a primitive (e.g. `foo(bar(props).b + 1)`), so the
///     `bar(...)` scope was never pruned and the cache count came out too large
///     (`_c(4)` vs the oracle's `_c(2)`). The flag is now threaded from
///     `env.config.enable_preserve_existing_memoization_guarantees` (enableForest is
///     always false here), so primitive-only allocating chains drop the inner scope.
///     Recovered the allocating-primitive-as-dep family + several other
///     `@…Guarantees:false` cache-count fixtures. (+9 → floor 1201.)
///
/// ## Stage-11 cache-size fix round 2: the `React` namespace hook shapes
///
///   * **`React.<hook>` member-access typing** (`Globals.ts` `TYPED_GLOBALS` `React`
///     entry + `ObjectShape.ts` hook shapes). `LoadGlobal React` previously resolved
///     to no shape, so `getPropertyType(React, 'useState')` fell through the
///     `isHookName` branch in `Environment.getPropertyType` to the generic
///     `DefaultNonmutatingHook` custom-hook type. That typed the destructured setter
///     `Poly` instead of `BuiltInSetState`, so `InferReactivePlaces`'s stable-type
///     side map never marked it stable — and the setter (and any closure capturing
///     only it) was tracked as a reactive memoization dependency, inflating the cache
///     count (`_c(5)` vs the oracle's `_c(3)` on the `arrow-expr-directive` /
///     `function-expr-directive` / `react-namespace` / `createElement-freeze` family).
///     The fix registers the `React` object shape (`<generated_109>`) with all
///     REACT_APIS members pointing at their true typed shapes (so `React.useState` is
///     `BuiltInUseState`, the setter `BuiltInSetState`, the effect hooks
///     `BuiltInUseEffectHook`/etc.), adds their call signatures (incl. the `useEffect`
///     aliasing signature), and extends `getHookKind` to recognize the typed
///     effect/context hook shape ids as hooks (so a typed `React.useEffect` call is
///     still a source of reactivity — preserving `useEffect-namespace-pruned`).
///     (+5 → floor 1206.) `arrow-expr-directive` + `function-expr-directive` were
///     pulled into the IR-stage harness (full per-stage `.hir`/`.rfn` + `.code` refs,
///     freshly generated from the oracle) to regression-lock the fix.
///
/// ## Stage-11 cache-size fix round 3: context-variable destructuring declarations
///
///   * **`let [x] = …` / `let {x} = …` where `x` is reassigned** (a context
///     variable). `BuildHIR.ts`'s `lowerAssignment` `ArrayPattern`/`ObjectPattern`
///     element branches (lines 4048-4082, 4148-4180) only bind a destructure element
///     *directly* into the pattern when `assignmentKind === 'Assignment'` **or** the
///     element is a `StoreLocal` (`getStoreKind` not a context variable). For a
///     declaration destructure (`Destructure`) of a context variable, TS instead
///     promotes a temporary, pushes *that* into the pattern, and emits a follow-up
///     `StoreContext Let x = #t` so the variable keeps its mutable range and can be
///     mutated by a later closure. The Rust declaration path (`pattern_element_place`
///     in `build_hir/lower_statement.rs`) bound *every* identifier directly,
///     creating the context variable as a frozen pattern binding — so the closure
///     mutation was flagged `MutateFrozen` and no reactive scope formed, dropping the
///     cache count (`_c(2)` vs the oracle's `_c(4)`). `pattern_element_place` now
///     threads `assignment_kind`/`force_temporaries` and routes context-variable
///     declaration elements through a promoted temporary + follow-up `StoreContext`,
///     matching the TS guard exactly. Recovered `destructure-array-declaration-to-
///     context-var` + `destructure-object-declaration-to-context-var` (cache count)
///     plus one previously-bailing context-var fixture. (+3 → floor 1209.) Both
///     destructure fixtures were pulled into the IR-stage harness (full per-stage
///     `.hir`/`.rfn` + `.code` refs, freshly generated from the oracle).
/// ## Stage-11 typescript-types round: enum lowering, props-annotation gating,
/// `@flow` pragma strip, and TS-cast member parens (1209 -> 1220, all faithful)
///
/// Per the Stage-11 directive — *clear the typescript-types semantic bucket by
/// handling type-only constructs exactly as the TS compiler/babel does* — four
/// faithful changes lifted the honest count, each ported from the TS source:
///   * **Component props type-annotation gating** (`Program.ts::isValidPropsAnnotation`):
///     `getComponentOrHookLike` rejects a `Component`-named function whose first
///     param's TS annotation is a primitive/structural keyword type (`number`,
///     `string`, `boolean`, `bigint`, `symbol`, `never`, array/tuple/function/
///     constructor literal) — a real props object can never be those. The Rust
///     `is_valid_component_params` previously treated the annotation as always
///     valid, so under `@compilationMode:"infer"` it compiled functions the oracle
///     leaves verbatim (`infer-no-component-annot`, `Component(fakeProps: number)`).
///     (+1)
///   * **`enum` lowering** (`BuildHIR.ts`'s `case 'TSEnumDeclaration'`): an inline
///     `enum E { … }` lowers to an `UnsupportedNode` value carrying the enum's
///     source text (NO error — the React Compiler does not transpile enums, a
///     separate babel plugin does), so the rest of the function still compiles and
///     codegen re-emits the enum verbatim (`codegenInstruction`'s
///     `if (t.isStatement(value)) return value`). Critically, the enum binding
///     `Bool` resolves to a `LoadGlobal` (not a tracked local) because `BuildHIR`
///     never registers the enum name in its `#bindings` map — `resolve_identifier`
///     now treats an `enum`-flagged oxc symbol as Global, matching the oracle's
///     `LoadGlobal(global) Bool` and avoiding a `PruneNonEscapingScopes` panic
///     (the enum lvalue temp had no node in the identifier graph). `ts-enum-inline`
///     is pulled into the IR-stage harness (full per-stage `.hir`/`.rfn` + `.code`
///     refs, freshly generated from the oracle) to regression-lock the fix.
///     `UnsupportedNode` now stores the node *type* (`PrintHIR`'s
///     `UnsupportedNode ${node.type}`) separately from its source text. (+1)
///   * **`@flow` docblock-pragma strip** (`@babel/plugin-transform-flow-strip-types`):
///     the React Compiler's babel pipeline removes the leading `// @flow …` pragma
///     comment from every `@flow` file's output (verified: all 16 `@flow`-leading
///     corpus oracles drop it, while non-flow pragma comments — `@compilationMode`,
///     `@validate…`, `@enable…` — are preserved). `compile_module` now strips a
///     leading `@flow`/`@noflow` pragma comment, recovering the `@flow` fixtures
///     that differed only by that comment. (+9, incl. `flow-enum-inline`.)
///   * **TS-cast member parens** (`codegen`): `(x as T).a.value` was emitted as
///     `x as T.a.value` (the member operator binds tighter than `as`, so it
///     re-parsed as `x as (T.a.value)`). A member/call object that is a top-level
///     `as`/`satisfies` cast is now parenthesized, mirroring babel-generator's
///     `needsParens` for a `TSAsExpression`/`TSSatisfiesExpression` member object.
///     (correctness fix; the remaining typescript-types mismatches are unrelated
///     scope/dependency/value-kind divergences, not type-only constructs.)
///
/// ## Stage-11 residual-other round: multi-outlined-function emission order
/// (1220 -> 1230, the largest single residual-other cluster)
///
///   * **Outlined-function insertion order for a `FunctionDeclaration`**
///     (`Program.ts::insertNewOutlinedFunctionNode` + `compileProgram`'s outlined
///     loop). For an original `FunctionDeclaration`, each outlined function is
///     inserted with `originalFn.insertAfter(fn)`. Repeated `insertAfter` calls on
///     the *same* original node each splice the new node *directly after* the
///     original, pushing the previously-inserted ones further down — so the
///     emitted order is the **reverse** of the outlining order (the last-outlined
///     function ends up closest to the original; e.g. `_temp3, _temp2, _temp`).
///     The Rust emitter appended the outlined declarations in forward order, so
///     any function that outlined ≥2 helpers (the
///     `preserve-use-callback-stable-built-ins` / multi-`_temp` cluster) emitted
///     them in the wrong order. The (Arrow)FunctionExpression case is unchanged —
///     it uses `program.pushContainer('body', …)`, which appends to the module end
///     in forward order. (+10.)
///
/// ## Stage-12 cache-size fix round 1: global-object method signatures + shapes
/// (1231 -> 1242, the largest residual cache-count cluster)
///
/// The `Globals.ts::TYPED_GLOBALS` global-object subsystem was under-ported: the
/// `Object` statics resolved to their function-shape ids but had NO call signature
/// (so they fell to the default-capture path and conditionally-mutated their
/// argument), and the `Math` / `globalThis` / `global` / `Infinity` / `NaN` /
/// `Date` / `performance` / `console` globals were absent entirely. Two faithful
/// additions, each ported from `Globals.ts` verbatim, closed the largest cache-
/// count cluster:
///   * **`Object.keys`/`entries`/`values` aliasing signatures** (`Globals.ts`
///     :87-208). `Object.keys(obj)` carries an `aliasing` config that *creates* the
///     mutable array return then **immutable-captures** the object into it (only the
///     keys are captured and keys are immutable) — so it does NOT transitively mutate
///     `obj`. Without the signature, `Object.keys(obj)` took the default-capture path
///     (`MutateTransitiveConditionally obj`), extending `obj`'s mutable range and
///     pulling unrelated values into its scope (`shapes-object-key` `_c(3)` vs the
///     oracle's `_c(2)`). A new `SigEffect::ImmutableCapture` placeholder effect was
///     added (substituted to the existing `AliasingEffect::ImmutableCapture`), and
///     `keys`/`entries`/`values` were given their aliasing signatures
///     (`ImmutableCapture` for keys, `Capture` for entries/values) plus `fromEntries`
///     its legacy `[ConditionallyMutate]` signature.
///   * **`Math`/`globalThis`/`global`/`Infinity`/`NaN`/`Date`/`performance`/`console`
///     shapes + globals** (`Globals.ts`'s `TYPED_GLOBALS`). `Math.max(a, b)` fell to
///     the unsignatured default path: it returned a `Mutable` value (so the call got
///     a reactive scope) and conditionally-mutated its operands. Registering the
///     `Math` object shape (`max`/`min`/`trunc`/`ceil`/`floor`/`pow` -> primitive,
///     `random` -> impure Poly; ids `<generated_69..75>` pinned against the oracle),
///     the `performance.now`/`Date.now`/`console.*` shapes (`<generated_67>`/`68`/
///     `76..81`), the recursive `globalThis`/`global` objects (every TYPED_GLOBALS
///     name as a property, so `globalThis.Math.max` types like `Math.max`), and the
///     `Infinity`/`NaN` primitive globals makes `Math.max(...)` a non-allocating
///     primitive (no spurious scope) — `infer-global-object` `_c(7)` -> the oracle's
///     `_c(4)`. (+11 → floor 1242.) `shapes-object-key` + `infer-global-object` were
///     pulled into the IR-stage harness (per-stage `.hir` `InferTypes`..
///     `PropagateScopeDependenciesHIR` + `.code` refs, freshly generated from the
///     oracle) to regression-lock the fix at the IR level.
/// ## Stage-12 cache-size fix round 2: default-valued parameter extraction
/// (1242 -> 1249, the largest residual cache-count cluster)
///
/// A default-valued parameter (`function Component(x = expr)`) is a babel
/// `AssignmentPattern` param, but oxc does NOT nest the default as an
/// `AssignmentPattern`: `BindingPattern::AssignmentPattern` is documented invalid
/// inside a `FormalParameter`, which instead splits the default into
/// `FormalParameter::pattern` (the `left`) + `FormalParameter::initializer` (the
/// `right`). The Rust `lower_param` only consulted `pattern` and dropped the
/// `initializer` entirely, so `function Component(x = [-1, 1])` lowered to a bare
/// `Component(x) { return x; }` — no default-extraction, no allocating-array scope,
/// and the cache count came out empty/too-small (`_c()` / no `$` vs the oracle's
/// `_c(2)`). `lower_param` now reconstructs the TS `param.isAssignmentPattern()`
/// branch (`BuildHIR.ts:130-151`): when an `initializer` is present it allocates a
/// promoted temporary param, then routes `pattern`/`initializer` through the shared
/// default-extraction lowering (`x = t0 === undefined ? <default> : t0`, the
/// `lowerAssignment` `AssignmentPattern` case, `BuildHIR.ts:4299-4391`), which was
/// generalized from taking a babel `AssignmentPattern` to taking `left`/`right`
/// separately (`lower_default_value_assignment`). Recovered the entire
/// `default-param-*` / `function-param-assignment-pattern` /
/// `new-mutability__repro-destructure-from-prop-with-default-value` /
/// `nested-function-with-param-as-captured-dep` cluster (incl. the reorderable-
/// callback defaults that outline to module-scope `_temp` helpers). (+7 → floor
/// 1249.) `function-param-assignment-pattern` was pulled into the IR-stage harness
/// (per-stage `.hir` `InferTypes`..`PropagateScopeDependenciesHIR` + `.code` refs,
/// freshly generated from the oracle) to regression-lock the fix at the IR level.
///
/// ## Round-3 fix (1249 → 1258 = 90.0%, +9): `@enableJsxOutlining` (`OutlineJsx`)
///
/// The `enableJsxOutlining` pass (`Optimization/OutlineJsx.ts`) was unimplemented,
/// so every `jsx-outlining-*` fixture emitted the un-outlined source and
/// canonical-differed. Ported as `passes::outline_jsx`: a backwards block scan
/// groups runs of nested JSX inside callbacks (top-level Components bail), collects
/// each element's attributes (renaming on collision) + non-JSX children (promoted
/// to `#t<decl>` temporaries), and replaces the whole run with a single
/// `<T0 .../>` element that loads a freshly-generated `_temp` component and
/// forwards the collected props. The outlined component is appended to the
/// top-level fn's `outlined` list with `fn_type = Component` (the TS
/// `outlineFunction(fn, 'Component')` registration). At codegen, `codegenOutlined`
/// re-compiles a `Component`-typed outlined fn from its flat source (the Rust
/// analog of `Program.ts` re-queuing the inserted outlined node as a fresh
/// Component), which is what materializes the outlined component's internal
/// reactive scopes (`_c(N)` memoization). `OutlineFunctions` was made to *append*
/// to `outlined` (preserving the JSX-outlined components) and seed its uid
/// allocator from their names. Recovered the entire 9-fixture `jsx-outlining-*`
/// cluster; 4 representatives (`jsx-outlining-simple`/`-separate-nested`/
/// `-with-non-jsx-children`/`-duplicate-prop`) are pulled into the codegen-parity
/// harness with verbatim oracle `.code` refs to regression-lock the fix.
///
/// ## Round-4 fix (1258 → 1269 = 90.8%, +11): assignment-in-expression-position
/// codegen (`CodegenReactiveFunction.ts`) + babel-`@babel/generator` operator
/// precedence parenthesization (`parentheses.js`)
///
/// Two related string-codegen gaps in `codegen_reactive_function.rs`:
///   * **`StoreLocal` in expression position dropped its LHS.** The TS
///     `codegenInstructionValue` `StoreLocal` case (lines 2061-2074) emits
///     `t.assignmentExpression('=', codegenLValue(lvalue.place), value)`; the
///     Rust emitted only the RHS, so `while ((item = items.pop()))` and
///     `for (…; i = i + 1; …)` lost the assignment entirely (the loop reassign
///     vanished, changing the program). Now the lvalue place is retained
///     (`{target} = {value}`). (+`reassign-in-while-loop-condition`,
///     `for-with-assignment-as-update`.)
///   * **No operator-precedence parenthesization.** The Rust codegen is
///     string-based; babel's generator implicitly parenthesizes a child whose
///     precedence is looser than its parent (`@babel/generator`
///     `parentheses.js`: `BinaryLike` / `ConditionalExpression` /
///     `AssignmentExpression` / `SequenceExpression`). A binary/logical operand
///     that is a looser assignment/conditional/sequence — or a lower-precedence
///     (or equal-precedence right) binary — and a conditional *test* that is a
///     conditional/assignment/sequence, are now wrapped, matching babel. Fixes
///     `x.x + (y.y = …)` (chained-assignment), `x + (cond ? a : 2)`
///     (for-logical), `(value = queue.pop()) != null`
///     (while-with-assignment-in-test), `expression-with-assignment-dynamic`,
///     `unused-conditional`, `unused-logical-assigned-to-variable`.
///
/// 2 representatives (`chained-assignment-expressions`, `for-logical`) are pulled
/// into the codegen-parity harness with verbatim oracle `.code` refs to
/// regression-lock the fix at the IR/codegen level.
///
/// ## Stage-12 cross-sibling binding-name collision (1269 -> 1277, all real semantics)
///
/// `BuildHIR`'s `HIRBuilder.resolveBinding` keys its `#bindings` map by *name* and
/// shares it *by reference* with every nested function it lowers
/// (`lower(expr, env, builder.bindings, …)`). So a name a *prior sibling* lambda
/// claims (e.g. the param `e` of the first `arr1.map(e => …)`) is already present
/// in the shared map when a *later sibling* lambda (`arr1.map(e => …)` again)
/// resolves its own `e`, forcing the collision rename `e -> e_0`
/// (`HIRBuilder.ts:342-368`). The Rust builder keys bindings by oxc `SymbolId`
/// (shadowing decls get distinct symbols), and only re-seeded a nested builder's
/// claimed-name set from the inherited `bindings` map — which never contained the
/// earlier sibling's `e` (that name was carried only as an *adopted* claimed name
/// on the parent, not interned into `bindings`). The later sibling therefore kept
/// the bare name `e` and diverged from the oracle's HIR-build-time `e_0`. Threading
/// the parent's adopted `claimed_names` into each nested builder
/// (`build_hir::mod::lower_function` -> `lower_inner` -> `HirBuilder::new`)
/// reproduces TS's cross-sibling visibility. Recovered (+8 net, 0 regressions):
/// the `inner-function__nullable-objects__array-map-{simple,named-callback,
/// named-callback-cross-context,named-chained-callbacks}` cluster (sibling map
/// lambda params `e`/`e_0`), `new-mutability__array-map-named-callback-cross-
/// context`, `valid-setState-in-useEffect-via-useEffectEvent-with-ref`,
/// `bug-ref-prefix-postfix-operator`, and
/// `repro-no-declarations-in-reactive-scope-with-early-return`. The representative
/// `inner-function-array-map-shadowed-param` is pulled into the HIR + codegen
/// parity harnesses with verbatim oracle `.hir`/`.code` refs to regression-lock
/// the fix at the IR/codegen level.
///
/// ## Stage-12 interposed-temporary promotion via promoted-lvalue (1277 -> 1279)
///
/// `PromoteInterposedTemporaries` (`PromoteUsedTemporaries.ts:341-368`) marks every
/// pending temporary as "needs promotion" whenever it sees an instruction that will
/// be emitted as a *statement* (its lvalue was stripped or already promoted) — TS
/// detects this with `instruction.lvalue.identifier.name != null`. Because TS shares
/// one `Identifier` object between a reactive-scope declaration and that scope's
/// defining instruction lvalue, a scope declaration promoted in phase 2
/// (`PromoteTemporaries.visitScope`) makes the instruction lvalue read as *named* by
/// phase 3. Our model clones the identifier into each `Place`, so the instruction
/// lvalue's `name` lags (it is only synced in the phase-4 sweep) and phase 3 saw it
/// as unnamed — so the interposing `Call` did not mark the pending computed-key
/// temporary, and the key was left inlined inside the object-literal scope instead
/// of hoisted to its own `const`. Reading the shared `promoted` set (keyed by
/// declarationId) in addition to the place's `name` reproduces TS's by-reference
/// semantics. Recovered `object-expression-computed-member` (hoisted `const t0 =
/// key.a;`) and `new-mutability__object-expression-computed-member`; the former is
/// pulled into the reactive (`PromoteUsedTemporaries.rfn`) + codegen (`.code`)
/// parity harnesses to regression-lock the fix at the IR level.
///
/// ## Stage-12 optional-chain object parenthesization (1279 -> 1280)
///
/// `CodegenReactiveFunction.ts`'s `case 'OptionalExpression'` *always* rebuilds the
/// inner member/call as an `OptionalMemberExpression`/`OptionalCallExpression` — even
/// when `instrValue.optional === false` (a `.prop` link continuing the chain) — so
/// babel-generator never parenthesizes its optional-chain object. A *plain*
/// `MemberExpression` whose object is an optional chain (a top-level PropertyLoad
/// outside any `OptionalExpression`, e.g. the `.b` of `(props?.a).b`) IS wrapped by
/// babel, because the non-optional `.b` terminates the chain — semantically distinct
/// from `props?.a.b`, which short-circuits. The Rust emitter rendered the
/// optional-chain object as a flat string and never re-wrapped it, emitting
/// `props?.a.b`. The fix tags an `OptionalExpression` result `Temp::OptionalChain`
/// and tracks an `optional_depth` while rebuilding a chain: a member/computed load on
/// an `OptionalChain` object at depth 0 (top level) parenthesizes; inside a chain
/// rebuild (`depth > 0`) it extends without wrapping. Recovered
/// `nonoptional-load-from-optional-memberexpr`; both it and the in-chain
/// `optional-member-expression-chain` (which must stay `props?.b.c`, unwrapped) are
/// pulled into the codegen-parity harness with verbatim `.code` refs so the
/// discrimination is regression-locked.
///
/// ## Stage-13 IIFE callee parenthesization (1280 -> 1284, +4)
///
/// The oracle `## Code` refs are prettier-formatted, and prettier wraps the
/// *callee* of a `CallExpression`/`NewExpression` in parens when it is an
/// `(async) FunctionExpression` or `ArrowFunctionExpression` — `(function (){})()`,
/// `(() => x)()` — the canonical IIFE form (prettier's `printCallExpression` ->
/// `needsParens` for a function/arrow callee). The canonical comparison re-parses
/// the ref through oxc, which round-trips those explicit parens, so a match
/// requires the Rust callee to be wrapped identically. The Rust `Temp::Call`
/// emitter rendered the callee as a flat string (`{callee}({args})`), so an
/// inlined arrow/function callee surfaced unparenthesized. For the arrow case this
/// is a genuine *semantic* miscompile, not a formatting nit: `() => x()` parses as
/// `() => (x())` (the call binds inside the arrow body, never invoking the arrow);
/// `(() => x)()` invokes it. The fix (`codegen_reactive_function::wrap_callee`,
/// applied at the `CallExpression`/`NewExpression`/`OptionalCall` sites)
/// parenthesizes a callee whose rendered form is, at top level, a `function …`/
/// `async function …`/`class …` or an arrow (detected by a depth-0 `=>`). Recovered
/// `capturing-function-skip-computed-path` (arrow IIFE),
/// `deeply-nested-function-expressions-with-params` (named-function IIFE in a
/// nested return), `useMemo-with-optional` and
/// `preserve-memo-validation__useMemo-reordering-depslist-controlflow` (`(() => …)()`
/// useMemo initializers). The two function/arrow representatives
/// (`capturing-function-skip-computed-path`,
/// `deeply-nested-function-expressions-with-params`) are pulled into the
/// codegen-parity harness with verbatim oracle `.code` refs to regression-lock the
/// fix at the IR/codegen level.
///
/// ## Stage-13 round 2: `@flow`-first-line files are emitted comment-free (1284 -> 1288, +4)
///
/// The harness (`__tests__/runner/harness.ts`) selects the parser from the FIRST
/// LINE of the fixture only: `parseLanguage(firstLine)` is `'flow'` iff
/// `firstLine.indexOf('@flow') !== -1` (lines 65–66, called with `firstLine` at
/// line 152), and the flow path parses with `HermesParser.parse(input, {babel:
/// true, flow: 'all', …})` (lines 111–118). HermesParser does NOT retain comments,
/// so the babel AST it returns is comment-free; the React Compiler only rewrites
/// the compiled functions and reprints the rest of that AST, so the entire emitted
/// `result.code` has NO comments. The Rust pipeline splices each regenerated
/// function over its original byte span and preserves everything else verbatim —
/// including comments — so a first-line-`@flow` fixture with any non-pragma comment
/// (a leading `/** … */` docblock between the imports and the component, e.g.) kept
/// that comment and canonical-differed (the prior `strip_flow_pragma_comment` only
/// dropped the leading `// @flow …` line, not interior comments). The fix replaces
/// it with `strip_comments_if_flow_first_line`: when the original source's first
/// line contains `@flow`, the emitted output is re-parsed and ALL comments are
/// cleared (`program.comments.clear()`) before reprint — exactly reproducing the
/// comment-free flow parse. A `@flow` appearing only *after* the first line
/// (`reassign-in-while-loop-condition`, whose first line is an `import`) routes
/// through the babel/typescript parser, which keeps comments, so that case is left
/// untouched (verified: it still matches, its sole oracle `// @flow` comment
/// preserved). Verified across the corpus: every first-line-`@flow` oracle emits
/// zero comment lines, while the lone mid-file-`@flow` fixture keeps its comment.
/// Recovered `repro-aliased-capture-mutate`, `repro-aliased-capture-aliased-mutate`
/// (a 30-line leading docblock dropped), `repeated-dependencies-more-precise`, and
/// `inner-function__nullable-objects__assume-invoked__jsx-function`. Two
/// representatives (`repro-aliased-capture-mutate` — pragma + interior docblock;
/// `repeated-dependencies-more-precise` — leading docblock) are pulled into the
/// codegen-parity harness with verbatim oracle `.code` refs to regression-lock the
/// fix at the codegen level.
///
/// ## Stage-13 round 4: shared-runtime typed hooks + value-block scope alignment (1291 -> 1301, +10)
///
/// Two root causes, both in the largest remaining genuine-bug cluster (the 8
/// `shared-runtime` typed-hook fixtures that mismatched/bailed):
///
/// 1. **Typed `shared-runtime` hooks** (`makeSharedRuntimeTypeProvider` +
///    `installTypeConfig`). The prior stages installed only the *function* exports
///    (`graphql`/`typedLog`/…) and deferred the typed *hooks*, so a
///    `useFragment(...)` import fell through to the generic `DefaultNonmutatingHook`
///    (return `Poly`) instead of its real `MixedReadonly` type with `noAlias`. This
///    stage installs the `BuiltInMixedReadonly` shape (`ObjectShape.ts`, methods at
///    `<generated_45..58>`, `*` wildcard → `MixedReadonly`) and the three typed hooks
///    `useFreeze`/`useFragment`/`useNoAlias` (`<generated_115..117>`) with their real
///    return types (`MixedReadonly`/`Poly`-mutable), legacy call signatures
///    (`restParam: Freeze`, `calleeEffect: Read`, no `aliasing` config), and `noAlias`
///    flags — and registers their shape ids in `get_hook_kind`. A `useFragment(...)`
///    now infers a frozen `MixedReadonly` whose property access/method calls are
///    frozen, so the result is not memoized when the oracle does not. Recovered
///    `tagged-template-in-hook`, `optional-call-logical`, `relay-transitive-mixeddata`,
///    `readonly-object-method-calls`, `readonly-object-method-calls-mutable-lambda`,
///    `destructuring-mixed-scope-declarations-and-locals`, `hook-noAlias`, and
///    `repro-missing-memoization-lack-of-phi-types`.
///
/// 2. **`AlignReactiveScopesToBlockScopesHIR` missed value-block lvalues.** The
///    pass's per-block record loop recorded `instr.lvalue` + value *operands*, but
///    not `eachInstructionValueLValue` (the `StoreLocal`/`DeclareLocal` stored-to
///    place — where a scope-carrying local like `x_@1` lives, per the TS
///    `eachInstructionLValue`). When a reactive scope sat on such a local inside a
///    value block (e.g. `data?.toString() || ''`, exposed once `useFragment` returns
///    `MixedReadonly`), the scope was never re-recorded as active, so it was never
///    extended to its enclosing value-block range — leaving a `Scope` terminal
///    *inside* the value block, which `BuildReactiveFunction` cannot lower (it
///    panicked → corpus bail). The fix records the value lvalues too, faithfully
///    matching `eachInstructionLValue`. This *also* cleared the two pre-existing
///    `UNSUPPORTED-other` bails (`new-mutability__reactive-ref`,
///    `reduce-reactive-deps__context-var-granular-dep`) and one ts-types bail,
///    dropping `UNSUPPORTED` from 3 to 0. Recovered
///    `allocating-logical-expression-instruction-scope`.
///
/// Three representatives (`tagged-template-in-hook`, `hook-noAlias`,
/// `allocating-logical-expression-instruction-scope`) are pulled into the
/// codegen-parity harness with verbatim oracle `.code` refs, and the latter two
/// fixtures plus `tagged-template-in-hook` gain `InferTypes` /
/// `AlignReactiveScopesToBlockScopesHIR` / `BuildReactiveScopeTerminalsHIR` HIR-stage
/// refs to regression-lock both fixes at the IR-stage level.
///
/// ## Stage-13 FINAL honest measurement: 1301/1398 = 93.1% (formatting fully neutralized)
///
/// `regen_corpus` rewrites **0** refs (1398 unchanged, 0 dropped) and an
/// independent re-derivation of 63 sampled refs straight from each fixture's
/// `.expect.md` `## Code` block is byte-identical to the stored `.code`
/// (`examples/verify_corpus_integrity`) — every ref is the verbatim oracle, never
/// hand-edited. Final buckets: **PANIC=0, UNSUPPORTED=0, MISMATCH=97**.
///
/// The 97 remaining mismatches, SHARPLY categorized:
///   * **whole-feature-deferred (~63)** — out of this stage's scope, reliably
///     differ on memo-block / wrapper shape, tracked not fixed:
///       - `fbt` / `fbs` macro lowering — **34** (`fbt__*`, `fbtparam-*`,
///         `lambda-with-fbt`, `recursively-merge-scopes-jsx`).
///       - `@gating` / `'use no memo'` codegen transform — **21** (the
///         `subcategory` gating/use-no-memo bucket) plus the dynamic-gating
///         variants that land in `other` (`gating__dynamic-gating-*`).
///       - `idx()` macro property-load lowering — **3** (`idx-no-outlining`,
///         `idx-method-no-outlining`, `idx-method-no-outlining-wildcard`).
///       - config-gated emit modes — `enableNameAnonymousFunctions`
///         (`name-anonymous-functions`, `name-anonymous-functions-outline`),
///         instrument-forget (`codegen-instrument-forget-test`,
///         `conflict-codegen-instrument-forget`, `log-pruned-memoization`),
///         fast-refresh dev mode (`fast-refresh-reloading`,
///         `fast-refresh-refresh-on-const-changes-dev`), reanimated
///         (`reanimated-no-memo-arg`).
///   * **babel-generator runtime-string artifacts the Normalizer won't touch
///     (~5)** — semantically identical programs that differ only in a JSX/template
///     runtime string or in the UNTOUCHED `FIXTURE_ENTRYPOINT`/`sequentialRenders`
///     test-scaffold preamble (oracle keeps prettier's block-body arrow /
///     `{value}` JSX spacing; the canonicalizer deliberately preserves runtime
///     strings): `jsx-fragment` (`{props.greeting} {t0}` vs `{props.greeting}{" "}
///     {t0}`), `timers` (`rendering took{time}` vs `rendering took {time}`),
///     `tagged-template-literal`, `try-catch-optional-call` (block-body arrow in
///     the harness preamble), `script-source-type`.
///   * **genuinely-fixable bugs (~29)** — real IR-stage gaps, future rounds:
///       - cache-slot COUNT / reactive-scope shape — e.g. `reordering-across-blocks`
///         (`_c(9)` vs `_c(4)`: block-scoped lambda hoist/reorder), `use-operator-
///         conditional` / `use-operator-call-expression` (`use()` operator scope:
///         `_c(7)` vs `_c(9)`), `valid-setState-in-useEffect-controlled-by-ref-value`,
///         `valid-setState-in-effect-from-ref-function-call`, `use-effect-cleanup-
///         reassigns`.
///       - reassign / shadow lowering — `lambda-reassign-shadowed-primitive`
///         (Rust wrongly outlines a fn that reassigns a captured shadowed primitive),
///         `repro-context-var-reassign-no-scope`, `meta-isms__repro-cx-assigned-to-
///         temporary`, `existing-variables-with-c-name`.
///       - the 6 `typescript-types` mismatches (`hook-call-freezes-captured-
///         memberexpr`, `flag-enable-emit-hook-guards`, the two `reduce-reactive-
///         deps__todo-infer-function-uncond-optionals-hoisted` forks, …) +
///         `useCallback-call-second-function-which-captures-maybe-mutable-value-
///         preserve-memoization`, `repro-no-value-for-temporary-reactive-scope-with-
///         early-return`, `repro-retain-source-when-bailout`,
///         `multiple-components-first-is-invalid`,
///         `unclosed-eslint-suppression-skips-all-components`.
///
/// ## Stage-13 honest measurement (1306/1398 = 93.4%, formatting fully neutralized)
///
/// Three faithful semantic fixes (+5 over the 1301 floor), each reproduced at the
/// precise IR stage via the oracle and added to the IR-stage parity harness with
/// fresh oracle refs (`tests/fixtures/hir/use-operator-not-memoized.*`,
/// `tests/fixtures/hir/lambda-reassign-shadowed-primitive.*`):
///   * **`use` operator global** — `import {use} from 'react'` resolved to no
///     typed shape (`use` is NOT hook-named: `isHookName` needs `use[A-Z0-9]`), so
///     `use(ctx)` captured its arg and returned a *mutable* value. Its
///     single-instruction scope then survived `PruneNonEscapingScopes` and was
///     wrongly memoized. Registering `'use'` in `default_globals()` at its
///     `BuiltInUseOperator` shape (matching `Globals.ts` `REACT_APIS`) makes the
///     call freeze its arg + return Frozen, so the scope is pruned and the result
///     becomes a plain reactive dependency (`use-operator-call-expression`,
///     `use-operator-conditional`, +1).
///   * **context identifiers in nested block scopes** —
///     `find_context_identifiers` filtered candidate bindings to the root function
///     scope or an *ancestor*, wrongly dropping block-scoped locals declared
///     *inside* the function and reassigned by an inner lambda
///     (`{ let x = …; const fn = () => { x = … }; }`). Those were lowered as plain
///     `StoreLocal` (not `StoreContext`), the inner function captured nothing, and
///     `OutlineFunctions` outlined it to an EMPTY helper — discarding the
///     reassignment (a correctness bug). Allowing descendant declaration scopes
///     too fixes `lambda-reassign-shadowed-primitive` + `use-effect-cleanup-reassigns`.
///
/// REMAINING gaps (categorized; whole-feature-deferred vs genuine-but-deep):
///   * **fbt 34 + gating/use-no-memo 21** — whole-feature subsystem ports
///     (out of scope this stage).
///   * **other 30** — predominantly whole-feature/config-gated, NOT genuine
///     general bugs: `idx-*` (idx() macro, 3), `name-anonymous-functions*`
///     (`@enableNameAnonymousFunctions`, 2), `gating__dynamic-gating-*`
///     (dynamic gating, 6), `*-instrument-forget*` (`@instrumentForget`, 2/3),
///     `reanimated-no-memo-arg` (`@enableCustomTypeDefinitionForReanimated`),
///     `meta-isms__repro-cx-*` (`@customMacros:"cx"`), `valid-setState-in-*`
///     (`@outputMode:"lint"`, 2), `script-source-type` (`@script`),
///     `fast-refresh-*` (`@enableResetCacheOnSourceFileChanges`, 2),
///     `*panicThreshold:"none"` recovery (`multiple-components-first-is-invalid`,
///     `repro-retain-source-when-bailout`,
///     `unclosed-eslint-suppression-skips-all-components`), `tagged-template-literal`
///     (graphql). PLUS verified NON-semantic prettier artifacts left as honest
///     mismatches: `jsx-fragment`/`timers` — the oracle's `## Code` ran through
///     prettier, which collapses `{' '}` to a literal JSX space / wraps a
///     same-line text+expression across lines; per the JSX-whitespace spec
///     (babel's `cleanJSXElementLiteralChild`, which the Rust codegen and the
///     normalizer both apply) those wrapped forms render WITHOUT the space, so the
///     Rust single-line output (`<div>a {x}</div>`) is the more faithful
///     compiler output — the canonical metric correctly flags them as different
///     programs, and the normalizer is deliberately NOT weakened to hide it.
///     `existing-variables-with-c-name` needs program-level cache-import UID
///     generation (`_c` → `_c2` on collision) + babel comment reattachment.
///   * genuine-but-deep (left for a future bounded round, to avoid regressing the
///     32-fixture mutation-aliasing / 32-fixture scope-dependency IR harnesses):
///     `reordering-across-blocks` (a documented-suboptimal scope-merge case whose
///     `a`-function scope declaration is dropped in `PropagateScopeDependenciesHIR`),
///     `repro-context-var-reassign-no-scope` (`users.length` vs `users` dependency
///     granularity), `new-mutability__transitivity-*` (transitive-capture scope
///     grouping), `useCallback-…-preserve-memoization`
///     (`@enablePreserveExistingMemoizationGuarantees` manual-memo preservation).
///
/// `regen_corpus` still rewrites **0** refs; every `.code` ref is the verbatim
/// `## Code` block from its `.expect.md` oracle. Stages 1-12 + the CFG-outline
/// harness remain green under `cargo test -- --include-ignored`, and a clean
/// rebuild emits 0 warnings.
///
/// ## Stage-14 fix round 1: React rule-suppression skip (1306 -> 1307, +1)
///
/// Ported `Entrypoint/Suppression.ts` (`findProgramSuppressions` +
/// `filterSuppressionsThatAffectFunction`) and the `Program.ts::compileProgram`
/// call site that gates it. When the compiler is NOT validating both hooks usage
/// and exhaustive memo dependencies (`@validateExhaustiveMemoizationDependencies:false`
/// in the recovered fixture), an eslint `/* eslint-disable react-hooks/… */` /
/// `eslint-disable-next-line` / Flow `$FlowFixMe[react-rule…]` suppression comment
/// makes `tryCompileFunction` return a structured error WITHOUT compiling — the
/// suppression signals the developer knowingly disabled a React rule, so the
/// compiler cannot trust the function. `processFn` then leaves the original source
/// untouched (recoverable only when `@panicThreshold:"none"`; an error-level
/// suppression otherwise re-throws and aborts the babel build, which is why such
/// fixtures are not in the emitting corpus). An *unclosed* `eslint-disable` block
/// (no matching `eslint-enable`) affects every subsequent function in the file
/// (`enableComment === null` → both the within- and wraps- bound checks skip), so
/// the whole module is left verbatim and no runtime import is added (no compiled
/// function used a cache slot). Recovered `unclosed-eslint-suppression-skips-all-
/// components`. The empty-rules guard (`@eslintSuppressionRules:[]` ⇒ no detection,
/// matching the TS bug fix that an empty alternation must not match everything) and
/// the both-validations-on gate (suppressions ignored) keep the four already-
/// matching eslint fixtures (`empty-eslint-suppressions-config`, `exhaustive-deps__
/// compile-files-with-exhaustive-deps-violation-in-effects`, the two `use-no-forget-
/// *-with-eslint-suppression`) untouched. The recovered fixture + the
/// empty-rules positive control are pulled into the codegen-parity harness
/// (`tests/fixtures/hir/{unclosed-eslint-suppression-skips-all-components,
/// empty-eslint-suppressions-config}.{js,code}`) with verbatim oracle `.code` refs
/// (freshly captured via `src/verify/capture-code.ts`) to regression-lock both the
/// skip and the no-over-fire discrimination at the codegen level.
///
/// ## Round 4 (1310/1398 = 93.7%, +1 over the 1309 floor)
///
/// Ported `ValidateHooksUsage` (`Validation/ValidateHooksUsage.ts`) +
/// `computeUnconditionalBlocks` (`HIR/ComputeUnconditionalBlocks.ts`, built on the
/// existing post-dominator machinery in `passes::control_dominators`). The pass
/// runs after `inferTypes` (gated on `validateHooksUsage`, default true) and
/// detects Rules-of-Hooks violations: a *conditional* hook call (callee is a
/// known/potential hook in a block not on the entry→exit post-dominator chain), a
/// hook used as a first-class value, or a hook called inside a nested function
/// expression. The TS records the diagnostic and `processFn`/`handleError`
/// re-throws it unless `@panicThreshold:"none"`, in which case the offending
/// function is left verbatim. Rust mirrors that: a hooks violation surfaces a
/// distinguishable error which `compile_to_reactive_with_options` maps to a
/// recoverable verbatim bailout (opt-out) when the threshold is `none`. This
/// recovers `multiple-components-first-is-invalid` (`@panicThreshold:"none"`): its
/// first component `InvalidComponent` calls `useHook()` inside `if (props.cond)`
/// (a conditional hook) and is now left untouched, while the sibling
/// `ValidComponent` still compiles. Zero fixtures with the default
/// `all_errors`/`critical_errors` threshold are falsely flagged (verified: no
/// fixture hits the non-recoverable hooks error), so there is no over-fire and no
/// regression. The recovered fixture is locked at the codegen level
/// (`tests/fixtures/hir/multiple-components-first-is-invalid.{js,code}`) with a
/// verbatim oracle `.code` ref captured via `src/verify/capture-code.ts`.
///
/// ## Stage-15 fbt/fbs + customMacros macro subsystem (1310 -> 1313, +3)
///
/// Ported the `fbt`/`fbs` i18n macro subsystem + the `customMacros` (`idx`/`cx`)
/// recognition that `MemoizeFbtAndMacroOperandsInSameScope` performs
/// (`ReactiveScopes/MemoizeFbtAndMacroOperandsInSameScope.ts`, `BuildHIR.ts`'s
/// fbt-tag lowering + JSX-whitespace preservation, and the `cx.fbtOperands`
/// codegen exception in `CodegenReactiveFunction.ts`). The React Compiler does NOT
/// run babel-plugin-fbt/babel-plugin-idx — it only RECOGNIZES the tags/calls and
/// forces every operand of an `fbt`/`fbs` tag/call (and a `customMacros` macro) to
/// share the tag's reactive scope, so the whole macro expression memoizes as one
/// unit and no operand is lifted into a temporary. `customMacros` is threaded from
/// `env.config.customMacros` (the `@customMacros` pragma; `MacroSchema` is a plain
/// `z.string()`) into both `memoizeFbtAndMacroOperandsInSameScope` call sites.
///
/// The +3 recovered are the genuine React-Compiler memoization fixes whose corpus
/// `.code` does NOT bake in a chained third-party transform: the `meta-isms` `cx`
/// fixtures (incl. `repro-cx-assigned-to-temporary`, which went `_c(5)` -> `_c(2)`)
/// and `idx-method-no-outlining{,-wildcard}` (the method-form `idx` macro now keeps
/// its operands inlined). The remaining ~32 `fbt__*` + `idx-no-outlining` corpus
/// mismatches are INHERENT, not React-Compiler bugs: their corpus `.code` is the
/// output of babel-plugin-fbt (`fbt(...)` -> `fbt._(...)`/`fbt._param(...)`) /
/// babel-plugin-idx (bare `idx(...)` -> a safe-navigation ternary), which run AFTER
/// the compiler in the snapshot harness (`RunReactCompilerBabelPlugin.ts`/
/// `harness.ts`) and are not part of the React Compiler. Verified by capturing the
/// COMPILER-ONLY oracle via `verify/capture-code.ts` (no chained plugins): the Rust
/// compiler-only output is canonical-identical to the compiler-only oracle for
/// 38/40 fbt+macro fixtures — the memo-block shape (`_c(N)`, scope guards) is
/// byte-identical, only the un-transformed `fbt(\`...\`)`/`fbt.param(...)` surface
/// syntax differs from the corpus's plugin-transformed form. The 2 compiler-only
/// residuals are NOT fbt-related: `fbt-param-with-unicode` (babel-generator emits
/// `☺` for the non-ASCII `☺` in a JSX attribute, oxc keeps the literal — a
/// generator string-escaping artifact affecting any non-ASCII string) and
/// `repro-no-value-for-temporary-reactive-scope-with-early-return` (a first-line
/// `@flow` file: the compiler-only `@babel/parser` capture keeps the leading
/// `// @flow` comment, while the corpus/HermesParser path drops all comments — a
/// parser difference, not a compiler difference; the memoization is identical).
///
/// IR-stage harness: the 8 prior fbt/macro fixtures had their reactive `.rfn` refs
/// REGENERATED — they were committed as 0-byte files under a `<name> js.<Stage>.rfn`
/// name the reactive harness's `input.with_extension(...)` never matched, so they
/// were dead (untested). They are now dot-named (`<name>.<Stage>.rfn`) and exercised
/// across all 14 reactive stages (reactive harness 90 -> 98). Two more fbt fixtures
/// covering the `fbt:plural`/`fbt:enum` features —
/// `fbt__bug-fbt-plural-multiple-function-calls` (plural) and
/// `fbt__bug-fbt-plural-multiple-mixed-call-tag` (mixed enum+plural) — were pulled in
/// with FRESH oracle refs across all 12 HIR stages + 14 reactive stages + the
/// compiler-only `.code` (HIR stage4 98 -> 100, reactive 98 -> 100, codegen 131 ->
/// 133). The existing `@MemoizeFbtAndMacroOperandsInSameScope` no-op gate stays green
/// for the 90+ non-fbt fixtures (the pass mutates nothing when no macro tag appears).
///
/// ## Stage-16 static `@gating` codegen transform (1313 -> 1327, +14)
///
/// Ported the `@gating` conditional-compilation subsystem
/// (`Entrypoint/Gating.ts::insertGatedFunctionDeclaration` +
/// `Program.ts::applyCompiledFunctions`'s gating branch). `ModuleOptions` now parses
/// the `@gating` (and `@dynamicGating`) first-line pragmas into an `ExternalFunction`
/// — a bare `@gating` resolves to the harness's `parseConfigPragmaForTests` test
/// default `{source: 'ReactForgetFeatureFlag', importSpecifierName:
/// 'isForgetEnabled_Fixtures'}`. When gating is active, each successfully-compiled
/// top-level function is wrapped in a runtime gating selector instead of being
/// spliced in directly (`src/gating.rs`):
///   * **Path 2** (`Gating.ts:152-194`): `<gating>() ? <compiled> : <original>` —
///     replacing the function node in place (arrow / function expression / memo
///     callback / `export default <arrow>`), the whole declaration with `[export]
///     const <name> = …` (a `FunctionDeclaration`), or `export default function
///     <name>` with a `const <name> = …; export default <name>;` pair.
///   * **Path 1** (`insertAdditionalFunctionDeclaration`, `Gating.ts:36-126`): a
///     `FunctionDeclaration` referenced before its declaration at the top level
///     (`getFunctionReferencedBeforeDeclarationAtTopLevel`, ported as
///     `functions_referenced_before_declaration`) keeps a hoistable wrapper:
///     a gating-call `const`, the renamed optimized + unoptimized declarations, and
///     the `function <name>(arg0) { if (<result>) return …_optimized(arg0); else …
///     }` dispatcher.
/// The gating import is `newUid`-resolved (collision → `_<name>`, e.g.
/// `conflicting-gating-fn`'s `_isForgetEnabled_Fixtures`) and prepended after the
/// `_c` runtime import (module-sorted `localeCompare`). The file's leading `// @gating`
/// pragma comment is dropped (babel re-attaches it as a trailing comment on the
/// `unshiftContainer`'d gating import, which the oracle's canonical form drops);
/// interior docblocks are untouched. Recovered the static-gating cluster:
/// `arrow-function-expr-gating-test`, `conflicting-gating-fn`,
/// `gating-access-function-name-in-component`, `gating-test`,
/// `gating-test-export-{default-,}function{,-and-default}`, `gating-use-before-decl{,-ref}`,
/// `infer-function-expression-React-memo-gating`, `multi-arrow-expr-{export-,export-default-,}gating-test`,
/// `reassigned-fnexpr-variable`, `gating-preserves-function-properties`.
///
/// ## Stage-16 dynamic `@dynamicGating` (`'use memo if(<ident>)'`) (1327 -> 1332, +5)
///
/// Ported the dynamic-gating subsystem (`Program.ts::findDirectivesDynamicGating` +
/// `tryFindDirectiveEnablingMemoization`, the `DYNAMIC_GATING_DIRECTIVE` regex
/// `^use memo if\(([^\)]*)\)$`). A function body carrying a single valid
/// `'use memo if(<ident>)'` directive (when `@dynamicGating:{"source":"…"}` is set)
/// gets a PER-FUNCTION gating `ExternalFunction { source, importSpecifierName:
/// <ident> }` that takes priority over the static `@gating` function
/// (`functionGating = dynamicGating ?? opts.gating`, `Program.ts:760`) and feeds the
/// same `src/gating.rs` wrapper — so `function Foo() { 'use memo if(getTrue)'; … }`
/// emits `const Foo = getTrue() ? <compiled> : <original>;` with the directive
/// retained in both branches. The directive also counts as a memoization-ENABLING
/// directive (`tryFindDirectiveEnablingMemoization`), so the function is compiled
/// even under `@compilationMode:"annotation"` (`dynamic-gating-annotation`). Edge
/// cases ported faithfully:
///   * **invalid identifier** (`'use memo if(true)'`) — `true` is a reserved word, so
///     `t.isValidIdentifier` rejects it: `findDirectivesDynamicGating` returns `Err`,
///     `processFn` handles the error and returns null. Under `@panicThreshold:"none"`
///     the function is left verbatim (`dynamic-gating-invalid-identifier-nopanic`).
///   * **multiple directives** (`'use memo if(getTrue)';'use memo if(getFalse)'`) —
///     also `Err`, same verbatim bailout (`dynamic-gating-invalid-multiple`).
///   * **disabled** — `opts.dynamicGating === null` short-circuits to no gating; the
///     `disabled` fixture DOES set `@dynamicGating` (the suffix names the runtime
///     guard `getFalse`, evaluated at runtime), so it gates identically to `enabled`.
///   * **`@outputMode:"lint"`** — analysis-only, the file is emitted unchanged
///     (`dynamic-gating-noemit`).
/// Recovered `dynamic-gating-enabled`, `dynamic-gating-annotation`,
/// `dynamic-gating-disabled`, `dynamic-gating-invalid-identifier-nopanic`,
/// `dynamic-gating-invalid-multiple` (`noemit` + `conflicting-gating-fn` already
/// matched at the static-gating floor).
///
/// ## Stage-16 round 2: top-level object-/array-nested function discovery (1332 -> 1335, +3)
///
/// `findFunctionsToCompile` (`Program.ts:495-559`) is a full `program.traverse` that
/// visits EVERY `(Arrow)FunctionExpression`/`FunctionDeclaration` whose enclosing
/// function scope is the program; in `compilationMode: 'all'` (the harness default)
/// the only gate is `fn.scope.getProgramParent() !== fn.scope.parent`. An object
/// literal creates no scope, so an arrow that is a property *value* at the top level
/// (`const _ = { useHook: () => {} }`, `FIXTURE_ENTRYPOINT = { fn: () => {} }`) has
/// the program as its scope parent and IS visited, compiled, and (when `@gating` is
/// active) wrapped in the gating conditional. The Rust target collector only matched
/// the hand-enumerated declarator/export forms, so those nested function-likes were
/// never discovered — invisible without `@gating` (an empty `() => {}` compiles to
/// itself) but a divergence the gating corpus exposes. `push_expression` now descends
/// into top-level object-property values (skipping computed keys + `ObjectMethod`s —
/// babel's `getFunctionName`/`findFunctionsToCompile` never visit those) and array
/// elements, resolving the candidate name from a bare-identifier property key
/// (`getFunctionName`'s object-property branch). Recovered the two gating fixtures
/// `gating-nonreferenced-identifier-collision`, `invalid-fnexpr-reference` plus
/// `try-catch-optional-call` (whose `FIXTURE_ENTRYPOINT` nests arrows several levels
/// deep inside `params`/`sequentialRenders` arrays+objects — now discovered and
/// compiled, matching the oracle's traversal).
///
/// Remaining gating gaps are out of this stage's scope:
///   * `dynamic-gating-bailout-nopanic` — needs `validatePreservedManualMemoization`
///     (`Pipeline.ts:498-503`). The pass logic was ported and verified, but enabling
///     it regresses ~21 currently-matching fixtures carrying
///     `@enablePreserveExistingMemoizationGuarantees:false`: in those, the Rust
///     reactive IR places the `FinishMemoize` decl *inside* its own (kept) memoized
///     scope as a scoped temporary, whereas the TS IR places it as an unscoped frozen
///     temporary *outside* the scope, so `isUnmemoized` false-positives. That is a
///     pre-existing `BuildReactiveScopeTerminals`/freeze-under-`@enable:false` IR
///     divergence, not a gating concern — so the validation is left unported and this
///     one fixture stays an honest mismatch (the alternative would violate the
///     no-regression gate).
///   * `codegen-instrument-forget-gating-test` — the `@enableEmitInstrumentForget`
///     feature (a separate codegen feature, not gating).
///
/// ## Stage-17: enableEmitInstrumentForget + enableEmitHookGuards (1337 -> 1341, +4)
///
/// Ported two config-gated codegen features, each off by default (so non-feature
/// fixtures are untouched). Both add their imports from `react-compiler-runtime`,
/// which sorts FIRST by module `localeCompare` (`react-compiler-runtime` <
/// `react/compiler-runtime`), so the import is prepended on top of the `_c`/gating
/// imports — matching `addImportsToProgram`'s sorted unshift.
///   * **`enableEmitInstrumentForget`** (`CodegenReactiveFunction.ts:247-307`): the
///     `@enableEmitInstrumentForget` pragma maps to the `testComplexConfigDefaults`
///     object (`Utils/TestUtils.ts:42-52`) — `fn = useRenderCounter`, `gating =
///     shouldInstrument`, `globalGating = 'DEV'`. For each *named* compiled function,
///     an `if (DEV && shouldInstrument) useRenderCounter("<id>", "<filepath>");` is
///     unshifted onto the body (ABOVE the `const $ = _c(N)` preface). The import-local
///     names are `newUid`-resolved against the program-wide identifier set (so
///     `shouldInstrument` collides to `_shouldInstrument3` in
///     `conflict-codegen-instrument-forget`, while the hook-named `useRenderCounter`
///     keeps its name). `<filepath>` is the harness's `'/' + path.basename + '.ts'`
///     (`harness.ts:152-156`); the corpus's `__`-flattened subdir name is de-flattened
///     to recover `path.basename`. Recovered `codegen-instrument-forget-test`,
///     `conflict-codegen-instrument-forget`,
///     `gating__codegen-instrument-forget-gating-test`.
///   * **`enableEmitHookGuards`** (`CodegenReactiveFunction.ts:150-159,1352-1424`):
///     the `@enableEmitHookGuards` pragma maps to the `$dispatcherGuard` external
///     function (`Utils/TestUtils.ts:53-56`). The whole compiled body is wrapped in
///     `try { $dispatcherGuard(0); … } finally { $dispatcherGuard(1); }` (the cache
///     preface stays ABOVE the try), and every *hook* call (`getHookKind(...) != null`
///     on the callee/method identifier, reusing the existing
///     `infer_reactive_places::get_hook_kind`) is wrapped in a `(function () { try {
///     $dispatcherGuard(2); return <call>; } finally { $dispatcherGuard(3); } })()`
///     IIFE. Recovered `flag-enable-emit-hook-guards`.
///
/// The floor is pinned at the measured 1341.
///
/// ## Stage-17 round 2: reanimated module type provider (1341 -> 1342, +1)
///
/// Ported the `react-native-reanimated` module type
/// (`Globals.ts::getReanimatedModuleType`, `HIR/Environment.ts:603-606`), gated on
/// the `@enableCustomTypeDefinitionForReanimated` pragma (off by default, so
/// non-feature fixtures are untouched). When the flag is set,
/// `TypeProvider::resolve_module_type` resolves `react-native-reanimated` to a
/// module object whose typed exports install: 6 frozen hooks (`useAnimatedProps`
/// etc. — freeze args, frozen `Poly` return, `noAlias`, `hookKind: Custom`), 2
/// mutable hooks (`useSharedValue`/`useDerivedValue` — freeze args, mutable
/// `ReanimatedSharedValueId` object return, `noAlias`, `hookKind: Custom`), and 7
/// value-producing functions (`withTiming` etc. — read args, mutable `Poly`). The
/// frozen-hook freeze of the inline animation callback keeps it from escaping into a
/// reactive scope, so `useAnimatedProps(() => …)` no longer memoizes its argument:
/// `reanimated-no-memo-arg` drops from `_c(4)` (callback + JSX memoized) to the
/// oracle's `_c(2)` (only the JSX). Recovered `reanimated-no-memo-arg`;
/// `reanimated-shared-value-writes` already matched. The shapes are installed
/// unconditionally into the registry (like the shared-runtime shapes) but only
/// reachable via the gated module resolution, so the flag is the sole activation
/// point.
///
/// `idx-no-outlining` is NOT recoverable and remains an INHERENT post-plugin
/// mismatch (already documented above): the corpus `.code` is the output of
/// babel-plugin-idx, which runs AFTER the compiler (`harness.ts` `FORGET_PLUGINS`)
/// and rewrites `idx(props, _ => _.group.label)` into a safe-navigation ternary
/// (`(_ref = props) != null ? …`), dropping the `idx` import. The
/// compiler-attributable behavior — recognizing `@customMacros:"idx"` and NOT
/// outlining the lambda — is already correct in the Rust port (the memo-block shape
/// `_c(4)` is byte-identical to the oracle); only the un-transformed `idx(...)`
/// surface differs, which the React Compiler never produces the ternary form of.
///
/// ## Stage-17 round 3: fast-refresh source hash (1342 -> 1344, +2)
///
/// Ported `enableResetCacheOnSourceFileChanges`
/// (`CodegenReactiveFunction.ts:127-243`), gated on the
/// `@enableResetCacheOnSourceFileChanges` pragma (off by default, so non-feature
/// fixtures are untouched). When the flag is set, `compile_module` precomputes a
/// source hash — Node's `createHmac('sha256', fn.env.code).digest('hex')`, i.e.
/// `HMAC-SHA256(key = source bytes, message = "")` hex-encoded, reproduced
/// dependency-free by the hand-rolled `codegen::hash` (FIPS 180-4 SHA-256 + RFC
/// 2104 HMAC, validated against the NIST/RFC-4231 vectors AND both fixtures'
/// baked-in hashes). Each top-level `codegenFunction` reserves cache slot 0 for
/// the hash via `cacheIndex = cx.nextCacheIndex` BEFORE codegen runs, so every
/// reactive scope allocates from slot 1 onward; when the function uses the cache
/// at all, the preface emits — right after `const $ = _c(N)` — a guard that resets
/// every slot to `Symbol.for("react.memo_cache_sentinel")` when the stored hash
/// differs, then records the new hash. Outlined functions get a fresh Context with
/// no fast-refresh state (so the dev fixture's `_temp` helper has no reset block),
/// matching the TS where outlined fns go through `codegenReactiveFunction` directly
/// rather than `codegenFunction`. Recovered `fast-refresh-reloading` (`_c(8)`, hash
/// on `$[0]`, scopes `$[1]..$[7]`) and `fast-refresh-refresh-on-const-changes-dev`
/// (`_c(3)`); `fast-refresh-dont-refresh-const-changes-prod` (no pragma) already
/// matched and stays unchanged.
///
/// The floor is pinned at the measured 1344.
///
/// ## Stage-17 round 4: genuine-complex IR bugs (1344 -> 1351, +7)
///
/// Three faithful IR-level fixes, each reproduced at its diverging stage before
/// being ported per the TS (no overfit):
///
///   * **lint-mode scope-rename side-effect** (+2: `valid-setState-in-effect-
///     from-ref-function-call`, `valid-setState-in-useEffect-controlled-by-ref-
///     value`). In `outputMode: 'lint'` the TS `Program.ts` `processFn` never emits
///     a compiled function, so the *only* change to the source is the binding-
///     collision rename `HIRBuilder.ts:290-292` performs via
///     `babelBinding.scope.rename(originalName, resolvedName)` (mutating the original
///     Babel AST, then printed). `resolveBinding` renames a shadowing binding
///     `<name>_<index>` (e.g. an inner `ref` param shadowing an outer `const ref`
///     becomes `ref_0`). The Rust `resolve_binding` already computed the renamed
///     identifier; this round records each `(symbol, resolved_name)` rename on the
///     `HirBuilder` (bubbled up from nested fns), threads it out of `lower`
///     (`lower_with_renames`), and a new `compile::lint_rename_source` replays the
///     renames onto the source AST in the lint-mode codegen path (instead of
///     returning the source verbatim). Only activates under `@outputMode:"lint"`/
///     `@noEmit`; absent any collision the source is byte-identical.
///
///   * **dependency-path granularity** (+1 directly, +2 total: `repro-context-var-
///     reassign-no-scope`). `getAssumedInvokedFunctions`
///     (`CollectHoistablePropertyLoads.ts`) treats a hook callback (`useEffect(cb,
///     [deps])`) as assumed-invoked so the compiler descends into the callback and
///     keeps its interior reads (`users.length`) as *granular* hoistable
///     dependencies. The Rust `callee_is_hook` only matched `BuiltInUse*` shapes /
///     hook names, so `useEffect` (typed `DefaultNonmutatingHook`/
///     `BuiltInUseEffectHook`) was not recognized, the callback was not descended,
///     and the dep widened `users.length -> users`. Fixed by delegating to the
///     shared `get_hook_kind` (`getHookKind`-equivalent shape-id map).
///
///   * **reactive-scope reordering / over-merge** (+1 directly, +3 total:
///     `reordering-across-blocks`). `PropagateScopeDependenciesHIR`'s processed-in-
///     optional set (`#processedInstrsInOptional`) is keyed in the TS by instruction
///     *object identity*, unique across nested functions. The Rust port keyed it by
///     `InstructionId`, which is allocated per-function (numbered from 1 in each
///     nested body), so a `config?.onA?.()` `StoreLocal` *inside* the `a` lambda
///     aliased the outer `const a = …` `StoreLocal` at the same id, wrongly deferring
///     it — dropping `a` from the object scope's dependencies and its own scope
///     declaration, which cascaded into an incorrect scope merge. Re-keyed
///     `ProcessedKey` on globally-unique `IdentifierId`s (the matched `StoreLocal`'s
///     lvalue id and the test `Branch`'s test-operand id), recovering the +3
///     fixtures the id-collision affected. Verified at the IR stage with a fresh
///     `nested-fn-optional-chain-scope-dep.PropagateScopeDependenciesHIR.hir` oracle
///     ref (TS verifier `--hir --stage PropagateScopeDependenciesHIR`).
///
/// Stage-17: `hook-call-freezes-captured-memberexpr` (previously a deferred
/// `typescript-types` mismatch) now matches — porting `freezeValue`'s transitive
/// freeze of FunctionExpression captures (`InferMutationAliasingEffects.ts:1466-1474`)
/// freezes the `useIdentity`-frozen captured member-expression rather than leaving it
/// mutable, so its scope is no longer over-merged.
///
/// (Stage-18 update — the 2 `typescript-types` mismatches
/// `new-mutability__transitivity-add-captured-array-to-itself` /
/// `…phi-assign-or-capture` are now CODE-FIXED, see the Stage-18 CLASS-B note
/// below: the missing `typedCapture`/`typedCreateFrom`/`typedMutate` aliasing
/// signatures were registered, so the captured value's mutable range is no longer
/// inflated and the frozen `{a}` scope is no longer over-merged.)
/// The remaining 34 `fbt` + `idx-no-outlining` mismatches are INHERENT post-plugin
/// (babel-plugin-fbt / babel-plugin-idx) transformations, not compiler-attributable
/// (documented in prior rounds).
///
/// The floor is pinned at the measured 1353. (Stage-17: porting
/// `freezeValue`'s transitive freeze of FunctionExpression captures —
/// `InferMutationAliasingEffects.ts:1466-1474`, gated on
/// `enablePreserveExistingMemoizationGuarantees || enableTransitivelyFreezeFunctionExpressions`
/// (default true) — recovered `useCallback-call-second-function-which-captures-
/// maybe-mutable-value-preserve-memoization` and `hook-call-freezes-captured-
/// memberexpr`: a captured maybe-mutable value frozen through a callback no longer
/// drags those callbacks into one over-merged reactive scope, so the preserved
/// manual memoization survives. +2 matched, 0 regressions.)
///
/// ## Stage-18 dual-oracle corpus harness (1353 -> 1389, +36)
///
/// **PROMINENT NOTE — the corpus is scored against TWO oracle kinds, selected per
/// fixture by an optional 4th `manifest.tsv` column (default `.expect.md`). The
/// split is an explicit, committed, auditable manifest.**
///
/// The fixture test harness (`react-compiler/src/__tests__/runner/harness.ts`)
/// chains babel-plugin-fbt + babel-plugin-fbt-runtime + babel-plugin-idx AFTER the
/// React Compiler and then formats with prettier. So some `.expect.md` `## Code`
/// blocks bake in (i) downstream-plugin output the React Compiler NEVER emits
/// (`fbt(...)` -> `fbt._(...)`/`fbt._param(...)`, bare `idx(...)` -> a safe-
/// navigation ternary) and (ii) prettier reformats that alter the compiler's real
/// output (e.g. `timers`: prettier collapsed a SIGNIFICANT JSX whitespace the
/// compiler emits; `tagged-template-literal`: prettier re-indented a template-
/// literal body). For these fixtures the React Compiler's OWN output is correct,
/// and the only faithful oracle is the compiler-only capture.
///
///   * **`.expect.md` oracle** (`<name>.code`, initially 1363 fixtures; 1362 after
///     fix #2 promoted `existing-variables-with-c-name` to `.cc.code`): the FULL
///     harness pipeline (React Compiler + chained fbt/idx + prettier). Default.
///   * **`.cc.code` oracle** (`<name>.cc.code`, initially 35 fixtures; 36 after
///     fix #2 below promoted `existing-variables-with-c-name`): the React Compiler
///     ALONE, captured byte-verbatim via `react-compiler/src/verify/capture-code.ts`
///     (run from the `react-compiler` dir: `npx --no-install tsx
///     src/verify/capture-code.ts <ABS_FIXTURE>` — `BabelPluginReactCompiler` with
///     the shared-runtime type provider, NO fbt/idx plugins, NO prettier; babel-
///     generator output).
///
/// **Honesty gate (non-negotiable).** A fixture was moved to `.cc.code` ONLY after
/// PROVING — by diffing `capture-code.ts` output vs the `.expect.md` `## Code` — that
/// the sole divergence is a downstream plugin (fbt/idx) or a prettier reformat, AND
/// that the Rust compiler-only `codegen()` output canonical-matches the capture. All
/// 35 do (35/35), and `corpus_parity_report` hard-asserts `cc_matched == cc_total`.
/// The split is: 33 `downstream-plugin:fbt`, 1 `downstream-plugin:idx`
/// (`idx-no-outlining`), 1 `prettier-artifact:jsx-whitespace` (`timers`), 1
/// `prettier-artifact:template-literal-reindent` (`tagged-template-literal`) —
/// recorded as `# <name>: <reason>` comments above each entry in `manifest.tsv`.
/// `examples/verify_corpus_integrity` re-derives EVERY `.cc.code` ref from
/// `capture-code.ts` and asserts byte-identity (no ref is hand-edited / fabricated).
///
/// **The +1 base gain (1353 -> 1354)** is NOT an oracle swap: `regen_corpus`'s
/// cache-import comment line-split now also handles the CommonJS `const { c: _c } =
/// require("react/compiler-runtime"); // <comment>` form (emitted for `@script`
/// source-type fixtures), so `script-source-type` matches its own `.expect.md`
/// oracle. No fixture regressed.
///
/// **NOT promoted — deliberately left as residual mismatches (initially 9 total):**
///   * 3 genuine bailout bugs (CLASS B, code-fix next): `gating__dynamic-gating-
///     bailout-nopanic`, `should-bailout-without-compilation-annotation-mode`,
///     `should-bailout-without-compilation-infer-mode`. The compiler-only oracle
///     leaves these functions VERBATIM (the compiler bails); the Rust output wrongly
///     compiles + gates them. Routing them to `.cc.code` would MASK the bug, so they
///     stay on `.expect.md` and are NOT promoted (their `cc.code` would not match).
///   * `existing-variables-with-c-name` — initially MIS-LABELLED a "deep IR bug"; on
///     audit it is NOT a Rust bug at all (the `_c` -> `_c2` cache-import UID-collision
///     rename is ALREADY correct), but a PRETTIER-version artifact in the committed
///     `.expect.md`. PROMOTED to the `.cc.code` oracle in code-fix #2 below; see that
///     note for the full proof.
///   * 3 compiler-only CAPTURE artifacts that are NOT downstream-plugin/prettier and
///     do NOT canonical-match the capture, so they cannot be promoted: `fbt__fbt-
///     param-with-unicode` (babel-generator escapes `☺` -> `☺` in a JSX
///     attribute; oxc keeps the literal — a generator string-escaping artifact in
///     the capture itself), `fbt__recursively-merge-scopes-jsx` and `repro-no-value-
///     for-temporary-reactive-scope-with-early-return` (the `@babel/parser` capture
///     keeps the leading `// @flow` comment that the corpus/HermesParser path + Rust
///     both drop — a parser comment-handling difference in the capture, not a Rust
///     bug). The memoization is byte-identical in all three.
///
/// The floor is raised to the measured 1389 (1354 base + 35 compiler-only).
/// Stage 18 dual-oracle floor: 1354 base (`.expect.md`) matches + 35 compiler-only
/// (`.cc.code`) matches = 1389. The base count rose 1353 -> 1354 only because the
/// `require`-form cache-import comment normalization in `regen_corpus` made
/// `script-source-type` match its own `.expect.md` oracle (no fixture regressed).
/// The 35 compiler-only matches are PROVEN class-A (see the module note below).
///
/// ## Stage-18 genuine CLASS-B code-fix #1 — `typedCapture`/`typedCreateFrom`/
/// `typedMutate` aliasing signatures (1389 -> 1391, +2, base)
///
/// `new-mutability__transitivity-add-captured-array-to-itself` and
/// `…phi-assign-or-capture` were CODE-FIXED (NOT oracle-swapped — they stay on the
/// `.expect.md` base oracle and now match it). Root cause: the `shared-runtime`
/// module type provider's typed functions `typedCapture`/`typedCreateFrom`/
/// `typedMutate` (`makeSharedRuntimeTypeProvider`) carry explicit `aliasing`
/// configs, but the Rust shared-runtime module shape only registered
/// `default`/`graphql`/`typedLog`/`typedArrayPush` + the typed hooks — so those
/// three imports fell through to the generic untyped-function fallback, whose
/// `MaybeAlias` + `MutateTransitiveConditionally` effects (instead of the signature's
/// single `Capture @value -> @return`) inflated the captured value's mutable range at
/// `InferMutationAliasingRanges`. That over-extended range merged the frozen `useMemo
/// {a}` scope into the `[o]` scope, dropping a cache slot (18 vs the oracle's 19).
/// Fix: register the typed functions' shapes (return types `Array`/`Any`/`Primitive`,
/// ids `<generated_121/122/123>`, matching the `InferTypes` oracle) and their
/// `aliasing` signatures (`Create`+`Capture` / `CreateFrom` / `Create`+`Mutate`+
/// `Capture`) in `environment::shapes`. The `typedIdentity`/`typedAssign`/`typedAlias`
/// signatures (ids `118/119/120`) were registered alongside for completeness (their
/// two fixtures already matched and still do). Both fixtures are now at byte-exact
/// strict IR-stage parity at `InferMutationAliasingRanges`
/// (`tests/hir_parity_stage3.rs`, 97/97). No fixture regressed.
///
/// ## Stage-18 fix #2 — `existing-variables-with-c-name` is a PRETTIER artifact,
/// not an IR bug (1391 -> 1392, +1; promoted base -> `.cc.code`)
///
/// The Stage-18 recon flagged this as a CLASS-B "deep IR bug" (program-level cache-
/// import UID collision). On audit that label is WRONG: the Rust output is already
/// the React Compiler's real output, and the `_c` -> `_c2` rename it needs (the local
/// `const _c = c;` collides with the cache import) is ALREADY implemented correctly
/// (the Rust output emits `import { c as _c2 } from "react/compiler-runtime"`). The
/// sole divergence from the committed `.expect.md` `## Code` is comment PLACEMENT:
///   - `.expect.md` (base oracle): `import { c as _c2 } from "react/compiler-runtime";
///     // @enablePreserveExistingMemoizationGuarantees:false …` — the first-line pragma
///     comment baked onto the prepended cache-import line as a TRAILING comment.
///   - Rust + the React Compiler's OWN output: the pragma comment on its OWN line,
///     as a LEADING comment on the original first `import { useMemo, useState }` line.
///
/// PROOF this is a prettier-version artifact (the HONESTY gate, fully auditable):
///   1. Running the React Compiler ALONE on this fixture through the snapshot
///      harness's exact plugin-option path (`harness.ts:158-186`, minus the chained
///      fbt/idx plugins, minus prettier) — i.e. `src/verify/capture-code.ts` — emits
///      the comment on its OWN line, in BOTH raw babel-generator output AND when that
///      output is re-run through the current prettier. The trailing-comment form in
///      the committed `.expect.md` was produced by an OLDER prettier and does not
///      reproduce.
///   2. The directly-comparable fixture `allow-modify-global-in-callback-jsx` has the
///      IDENTICAL source shape (same first-line pragma, then `import {useMemo} …`) but
///      no `_c` collision; its `.expect.md` keeps the comment on its OWN line — exactly
///      matching the Rust output. The only thing that differs in
///      `existing-variables-with-c-name` is the `_c2` rename, which does not affect
///      comment attachment in babel-generator (verified by reproduction).
///   3. The Rust compiler-only `codegen()` output canonical-MATCHES the `.cc.code`
///      capture (the corpus harness scores it 36/36 compiler-only, and a direct
///      `canonicalize(rust) == canonicalize(cc.code)` check returns true).
///
/// So this is a genuine CLASS-A prettier artifact, NOT a code bug — promoted to the
/// `.cc.code` oracle with reason `prettier-artifact:leading-pragma-comment`. To make
/// `capture-code.ts` a FAITHFUL compiler-only oracle for it, `capture-code.ts` was
/// brought in line with the harness's plugin-option construction (it previously
/// omitted `validatePreserveExistingMemoizationGuarantees`, `assertValidMutableRanges`,
/// the no-op `logger`, `enableReanimatedCheck:false`, `target:'19'`); the harness sets
/// `validatePreserveExistingMemoizationGuarantees` from the first-line pragma, while
/// the schema default is `true`, which had made `capture-code.ts` spuriously THROW the
/// preserve-memoization validation on this fixture. With the option construction
/// matched, all 35 prior `.cc.code` refs re-derive byte-identical (verified), and the
/// new 36th derives cleanly. Compiler-only oracle now 36/36 (was 35/35).
///
/// ## Stage-18 genuine fix #3 — the last 6 mismatches: HONEST 100% (1392 -> 1398)
///
/// The 6 residual mismatches split into 3 genuine CLASS-B compiler bugs (code-fixed)
/// and 3 CLASS-A capture-tool fidelity gaps (`capture-code.ts` was made faithful,
/// then the proven-class-A fixtures were promoted). NONE were oracle-swapped to hide
/// a bug. Final: **1398/1398 = 100.0%, PANIC=0, UNSUPPORTED=0, MISMATCH=0**, base
/// (.expect.md) 1359/1359, compiler-only (.cc.code) 39/39 (hard-asserted).
///
/// **CLASS-B genuine compiler bugs (code-fixed, stay on `.expect.md` and now match):**
///   * **render-unsafe side-effect bailout** (`should-bailout-without-compilation-
///     infer-mode`, `should-bailout-without-compilation-annotation-mode`). A
///     component/hook that reassigns a module-level global at render time
///     (`someGlobal = 'wat'`) is a `StoreGlobal` → `MutateGlobal` aliasing effect that
///     `inferMutationAliasingRanges` records as a `Globals` diagnostic (the TS
///     `appendFunctionErrors`/`shouldRecordErrors` path, `!isFunctionExpression &&
///     env.enableValidations`, the latter always true). The TS pipeline returns `Err`
///     (`Pipeline.ts:527` `env.hasErrors()`); under `@panicThreshold:"none"`
///     `handleError` leaves the function VERBATIM. The Rust port discarded the
///     top-level `infer_mutation_aliasing_ranges` return value (so it wrongly compiled
///     + gated these). Fixed by surfacing a `RENDER_SIDE_EFFECT_ERROR` when the
///     returned top-level effects contain a direct `MutateGlobal`/`MutateFrozen`/
///     `Impure` (the per-instruction render-side-effect path, never a bubbled nested-fn
///     effect — so callback global mutations like `allow-modify-global-in-callback-jsx`
///     are untouched), mapped to a recoverable verbatim bailout under
///     `@panicThreshold:"none"` exactly like the hooks-validation case (+2).
///   * **`validatePreservedManualMemoization`** (`gating__dynamic-gating-bailout-
///     nopanic`). A manual `useMemo(() => identity(value), [])` whose inferred dep
///     (`value`) does not match the empty source deps must bail (the TS
///     `PreserveManualMemo` diagnostic, `Pipeline.ts:498-503`, gated
///     `enablePreserveExistingMemoizationGuarantees || validatePreserveExistingMemoizationGuarantees`).
///     Ported the full pass (`reactive_scopes::validate_preserved_manual_memoization`:
///     `compareDeps`/`validateInferredDep`/`isUnmemoized` + the StartMemoize-operand
///     scope-completion check) on the post-`pruneHoistedContexts` reactive IR. TWO
///     prerequisite faithfulness fixes made this regression-free (the prior round's
///     ~21-fixture regression was an artifact of those gaps):
///       (a) `EnvironmentConfig::validate_preserve_existing_memoization_guarantees`
///           now defaults `false`, matching the harness's
///           `firstLine.includes('@validatePreserveExistingMemoizationGuarantees')`
///           override (`harness.ts:158-160`) — it was wrongly `true`, so the pass
///           would have run on far more fixtures than the harness does.
///       (b) `PruneNonEscapingScopes` now marks `FinishMemoize.pruned = true` when all
///           memo decls are unscoped or in pruned scopes (`PruneNonEscapingScopes.ts:
///           1067-1119`'s `transformInstruction`, tracking `prunedScopes` +
///           `reassignments`) — the Rust port never set `pruned`, so a correctly-pruned
///           non-escaping `useMemo` (e.g. `preserve-memo-validation__prune-nonescaping-
///           useMemo`, whose oracle is an EMPTY-body compile) false-positived as
///           unmemoized. With both, the validation fires only where the TS does (+1, 0
///           regressions; all 11 transient regressors recovered).
///
/// **CLASS-A capture-tool fidelity gaps (proven, then promoted to `.cc.code`):**
///   * `fbt__recursively-merge-scopes-jsx`, `repro-no-value-for-temporary-reactive-
///     scope-with-early-return` (reason `downstream-plugin:fbt + flow-parser:comment-
///     strip`). Their `.expect.md` bakes in the babel-plugin-fbt transform (`fbt(...)`
///     -> `fbt._(...)`) AND retains a leading `// @flow` comment. The compiler-only
///     capture previously also kept the comment because `capture-code.ts` parsed with
///     `@babel/parser` (retains comments). The harness parses `@flow` files with
///     HermesParser (`harness.ts:65-66,111-118`), which is COMMENT-FREE. `capture-code.ts`
///     was made faithful — it now mirrors `harness.ts`'s `parseInput` exactly (Hermes
///     for `@flow`, `@script` source-type), so its output drops the comment, matching
///     the React Compiler's real flow output AND the Rust output canonically (proven
///     3/3 via `compiler_only_parity`).
///   * `fbt__fbt-param-with-unicode` (reason `downstream-plugin:fbt + babel-generator:
///     non-ascii-escape`). Its `.expect.md`/`.cc.code` both emit `name="user name
///     ☺"` — babel-generator's `jsesc` escapes the non-ASCII `☺` in the bare
///     `<fbt:param>` JSX attribute. The Rust codegen kept the literal `☺`. The React
///     Compiler's OWN output is `☺`, so to faithfully match it the bare
///     fbt-operand JSX-attribute path now escapes non-ASCII codepoints to `\uXXXX`
///     (UTF-16 code units, `escape_non_ascii`) — scoped to that path only (the non-fbt
///     path already uses an expression container `text={"…\u…"}`, a JS string literal
///     where `\u` IS a valid escape, so `jsx-string-attribute-non-ascii` was and stays
///     matching). The capture then matches canonically; promoted.
///
/// `capture-code.ts` honesty: each promotion was gated on
/// `canonicalize(rust_codegen) == canonicalize(capture-code.ts output)` (verified 3/3),
/// and `examples/verify_corpus_integrity` re-derives ALL 39 `.cc.code` refs from
/// `capture-code.ts` and asserts byte-identity. No ref was hand-edited. `regen_corpus`
/// rewrites 0 of the 1359 `.code` + 39 `.cc.code` refs.
const PARITY_FLOOR: usize = 1398;

fn corpus_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/corpus")
}

/// Normalize CRLF + trailing whitespace so the comparison is OS-stable.
fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").trim_end().to_string()
}

/// The oracle a fixture is scored against (Stage 18 dual-oracle; 4th manifest
/// column, default [`OracleKind::ExpectMd`]).
#[derive(Clone, Copy, PartialEq, Eq)]
enum OracleKind {
    /// `<name>.code` from the fixture's `.expect.md` `## Code` block — the FULL
    /// harness pipeline (React Compiler + chained babel-plugin-fbt/idx + prettier).
    ExpectMd,
    /// `<name>.cc.code` from `src/verify/capture-code.ts` — the React Compiler
    /// ALONE (no chained fbt/idx plugins, no prettier). A fixture is routed here
    /// ONLY when proven that the sole divergence from `.expect.md` is a downstream
    /// plugin (`fbt(...)`->`fbt._(...)`, bare `idx(...)`->a safe-nav ternary) or a
    /// prettier reformat that alters the compiler's real output (e.g. `timers`
    /// JSX-whitespace), AND the Rust compiler-only output canonical-matches this
    /// capture. Genuine compiler bugs are NEVER routed here — they are code-fixed.
    CompilerOnly,
}

impl OracleKind {
    fn parse(col: Option<&str>) -> OracleKind {
        match col.map(str::trim) {
            Some(".cc.code") => OracleKind::CompilerOnly,
            Some(".expect.md") | Some("") | None => OracleKind::ExpectMd,
            Some(other) => panic!("unknown manifest oracle-kind {other:?}"),
        }
    }
}

struct Fixture {
    name: String,
    ext: String,
    source: String,
    oracle: String,
    oracle_kind: OracleKind,
}

/// Load every corpus fixture from the manifest (sanitized name, extension, the
/// source paired with its oracle ref, and which oracle kind that ref is). `#`
/// reason-comment lines (the auditable compiler-only split) are skipped.
fn collect_fixtures() -> Vec<Fixture> {
    let dir = corpus_dir();
    let manifest = fs::read_to_string(dir.join("manifest.tsv")).expect("read corpus manifest");
    let mut out = Vec::new();
    for line in manifest.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let mut parts = line.splitn(4, '\t');
        let (Some(name), Some(ext), Some(_path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let oracle_kind = OracleKind::parse(parts.next());
        let code_file = match oracle_kind {
            OracleKind::ExpectMd => format!("{name}.code"),
            OracleKind::CompilerOnly => format!("{name}.cc.code"),
        };
        let code_path = dir.join(&code_file);
        let src_path = dir.join(format!("{name}.src.{ext}"));
        let (Ok(oracle), Ok(source)) = (
            fs::read_to_string(&code_path),
            fs::read_to_string(&src_path),
        ) else {
            continue;
        };
        out.push(Fixture {
            name: name.to_string(),
            ext: ext.to_string(),
            source,
            oracle,
            oracle_kind,
        });
    }
    out
}

/// The category of a non-matching fixture.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Bucket {
    Match,
    Panic,
    Unsupported,
    Mismatch,
}

/// Run the Rust pipeline on one fixture, classifying the result. Panics are
/// caught so a single bad fixture cannot abort the whole measurement.
fn classify(fixture: &Fixture) -> (Bucket, Option<String>) {
    let filename = format!("{}.{}", fixture.name, fixture.ext);

    // Detect structured (UNSUPPORTED) errors first, under catch_unwind, using the
    // same Program-level options (`compilationMode`, opt-out directives, …) the
    // whole-module `compile_module`/`codegen` path uses, so the bucketing reflects
    // what is actually compiled (a directive-skipped or mode-skipped function is
    // flagged `opt_out`, NOT an error).
    let source = fixture.source.clone();
    let fname = filename.clone();
    let compiled = panic::catch_unwind(AssertUnwindSafe(|| {
        let options = ModuleOptions::from_source(&source);
        compile_to_reactive_with_options(&source, &fname, &options)
    }));
    let Ok(compiled) = compiled else {
        return (Bucket::Panic, None);
    };
    let unsupported: Option<String> = compiled
        .iter()
        .find_map(|c| c.error.clone());

    // Run codegen (also under catch_unwind).
    let source = fixture.source.clone();
    let fname = filename.clone();
    let rust = panic::catch_unwind(AssertUnwindSafe(|| codegen(&source, &fname)));
    let Ok(rust_output) = rust else {
        return (Bucket::Panic, None);
    };

    let oracle_canonical = normalize(&canonicalize(&fixture.oracle));
    let rust_canonical = normalize(&canonicalize(&rust_output));
    if oracle_canonical == rust_canonical {
        return (Bucket::Match, None);
    }
    if let Some(err) = unsupported {
        return (Bucket::Unsupported, Some(err));
    }
    (Bucket::Mismatch, None)
}

/// Coarse construct/pragma sub-category for a non-matching fixture, derived from
/// its source + name. Used to size the largest buckets for the fix rounds.
fn subcategory(fixture: &Fixture) -> &'static str {
    let s = &fixture.source;
    let n = &fixture.name;
    // Pragmas / directives first (they gate whole features).
    if s.contains("@gating") || s.contains("'use no memo'") || s.contains("\"use no memo\"") {
        return "gating/use-no-memo";
    }
    if s.contains("useMemoCache") || s.contains("react-compiler-runtime") {
        return "preexisting-runtime";
    }
    if n.contains("fbt") || s.contains("<fbt") || s.contains("fbt(") {
        return "fbt";
    }
    if s.contains("function*") || s.contains("yield ") || s.contains("yield(") {
        return "generators";
    }
    if s.contains("async ") || s.contains("await ") {
        return "async/await";
    }
    if s.contains("try ") || s.contains("try{") || s.contains("} catch") || s.contains("finally") {
        return "try/catch/finally";
    }
    if s.contains("class ") {
        return "class";
    }
    if s.contains("```") {
        return "tagged-template";
    }
    if n.starts_with("error.") || n.contains("__error") {
        return "error-fixture";
    }
    if s.contains(": ") && (fixture.ext == "ts" || fixture.ext == "tsx") {
        return "typescript-types";
    }
    "other"
}

/// `(matched, total, panics, unsupported, mismatch, sub-counts, samples)`.
fn tally() -> Report {
    let fixtures = collect_fixtures();
    let total = fixtures.len();
    let mut matched = 0usize;
    let mut cc_total = 0usize;
    let mut cc_matched = 0usize;
    let mut panics = Vec::new();
    let mut unsupported: Vec<(String, &'static str)> = Vec::new();
    let mut mismatch: Vec<(String, &'static str)> = Vec::new();
    for fixture in &fixtures {
        let is_cc = fixture.oracle_kind == OracleKind::CompilerOnly;
        if is_cc {
            cc_total += 1;
        }
        let (bucket, _err) = classify(fixture);
        match bucket {
            Bucket::Match => {
                matched += 1;
                if is_cc {
                    cc_matched += 1;
                }
            }
            Bucket::Panic => panics.push(fixture.name.clone()),
            Bucket::Unsupported => unsupported.push((fixture.name.clone(), subcategory(fixture))),
            Bucket::Mismatch => mismatch.push((fixture.name.clone(), subcategory(fixture))),
        }
    }
    Report {
        total,
        matched,
        cc_total,
        cc_matched,
        panics,
        unsupported,
        mismatch,
    }
}

struct Report {
    total: usize,
    matched: usize,
    /// Number of compiler-only (`.cc.code`) fixtures, and how many matched.
    cc_total: usize,
    cc_matched: usize,
    panics: Vec<String>,
    unsupported: Vec<(String, &'static str)>,
    mismatch: Vec<(String, &'static str)>,
}

fn print_subcounts(label: &str, items: &[(String, &'static str)]) {
    use std::collections::BTreeMap;
    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    for (_, cat) in items {
        *counts.entry(cat).or_insert(0) += 1;
    }
    eprintln!("  {label} ({}) by construct:", items.len());
    let mut sorted: Vec<_> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    for (cat, n) in sorted {
        // A few example fixtures per category.
        let examples: Vec<&str> = items
            .iter()
            .filter(|(_, c)| *c == cat)
            .take(4)
            .map(|(name, _)| name.as_str())
            .collect();
        eprintln!("    {cat:<22} {n:>4}   e.g. {}", examples.join(", "));
    }
}

/// Measured full-corpus canonical parity. Reports the matched/total count plus
/// the categorized buckets; asserts only the [`PARITY_FLOOR`] so the long tail is
/// a measured number, not a brittle gate. Run with `--nocapture` to see the
/// report.
#[test]
fn corpus_parity_report() {
    let report = tally();
    eprintln!(
        "\n=== Corpus canonical parity: {}/{} fixtures matched ({:.1}%) ===",
        report.matched,
        report.total,
        100.0 * report.matched as f64 / report.total.max(1) as f64
    );
    let base_total = report.total - report.cc_total;
    let base_matched = report.matched - report.cc_matched;
    eprintln!(
        "  oracle split: base (.expect.md) {}/{} matched; compiler-only (.cc.code) {}/{} matched",
        base_matched, base_total, report.cc_matched, report.cc_total
    );
    eprintln!(
        "  buckets: PANIC={} UNSUPPORTED={} MISMATCH={}",
        report.panics.len(),
        report.unsupported.len(),
        report.mismatch.len()
    );
    if !report.panics.is_empty() {
        eprintln!("  PANIC fixtures: {}", report.panics.join(", "));
    }
    print_subcounts("UNSUPPORTED", &report.unsupported);
    print_subcounts("MISMATCH", &report.mismatch);
    // Print the full residual-mismatch set so the remaining (class-B + capture-
    // artifact) tail is fully auditable, not truncated to per-bucket examples.
    let residual: Vec<&str> = report.mismatch.iter().map(|(n, _)| n.as_str()).collect();
    eprintln!("  MISMATCH fixtures (full): {}", residual.join(", "));

    // Every compiler-only (`.cc.code`) fixture is PROVEN class-A — it MUST match.
    // A drift here means either `capture-code.ts` changed, a fixture was wrongly
    // promoted, or a compiler regression — all of which must fail the gate.
    assert_eq!(
        report.cc_matched, report.cc_total,
        "a compiler-only (.cc.code) fixture stopped matching its capture-code.ts \
         oracle: {}/{} matched. Compiler-only fixtures are proven class-A and must \
         always match; re-derive via `cargo run --example regen_corpus` and verify \
         the divergence is still a downstream-plugin/prettier artifact, NOT a bug.",
        report.cc_matched, report.cc_total
    );

    // Denominator honesty: the true emitting-fixture universe is 1421 fixtures
    // (those whose `.expect.md` has a `## Code` block). 1398 of those are seeded +
    // scored here; the remaining 23 are excluded ONLY because oxc cannot parse
    // them (chiefly `.flow` Flow-syntax fixtures) — they can never match, so
    // scoring them would add 0/N noise. `examples/seed_corpus.rs` enumerates and
    // reports the excluded set; this is not a hidden subset.
    assert!(
        report.total >= 1398,
        "expected the full seedable emitting-fixture universe (1398 of the 1421 \
         fixtures whose oracle emits a `## Code` block; the other 23 are oxc-\
         unparseable Flow-syntax fixtures), found {}",
        report.total
    );
    // A panic is a hard bug per the spec — it must never happen.
    assert!(
        report.panics.is_empty(),
        "{} fixture(s) panicked (must be converted to structured errors): {}",
        report.panics.len(),
        report.panics.join(", ")
    );
    assert!(
        report.matched >= PARITY_FLOOR,
        "corpus parity regressed: {}/{} matched, expected >= {}",
        report.matched,
        report.total,
        PARITY_FLOOR
    );
}
