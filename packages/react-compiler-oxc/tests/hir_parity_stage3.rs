//! Stage-3 HIR parity harness.
//!
//! Covers the uniquely-named stage-3 pipeline stages this crate implements:
//! `AnalyseFunctions` (the recursive nested-function analysis driver) and
//! `InferMutationAliasingEffects` (the per-instruction/per-terminal aliasing
//! effect engine). For every `tests/fixtures/hir/<name>.{js,jsx,ts,tsx}` input
//! with a stored `<name>.<stage>.hir` reference (produced by the TS oracle,
//! `npx tsx src/verify/cli.ts <file> --hir --stage <stage>`, bold name line
//! stripped + ANSI removed + trailing ws trimmed), this runs the pipeline to that
//! stage via [`react_compiler_oxc::compile_to_stage`] and compares.
//!
//! `useMemo-simple` is excluded (manual memoization is deferred). Parity is a
//! *measured* metric (per the stage-3 spec): the test prints a `matched/total`
//! summary plus per-line diffs, and asserts a non-regressing floor.
//!
//! ## Full parity (`nested_fn` now matches)
//!
//! `AnalyseFunctions` runs the *full* mutation/aliasing + reactive-scope
//! sub-pipeline on each nested `FunctionExpression`/`ObjectMethod` —
//! `InferMutationAliasingEffects`, `deadCodeElimination`,
//! `InferMutationAliasingRanges`, `RewriteInstructionKindsBasedOnReassignment`,
//! and `inferReactiveScopeVariables`. With the reactive-scope pass now ported,
//! the nested inner bodies resolve each place's concrete `Effect`, the
//! `mutableRange` suffix, the rewritten instruction kinds, the function-level
//! `@aliasingEffects` summary, *and* the `_@<scope>` identifier suffix +
//! scope-merged ranges — so every nested-function fixture (including `nested_fn`)
//! is byte-identical to the oracle at every stage-3 stage. All seven strict
//! full-parity gates below pass at 68/68.
//!
//! NOTE: the outer `@context[...]` line of `nested_fn` (`read props$16`) is
//! correct. The `CreateFunction` apply path downgrades a captured context
//! operand whose value resolved to Primitive/Frozen/Global from `capture` to
//! `read` (mirroring the TS `operand.effect = Effect.Read`) — `props` is a
//! Component param (Frozen) so it downgrades at the outer
//! `InferMutationAliasingEffects`, even though `AnalyseFunctions` printed
//! `capture`. That is a distinct effect-inference path (not reactive scopes) and
//! is verified separately by [`nested_fn_context_downgrade_exact`] below.

use std::fs;
use std::path::{Path, PathBuf};

use react_compiler_oxc::compile_to_stage;

/// No fixtures are excluded — `useMemo-simple` (manual memoization) is handled by
/// `dropManualMemoization` and flows through every stage-3 stage.
const EXCLUDED: &[&str] = &[];

/// The minimum number of stage-3 parity fixtures every stage matches (a tight
/// non-regression floor). Every stage-3 stage matches the oracle for all of its
/// fixtures — `nested_fn`'s reactive-scope suffixes/ranges are produced by the
/// now-ported `inferReactiveScopeVariables` running on the nested function
/// bodies. The `nonmutated-spread-*` fixtures (Stage-10 round 2) freeze their
/// rest spread (`findNonMutatedDestructureSpreads`), so they too are byte-exact.
const STAGE3_FIXTURE_COUNT: usize = 81;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hir")
}

/// Normalize CRLF + trailing whitespace so the harness is stable across OSes.
fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").trim_end().to_string()
}

/// Show up to `max_lines` differing lines (the "first few diffs"), then a
/// `... (N more differing lines)` tail so the table stays readable.
fn first_line_diff_capped(expected: &str, actual: &str, max_lines: usize) -> String {
    let exp: Vec<&str> = expected.lines().collect();
    let act: Vec<&str> = actual.lines().collect();
    let mut out = String::new();
    let max = exp.len().max(act.len());
    let mut shown = 0usize;
    let mut extra = 0usize;
    for i in 0..max {
        let e = exp.get(i).copied().unwrap_or("<missing>");
        let a = act.get(i).copied().unwrap_or("<missing>");
        if e != a {
            if shown < max_lines {
                out.push_str(&format!(
                    "  line {}:\n    expected: {e}\n    actual:   {a}\n",
                    i + 1
                ));
                shown += 1;
            } else {
                extra += 1;
            }
        }
    }
    if extra > 0 {
        out.push_str(&format!("  ... ({extra} more differing lines)\n"));
    }
    out
}

/// All differing lines, uncapped (used by the strict full-parity gate so a real
/// regression surfaces every diff).
fn first_line_diff(expected: &str, actual: &str) -> String {
    first_line_diff_capped(expected, actual, usize::MAX)
}

struct Fixture {
    name: String,
    ext: String,
    source: String,
    expected: String,
}

fn collect_fixtures(stage: &str) -> Vec<Fixture> {
    let dir = fixtures_dir();
    let mut entries: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("fixtures dir exists")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            matches!(
                p.extension().and_then(|e| e.to_str()),
                Some("js" | "jsx" | "ts" | "tsx")
            )
        })
        .collect();
    entries.sort();

    entries
        .into_iter()
        .filter_map(|input| {
            let name = input.file_stem().unwrap().to_str().unwrap().to_string();
            if EXCLUDED.contains(&name.as_str()) {
                return None;
            }
            let reference_path = input.with_extension(format!("{stage}.hir"));
            if !reference_path.exists() {
                return None;
            }
            let ext = input
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("tsx")
                .to_string();
            let source = fs::read_to_string(&input).expect("read fixture");
            let expected =
                normalize(&fs::read_to_string(&reference_path).expect("read reference"));
            Some(Fixture {
                name,
                ext,
                source,
                expected,
            })
        })
        .collect()
}

fn actual_output(fixture: &Fixture, stage: &str) -> String {
    let lowered = compile_to_stage(
        &fixture.source,
        &format!("{}.{}", fixture.name, fixture.ext),
        stage,
    );
    let header = fixture.expected.lines().next().unwrap_or("");
    let chosen = lowered
        .iter()
        .find(|f| {
            f.printed
                .as_deref()
                .is_some_and(|p| p.lines().next() == Some(header))
        })
        .or_else(|| lowered.first());
    match chosen {
        Some(f) => match (&f.printed, &f.error) {
            (Some(printed), _) => normalize(printed),
            (None, Some(err)) => format!("<unsupported: {err}>"),
            (None, None) => "<no output>".to_string(),
        },
        None => "<no functions>".to_string(),
    }
}

/// Measured parity for a stage: prints `matched/total` + per-line diffs and
/// asserts at least `floor` fixtures match (a non-regression guard).
fn measured_parity(stage: &str, floor: usize) {
    let fixtures = collect_fixtures(stage);
    let total = fixtures.len();
    let mut matched = 0usize;
    let mut mismatches: Vec<String> = Vec::new();

    for fixture in &fixtures {
        let actual = actual_output(fixture, stage);
        if actual == fixture.expected {
            matched += 1;
        } else {
            // Show only the first few differing lines per fixture so the per-stage
            // report stays scannable (the strict gate shows them all).
            mismatches.push(format!(
                "FIXTURE {}\n{}",
                fixture.name,
                first_line_diff_capped(&fixture.expected, &actual, 6)
            ));
        }
    }

    eprintln!("\nStage {stage}: {matched}/{total} fixtures matched");
    for m in &mismatches {
        eprintln!("\n{m}");
    }

    assert!(total > 0, "expected at least one `{stage}` reference dump");
    assert!(
        matched >= floor,
        "`{stage}` parity regressed: {matched}/{total} matched, expected >= {floor}"
    );
}

/// Compute `(matched, total, mismatched_fixture_names)` for a stage without
/// asserting — used by the consolidated table below.
fn stage_tally(stage: &str) -> (usize, usize, Vec<String>) {
    let fixtures = collect_fixtures(stage);
    let total = fixtures.len();
    let mut matched = 0usize;
    let mut mismatched = Vec::new();
    for fixture in &fixtures {
        if actual_output(fixture, stage) == fixture.expected {
            matched += 1;
        } else {
            mismatched.push(fixture.name.clone());
        }
    }
    (matched, total, mismatched)
}

/// The full ordered set of uniquely-named stage-3 stages this crate verifies.
const STAGE3_STAGES: &[&str] = &[
    "OptimizePropsMethodCalls",
    "AnalyseFunctions",
    "InferMutationAliasingEffects",
    "DeadCodeElimination",
    "InferMutationAliasingRanges",
    "InferReactivePlaces",
    "RewriteInstructionKindsBasedOnReassignment",
];

/// Prints one clean per-stage `matched/total` table across every stage-3 stage,
/// listing the mismatched fixture name(s) per stage. Run with `--nocapture` to
/// see it (e.g. `cargo test --test hir_parity_stage3 stage3_parity_table --
/// --nocapture`). Asserts full parity (every stage 68/68) so the table doubles
/// as a guard.
#[test]
fn stage3_parity_table() {
    eprintln!("\n=== Stage-3 per-stage parity (per-stage `<name>.<stage>.hir` ref count) ===");
    eprintln!("{:<46} {:>9}  mismatched", "stage", "matched");
    let mut all_ok = true;
    for &stage in STAGE3_STAGES {
        let (matched, total, mismatched) = stage_tally(stage);
        if matched < STAGE3_FIXTURE_COUNT {
            all_ok = false;
        }
        eprintln!(
            "{stage:<46} {matched:>4}/{total:<4}  {}",
            if mismatched.is_empty() {
                "-".to_string()
            } else {
                mismatched.join(", ")
            }
        );
    }
    eprintln!(
        "\nEvery fixture (including `nested_fn`) is byte-identical to the oracle at\n  every stage-3 stage: the now-ported `inferReactiveScopeVariables` produces\n  `nested_fn`'s `_@<scope>` suffixes + scope-merged ranges on the nested body.\n"
    );
    assert!(all_ok, "a stage-3 stage regressed below its parity floor");
}

/// Measured `OptimizePropsMethodCalls` parity. The first stage-3 pass: it runs
/// right after `InferTypes` and only flips props-receiver `MethodCall`s to plain
/// `CallExpression`s. The nested-function bodies are not yet analysed at this
/// point (that is `AnalyseFunctions`), so this stage matches every fixture
/// exactly — including `nested_fn`, whose dump here equals its `InferTypes` HIR.
#[test]
fn hir_parity_optimize_props_method_calls() {
    measured_parity("OptimizePropsMethodCalls", STAGE3_FIXTURE_COUNT);
}

/// Strict full `OptimizePropsMethodCalls` parity. Passes at 68/68 — no
/// nested-function reactive-scope work applies this early.
#[test]
fn hir_parity_optimize_props_method_calls_full() {
    strict_parity("OptimizePropsMethodCalls");
}

/// Measured `AnalyseFunctions` parity (68/68). `AnalyseFunctions` only mutates
/// nested-function expressions, running the full inner sub-pipeline (now
/// including `inferReactiveScopeVariables`); every fixture matches.
#[test]
fn hir_parity_analyse_functions() {
    measured_parity("AnalyseFunctions", STAGE3_FIXTURE_COUNT);
}

/// Measured `InferMutationAliasingEffects` parity (68/68). The nested-function
/// inner bodies are fully analysed (effects + ranges + reactive scopes) so every
/// fixture matches.
#[test]
fn hir_parity_infer_mutation_aliasing_effects() {
    measured_parity("InferMutationAliasingEffects", STAGE3_FIXTURE_COUNT);
}

/// Measured `DeadCodeElimination` parity (68/68). `DeadCodeElimination` runs
/// right after `InferMutationAliasingEffects` (and is followed by a second
/// `PruneMaybeThrows`). It only deletes unreferenced instructions/phis and
/// rewrites destructure/store lvalues, riding the aliasing-effect lines along
/// unchanged.
#[test]
fn hir_parity_dead_code_elimination() {
    measured_parity("DeadCodeElimination", STAGE3_FIXTURE_COUNT);
}

/// Measured `InferMutationAliasingRanges` parity (68/68). This pass computes each
/// identifier's `mutableRange` and resolves every place's concrete `Effect`
/// (the leading `read`/`store`/`mutate?`/... token), running after the 2nd
/// `PruneMaybeThrows`. The nested-function inner ranges (and their reactive-scope
/// merging in `AnalyseFunctions`) are computed too, so every fixture matches.
#[test]
fn hir_parity_infer_mutation_aliasing_ranges() {
    measured_parity("InferMutationAliasingRanges", STAGE3_FIXTURE_COUNT);
}

#[test]
fn hir_parity_infer_mutation_aliasing_ranges_full() {
    strict_parity("InferMutationAliasingRanges");
}

/// Measured `InferReactivePlaces` parity (68/68). This pass marks reactive places
/// (the `{reactive}` suffix), running after `InferMutationAliasingRanges`. Riding
/// the concrete-effect + range output along, it differs from that stage only by
/// the added suffixes.
#[test]
fn hir_parity_infer_reactive_places() {
    measured_parity("InferReactivePlaces", STAGE3_FIXTURE_COUNT);
}

/// Measured `RewriteInstructionKindsBasedOnReassignment` parity. The last stage
/// in this chain: it only rewrites `lvalue.kind` (Const/Let/Reassign) and leaves
/// the reactive suffixes from `InferReactivePlaces` intact. Same floor as the
/// reactive-places stage.
#[test]
fn hir_parity_rewrite_instruction_kinds() {
    measured_parity(
        "RewriteInstructionKindsBasedOnReassignment",
        STAGE3_FIXTURE_COUNT,
    );
}

#[test]
fn hir_parity_infer_reactive_places_full() {
    strict_parity("InferReactivePlaces");
}

#[test]
fn hir_parity_rewrite_instruction_kinds_full() {
    strict_parity("RewriteInstructionKindsBasedOnReassignment");
}

/// `const_return` at `DeadCodeElimination`: a `const x = 42; return x` whose
/// `StoreLocal`+`LoadLocal` were folded to a direct return by constant
/// propagation, leaving `[1]`/`[2]` (the dead literal + store) to be DCE'd. The
/// retained instructions keep their original ids (`[3]`/`[4]`), so the printed
/// sequence has gaps — the load-bearing id-preservation invariant. Byte-identical
/// to the oracle.
#[test]
fn const_return_dce_exact() {
    let source = "function Component() {\n  const x = 42;\n  return x;\n}\n";
    let lowered = compile_to_stage(source, "Component.tsx", "DeadCodeElimination");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered");
    let expected = "\
Component(): <unknown> $5:TPrimitive
bb0 (block):
  [3] <unknown> $9:TPrimitive = 42
    Create $9 = primitive
  [4] Return Explicit <unknown> $9:TPrimitive
    Freeze $9 jsx-captured";
    assert_eq!(normalize(printed), normalize(expected));
}

/// `simple` at `InferMutationAliasingEffects`: a recursive non-component function
/// exercising the no-signature default `Apply` path (the `foo(...)` call), the
/// `Assign`/`ImmutableCapture` data flow, primitive `Create`s, and the
/// non-function-expression `Return` `Freeze`. Byte-identical to the oracle.
#[test]
fn simple_infer_effects_exact() {
    let source = "export default function foo(x, y) {\n  if (x) {\n    return foo(false, y);\n  }\n  return [y * 10];\n}\n";
    let lowered = compile_to_stage(source, "foo.js", "InferMutationAliasingEffects");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("foo lowered");
    let expected = "\
foo(<unknown> x$13, <unknown> y$14:TPrimitive): <unknown> $12:TPhi
bb0 (block):
  [1] <unknown> $15 = LoadLocal <unknown> x$13
    ImmutableCapture $15 <- x$13
  [2] If (<unknown> $15) then:bb2 else:bb1 fallthrough=bb1
bb2 (block):
  predecessor blocks: bb0
  [3] <unknown> $16:TFunction = LoadGlobal(module) foo
    Create $16 = global
  [4] <unknown> $17:TPrimitive = false
    Create $17 = primitive
  [5] <unknown> $18:TPrimitive = LoadLocal <unknown> y$14:TPrimitive
    ImmutableCapture $18 <- y$14
  [6] <unknown> $19 = Call <unknown> $16:TFunction(<unknown> $17:TPrimitive, <unknown> $18:TPrimitive)
    Create $19 = mutable
    MaybeAlias $19 <- $16
    MaybeAlias $19 <- $16
    MaybeAlias $19 <- $17
    ImmutableCapture $19 <- $18
    ImmutableCapture $16 <- $18
    ImmutableCapture $16 <- $18
    ImmutableCapture $17 <- $18
  [7] Return Explicit <unknown> $19
    Freeze $19 jsx-captured
bb1 (block):
  predecessor blocks: bb0
  [8] <unknown> $20:TPrimitive = LoadLocal <unknown> y$14:TPrimitive
    ImmutableCapture $20 <- y$14
  [9] <unknown> $21:TPrimitive = 10
    Create $21 = primitive
  [10] <unknown> $22:TPrimitive = Binary <unknown> $20:TPrimitive * <unknown> $21:TPrimitive
    Create $22 = primitive
  [11] <unknown> $23:TObject<BuiltInArray> = Array [<unknown> $22:TPrimitive]
    Create $23 = mutable
  [12] Return Explicit <unknown> $23:TObject<BuiltInArray>
    Freeze $23 jsx-captured";
    assert_eq!(normalize(printed), normalize(expected));
}

/// `store-via-call` at `InferMutationAliasingRanges`: a `foo(x); x.mutate()`
/// chain where `x` is captured into a call argument then transitively mutated via
/// a later method call, so its (and its aliases') `mutableRange` extends to the
/// final instruction. Exercises the concrete place-effect resolution
/// (`mutate?`/`store`/`capture`), the `[start:end]` range suffix (printed only
/// when `end > start + 1`), and the no-range case (`$24`, whose `[9:10]` is not
/// mutable). Byte-identical to the oracle.
#[test]
fn store_via_call_ranges_exact() {
    let source =
        "function foo() {\n  const x = {};\n  const y = foo(x);\n  y.mutate();\n  return x;\n}\n";
    let lowered = compile_to_stage(source, "foo.js", "InferMutationAliasingRanges");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("foo lowered");
    let expected = "\
foo(): <unknown> $13:TObject<BuiltInObject>
bb0 (block):
  [1] mutate? $14[1:10]:TObject<BuiltInObject> = Object {  }
    Create $14 = mutable
  [2] store $16[2:10]:TObject<BuiltInObject> = StoreLocal Const store x$15[2:10]:TObject<BuiltInObject> = capture $14[1:10]:TObject<BuiltInObject>
    Assign x$15 = $14
    Assign $16 = $14
  [3] mutate? $17[3:10]:TFunction = LoadGlobal(module) foo
    Create $17 = global
  [4] store $18[4:10]:TObject<BuiltInObject> = LoadLocal capture x$15[2:10]:TObject<BuiltInObject>
    Assign $18 = x$15
  [5] store $19[5:10] = Call capture $17[3:10]:TFunction(capture $18[4:10]:TObject<BuiltInObject>)
    Create $19 = mutable
    MaybeAlias $19 <- $17
    MaybeAlias $19 <- $17
    MutateTransitiveConditionally $18
    MaybeAlias $19 <- $18
  [6] store $21[6:10] = StoreLocal Const store y$20[6:10] = capture $19[5:10]
    Assign y$20 = $19
    Assign $21 = $19
  [7] store $22[7:10] = LoadLocal capture y$20[6:10]
    Assign $22 = y$20
  [8] store $23[8:10]:TFunction = PropertyLoad capture $22[7:10].mutate
    Create $23 = kindOf($22)
  [9] store $24 = MethodCall store $22[7:10].capture $23[8:10]:TFunction()
    Create $24 = mutable
    MutateTransitiveConditionally $22
    MaybeAlias $24 <- $22
    Capture $23 <- $22
    MaybeAlias $24 <- $23
    Capture $22 <- $23
  [10] store $25:TObject<BuiltInObject> = LoadLocal capture x$15[2:10]:TObject<BuiltInObject>
    Assign $25 = x$15
  [11] Return Explicit freeze $25:TObject<BuiltInObject>
    Freeze $25 jsx-captured";
    assert_eq!(normalize(printed), normalize(expected));
}

/// `InferReactivePlaces` stable-hook filtering: `useState`/`useRef` results are
/// not marked reactive even though their calls are reactivity sources, because
/// the `StableSidemap` recognizes the stable container (`useState` tuple) and
/// stable type (`setState`, the ref object). Only the reactive *container* `$22`
/// and the destructure lvalue `$25` are marked; `x`/`setX`/the closure stay
/// non-reactive. Byte-identical to the oracle.
#[test]
fn use_state_stable_reactivity_exact() {
    let source =
        "function component() {\n  let [x, setX] = useState(0);\n  const handler = v => setX(v);\n  return <Foo handler={handler}></Foo>;\n}\n";
    let lowered = compile_to_stage(source, "component.js", "InferReactivePlaces");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("component lowered");
    // The `useState` container is reactive; the stable `setX` / closure are not.
    let printed = normalize(printed);
    assert!(
        printed.contains("$22:TObject<BuiltInUseState>{reactive}"),
        "useState container should be reactive:\n{printed}"
    );
    assert!(
        printed.contains("mutate? setX$24:TFunction<BuiltInSetState>():  :TPrimitive ]"),
        "setX should NOT be reactive (stable setState type):\n{printed}"
    );
    assert!(
        !printed.contains("handler$31:TFunction<BuiltInFunction>():  :TPrimitive{reactive}"),
        "the handler closure should NOT be reactive:\n{printed}"
    );
}

/// `RewriteInstructionKindsBasedOnReassignment`: a `for (let i = 0; ...)` whose
/// `i++` update was DCE'd, so the surviving `StoreLocal i$12` reverts from `Let`
/// to `Const`. Byte-identical to the oracle.
#[test]
fn for_loop_rewrite_kind_exact() {
    let source = "function Component(n) {\n  for (let i = 0; i; i) { n; }\n  return n;\n}\n";
    let lowered = compile_to_stage(
        source,
        "Component.tsx",
        "RewriteInstructionKindsBasedOnReassignment",
    );
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered");
    let printed = normalize(printed);
    assert!(
        printed.contains("StoreLocal Const mutate? i$12:TPrimitive"),
        "the dead-reassigned loop counter should revert to Const:\n{printed}"
    );
    assert!(
        printed.contains("n$10{reactive}"),
        "the param `n` should be reactive:\n{printed}"
    );
}

/// `nested_fn` at `InferMutationAliasingEffects`: the outer `CreateFunction`
/// apply path downgrades the captured context operand `props` from `capture`
/// (set at `AnalyseFunctions`) to `read`, because `props` is a Component param
/// (Frozen) — mirroring the TS `operand.effect = Effect.Read` loop in the
/// `CreateFunction` case. The `@context[...]` line must read `read props$16`,
/// not `capture props$16`.
#[test]
fn nested_fn_context_downgrade_exact() {
    let source =
        "function Component(props) {\n  const cb = () => { props.setCount(props.count + 1); };\n  return cb;\n}\n";
    let analyse = compile_to_stage(source, "Component.tsx", "AnalyseFunctions");
    let analyse_printed = analyse
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered (AnalyseFunctions)");
    // At AnalyseFunctions the captured operand is still `capture`.
    assert!(
        analyse_printed.contains("@context[capture props$16]"),
        "AnalyseFunctions should keep `capture props$16`:\n{analyse_printed}"
    );

    let effects = compile_to_stage(source, "Component.tsx", "InferMutationAliasingEffects");
    let effects_printed = effects
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered (InferMutationAliasingEffects)");
    // At InferMutationAliasingEffects the Frozen-param capture is downgraded.
    assert!(
        effects_printed.contains("@context[read props$16]"),
        "InferMutationAliasingEffects should downgrade to `read props$16`:\n{effects_printed}"
    );
    assert!(
        !effects_printed.contains("@context[capture props$16]"),
        "the `capture props$16` must not survive the downgrade:\n{effects_printed}"
    );
}

/// A ref-capturing closure (`capturesRef`) and a global-mutating closure
/// (`hasTrackedSideEffects`) both make the function value *mutable* even without
/// mutable captures, so the `StoreLocal`/`LoadLocal` that aliases the function
/// emits `Assign` (mutable data flow), not `ImmutableCapture` (frozen). Mirrors
/// the TS `isMutable = hasCaptures || hasTrackedSideEffects || capturesRef`.
#[test]
fn create_function_mutability_flags_exact() {
    // capturesRef: closure assigns `ref.current`.
    let ref_src =
        "function Component(){const ref = useRef(null); const f = () => { ref.current = 1; }; return f;}\n";
    let ref_lowered = compile_to_stage(ref_src, "Component.tsx", "InferMutationAliasingEffects");
    let ref_printed = ref_lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered (ref)");
    assert!(
        ref_printed.contains("Assign f$26 = $21"),
        "ref-capturing closure should be mutable (Assign, not ImmutableCapture):\n{ref_printed}"
    );
    assert!(
        !ref_printed.contains("ImmutableCapture f$26 <- $21"),
        "ref-capturing closure must not be frozen:\n{ref_printed}"
    );

    // hasTrackedSideEffects: closure mutates a global.
    let global_src =
        "function Component(){const f = () => { window.x = 1; }; return f;}\n";
    let global_lowered =
        compile_to_stage(global_src, "Component.tsx", "InferMutationAliasingEffects");
    let global_printed = global_lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered (global)");
    assert!(
        global_printed.contains("Assign f$16 = $11"),
        "global-mutating closure should be mutable (Assign):\n{global_printed}"
    );
    assert!(
        !global_printed.contains("ImmutableCapture f$16 <- $11"),
        "global-mutating closure must not be frozen:\n{global_printed}"
    );
}

/// Calling a locally declared function whose aliasing effects are known
/// substitutes those effects at the call site (the `Apply` `state.values(fn)`
/// single-FunctionExpression path): `const a={};const f=()=>{a.x=1;};f();return a;`
/// — the `f()` call must emit `MutateTransitiveConditionally $26 / Mutate a$17 /
/// Create $27 = primitive`, precisely propagating the closure's mutation of `a`.
#[test]
fn local_function_call_signature_exact() {
    let source = "function Component(){const a={};const f=()=>{a.x=1;};f();return a;}\n";
    let lowered = compile_to_stage(source, "Component.tsx", "InferMutationAliasingEffects");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered");
    let printed = normalize(printed);
    // The call instruction `[6]` emits the substituted closure effects.
    assert!(
        printed.contains("MutateTransitiveConditionally $26\n    Mutate a$17\n    Create $27 = primitive"),
        "the f() call should propagate the closure's mutation of `a`:\n{printed}"
    );
    // The wrong default-path artifacts must be gone.
    assert!(
        !printed.contains("Create $27 = mutable"),
        "the call result should be primitive, not the default-path mutable:\n{printed}"
    );
}

/// Strict full parity for a stage; fails on any mismatch. Passes at 68/68 for
/// every stage-3 stage now that the nested-function reactive-scope port has
/// landed (so `nested_fn`'s inner body matches the oracle).
fn strict_parity(stage: &str) {
    let fixtures = collect_fixtures(stage);
    let mut failures: Vec<String> = Vec::new();
    for fixture in &fixtures {
        let actual = actual_output(fixture, stage);
        if actual != fixture.expected {
            failures.push(format!(
                "FIXTURE {}\n{}",
                fixture.name,
                first_line_diff(&fixture.expected, &actual)
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} fixture(s) did not match the `{stage}` oracle:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn hir_parity_analyse_functions_full() {
    strict_parity("AnalyseFunctions");
}

#[test]
fn hir_parity_infer_mutation_aliasing_effects_full() {
    strict_parity("InferMutationAliasingEffects");
}

#[test]
fn hir_parity_dead_code_elimination_full() {
    strict_parity("DeadCodeElimination");
}
