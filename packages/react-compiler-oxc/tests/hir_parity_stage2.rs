//! Stage-2 HIR parity harness.
//!
//! For every `tests/fixtures/hir/<name>.{js,jsx,ts,tsx}` input with a stored
//! `tests/fixtures/hir/<name>.<stage>.hir` reference (produced by the TS parity
//! oracle, `npx tsx src/verify/cli.ts <file> --hir --stage <stage>`, with the
//! bold function-name line stripped and ANSI removed), this runs the pipeline to
//! that stage via [`react_compiler_oxc::compile_to_stage`] and compares the
//! printed HIR of the matching function against the reference.
//!
//! `useMemo-simple` (manual memoization) is now handled by
//! `dropManualMemoization` and is included. The stages verified here are the
//! uniquely-named ones: `DropManualMemoization` (the manual-memo rewrite),
//! `MergeConsecutiveBlocks` (the result of the `InlineIIFE ->
//! MergeConsecutiveBlocks` chain), `SSA` (`enterSSA`), and `EliminateRedundantPhi`.
//!
//! Parity is a *measured* metric (per the spec): the test prints a
//! `matched/total` summary plus a per-line diff for each mismatch, and only fails
//! if *zero* fixtures match.

use std::fs;
use std::path::{Path, PathBuf};

use react_compiler_oxc::compile_to_stage;

/// No fixtures are excluded from stage-2 parity. `useMemo-simple` (manual
/// memoization) is now handled by `dropManualMemoization` and flows through every
/// stage.
const EXCLUDED: &[&str] = &[];

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hir")
}

/// Normalize CRLF + trailing whitespace so the harness is stable across OSes.
fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").trim_end().to_string()
}

fn first_line_diff(expected: &str, actual: &str) -> String {
    let exp: Vec<&str> = expected.lines().collect();
    let act: Vec<&str> = actual.lines().collect();
    let mut out = String::new();
    let max = exp.len().max(act.len());
    for i in 0..max {
        let e = exp.get(i).copied().unwrap_or("<missing>");
        let a = act.get(i).copied().unwrap_or("<missing>");
        if e != a {
            out.push_str(&format!(
                "  line {}:\n    expected: {e}\n    actual:   {a}\n",
                i + 1
            ));
        }
    }
    out
}

/// A single stage-2 fixture: name, input extension, source, and the reference
/// dump for the requested stage.
struct Fixture {
    name: String,
    ext: String,
    source: String,
    expected: String,
}

/// Collect every fixture with a stored `<name>.<stage>.hir` reference (excluding
/// the deferred fixtures), sorted by name.
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

/// Run `fixture` to `stage` and return the printed HIR of the function matching
/// the reference (by header line), or a placeholder describing why no output was
/// produced (so a panic-free `<unsupported>` surfaces in the diff).
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

/// Shared measured-parity driver for a stage: prints `matched/total` + per-line
/// diffs and asserts at least one fixture matches.
fn measured_parity(stage: &str) {
    let fixtures = collect_fixtures(stage);
    let total = fixtures.len();
    let mut matched = 0usize;
    let mut mismatches: Vec<String> = Vec::new();

    for fixture in &fixtures {
        let actual = actual_output(fixture, stage);
        if actual == fixture.expected {
            matched += 1;
        } else {
            mismatches.push(format!(
                "FIXTURE {}\n{}",
                fixture.name,
                first_line_diff(&fixture.expected, &actual)
            ));
        }
    }

    eprintln!("\nStage {stage}: {matched}/{total} fixtures matched");
    for m in &mismatches {
        eprintln!("\n{m}");
    }

    assert!(total > 0, "expected at least one `{stage}` reference dump");
    assert!(
        matched > 0,
        "no fixtures matched the `{stage}` oracle — pipeline likely broken"
    );
}

/// Measured `DropManualMemoization` parity (the manual-memo rewrite + memoization
/// markers). Only manual-memo fixtures (e.g. `useMemo-simple`) change shape here;
/// the rest reproduce their post-`pruneMaybeThrows` HIR.
#[test]
fn hir_parity_drop_manual_memoization() {
    measured_parity("DropManualMemoization");
}

/// Measured `MergeConsecutiveBlocks` parity (the cleanup chain).
#[test]
fn hir_parity_merge_consecutive_blocks() {
    measured_parity("MergeConsecutiveBlocks");
}

/// Measured `SSA` parity (`enterSSA`: phi insertion + identifier reallocation).
#[test]
fn hir_parity_ssa() {
    measured_parity("SSA");
}

/// Measured `EliminateRedundantPhi` parity (trivial-phi elimination + rewrites).
#[test]
fn hir_parity_eliminate_redundant_phi() {
    measured_parity("EliminateRedundantPhi");
}

/// Measured `ConstantPropagation` parity (SCCP folding + conditional pruning).
#[test]
fn hir_parity_constant_propagation() {
    measured_parity("ConstantPropagation");
}

/// Measured `InferTypes` parity (type generation + unification + apply).
#[test]
fn hir_parity_infer_types() {
    measured_parity("InferTypes");
}

/// Measured `OptimizePropsMethodCalls` parity (first stage-3 pass: rewrite a
/// `MethodCall` whose receiver is the props object into a `CallExpression`). A
/// no-op for the current fixture set — none call a method directly on `props` —
/// so it must reproduce the `InferTypes` HIR byte-for-byte.
#[test]
fn hir_parity_optimize_props_method_calls() {
    measured_parity("OptimizePropsMethodCalls");
}

/// Sanity: every stage-2 fixture runs to `MergeConsecutiveBlocks` without
/// panicking and produces real printed HIR (not `<no functions>`/`<no
/// output>`/`<unsupported>`). Hard gate.
#[test]
fn stage_produces_output() {
    for stage in [
        "DropManualMemoization",
        "MergeConsecutiveBlocks",
        "SSA",
        "EliminateRedundantPhi",
        "ConstantPropagation",
        "InferTypes",
        "OptimizePropsMethodCalls",
    ] {
        let fixtures = collect_fixtures(stage);
        assert!(!fixtures.is_empty(), "expected stage-2 fixtures for {stage}");
        for fixture in &fixtures {
            let actual = actual_output(fixture, stage);
            assert!(
                !matches!(actual.as_str(), "<no functions>" | "<no output>")
                    && !actual.starts_with("<unsupported:"),
                "fixture {} produced no printed HIR at {stage}: {actual}",
                fixture.name
            );
        }
    }
}

/// Assert *every* stage-2 fixture matches its `stage` reference exactly. Backs
/// the strict full-parity gates (run with `cargo test -- --ignored`).
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

/// Strict full `DropManualMemoization` parity. Run with `cargo test -- --ignored`.
#[test]
#[ignore = "strict full-parity gate; run with --ignored"]
fn hir_parity_drop_manual_memoization_full() {
    strict_parity("DropManualMemoization");
}

/// Strict full `MergeConsecutiveBlocks` parity. Run with `cargo test -- --ignored`.
#[test]
#[ignore = "strict full-parity gate; run with --ignored"]
fn hir_parity_merge_consecutive_blocks_full() {
    strict_parity("MergeConsecutiveBlocks");
}

/// Strict full `SSA` parity. Run with `cargo test -- --ignored`.
#[test]
#[ignore = "strict full-parity gate; run with --ignored"]
fn hir_parity_ssa_full() {
    strict_parity("SSA");
}

/// Strict full `EliminateRedundantPhi` parity. Run with `cargo test -- --ignored`.
#[test]
#[ignore = "strict full-parity gate; run with --ignored"]
fn hir_parity_eliminate_redundant_phi_full() {
    strict_parity("EliminateRedundantPhi");
}

/// Strict full `ConstantPropagation` parity. Run with `cargo test -- --ignored`.
#[test]
#[ignore = "strict full-parity gate; run with --ignored"]
fn hir_parity_constant_propagation_full() {
    strict_parity("ConstantPropagation");
}

/// Strict full `InferTypes` parity. Run with `cargo test -- --ignored`.
#[test]
#[ignore = "strict full-parity gate; run with --ignored"]
fn hir_parity_infer_types_full() {
    strict_parity("InferTypes");
}

/// Strict full `OptimizePropsMethodCalls` parity. Run with `cargo test -- --ignored`.
#[test]
#[ignore = "strict full-parity gate; run with --ignored"]
fn hir_parity_optimize_props_method_calls_full() {
    strict_parity("OptimizePropsMethodCalls");
}

/// Per-fixture regression smoke test: `simple` at `MergeConsecutiveBlocks` lowers
/// to the exact expected HIR (the cleanup chain is a no-op on this already-clean
/// fixture, so the result equals its raw HIR). Hard assertion.
#[test]
fn simple_merge_consecutive_blocks_exact() {
    let source = "export default function foo(x, y) {\n  if (x) {\n    return foo(false, y);\n  }\n  return [y * 10];\n}\n";
    let lowered = compile_to_stage(source, "foo.js", "MergeConsecutiveBlocks");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("foo lowered");
    let expected = "\
foo(<unknown> x$0, <unknown> y$1): <unknown> $12
bb0 (block):
  [1] <unknown> $6 = LoadLocal <unknown> x$0
  [2] If (<unknown> $6) then:bb2 else:bb1 fallthrough=bb1
bb2 (block):
  predecessor blocks: bb0
  [3] <unknown> $2 = LoadGlobal(module) foo
  [4] <unknown> $3 = false
  [5] <unknown> $4 = LoadLocal <unknown> y$1
  [6] <unknown> $5 = Call <unknown> $2(<unknown> $3, <unknown> $4)
  [7] Return Explicit <unknown> $5
bb1 (block):
  predecessor blocks: bb0
  [8] <unknown> $7 = LoadLocal <unknown> y$1
  [9] <unknown> $8 = 10
  [10] <unknown> $9 = Binary <unknown> $7 * <unknown> $8
  [11] <unknown> $10 = Array [<unknown> $9]
  [12] Return Explicit <unknown> $10";
    assert_eq!(normalize(printed), normalize(expected));
}

/// `inlineImmediatelyInvokedFunctionExpressions` exercises the single-return
/// inline path (no curated fixture does): a zero-arg IIFE is fully inlined into
/// its caller, the lambda's `return` becomes a `LoadLocal` into the call result,
/// and `mergeConsecutiveBlocks` collapses the blocks. Byte-identical to the
/// oracle's `--stage MergeConsecutiveBlocks` output.
#[test]
fn inline_single_return_iife() {
    let source = "function Component(props) {\n  const x = (() => {\n    const a = props.a;\n    return a;\n  })();\n  return x;\n}\n";
    let lowered = compile_to_stage(source, "Component.js", "MergeConsecutiveBlocks");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered");
    let expected = "\
Component(<unknown> props$0): <unknown> $14
bb0 (block):
  [2] <unknown> $1 = LoadLocal <unknown> props$0
  [3] <unknown> $2 = PropertyLoad <unknown> $1.a
  [4] <unknown> $4 = StoreLocal Const <unknown> a$3 = <unknown> $2
  [5] <unknown> $5 = LoadLocal <unknown> a$3
  [6] <unknown> $9 = LoadLocal <unknown> $5
  [8] <unknown> $11 = StoreLocal Const <unknown> x$10 = <unknown> $9
  [9] <unknown> $12 = LoadLocal <unknown> x$10
  [10] Return Explicit <unknown> $12";
    assert_eq!(normalize(printed), normalize(expected));
}

/// The multi-return IIFE path: a zero-arg IIFE with two `return`s is wrapped in a
/// `label` terminal, its result temporary is declared + promoted to `#t<decl>`,
/// and each `return` becomes a `StoreLocal Reassign` + `goto`. Byte-identical to
/// the oracle, including the promoted name propagating to the continuation's
/// consuming `StoreLocal` operand.
#[test]
fn inline_multi_return_iife() {
    let source = "function Component(props) {\n  const x = (() => {\n    if (props.a) {\n      return 1;\n    }\n    return 2;\n  })();\n  return x;\n}\n";
    let lowered = compile_to_stage(source, "Component.js", "MergeConsecutiveBlocks");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered");
    let expected = "\
Component(<unknown> props$0): <unknown> $13
bb0 (block):
  [1] <unknown> $14 = DeclareLocal Let <unknown> #t8$8
  [2] Label block=bb1 fallthrough=bb7
bb1 (block):
  predecessor blocks: bb0
  [3] <unknown> $2 = LoadLocal <unknown> props$0
  [4] <unknown> $3 = PropertyLoad <unknown> $2.a
  [5] If (<unknown> $3) then:bb3 else:bb2 fallthrough=bb2
bb3 (block):
  predecessor blocks: bb1
  [6] <unknown> $1 = 1
  [7] <unknown> $15 = StoreLocal Reassign <unknown> #t8$8 = <unknown> $1
  [8] Goto bb7
bb2 (block):
  predecessor blocks: bb1
  [9] <unknown> $4 = 2
  [10] <unknown> $16 = StoreLocal Reassign <unknown> #t8$8 = <unknown> $4
  [11] Goto bb7
bb7 (block):
  predecessor blocks: bb3 bb2
  [12] <unknown> $10 = StoreLocal Const <unknown> x$9 = <unknown> #t8$8
  [13] <unknown> $11 = LoadLocal <unknown> x$9
  [14] Return Explicit <unknown> $11";
    assert_eq!(normalize(printed), normalize(expected));
}

/// `enterSSA` reallocates every identifier definition and inserts loop phis. This
/// `do...while` reassigns its loop-carried locals, so the loop body gains a phi
/// per carried local — printed in *predecessor* order (`bb0` then the back-edge
/// `bb1`), with each phi's identifier freshly allocated. Byte-identical to the
/// oracle's `--stage SSA`.
#[test]
fn enter_ssa_inserts_loop_phis() {
    let source = "function Component() {\n  let x = [1, 2, 3];\n  let ret = [];\n  do {\n    let item = x.pop();\n    ret.push(item * 2);\n  } while (x.length);\n  return ret;\n}\n";
    let lowered = compile_to_stage(source, "Component.js", "SSA");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered");
    let expected = "\
Component(): <unknown> $24
bb0 (block):
  [1] <unknown> $25 = 1
  [2] <unknown> $26 = 2
  [3] <unknown> $27 = 3
  [4] <unknown> $28 = Array [<unknown> $25, <unknown> $26, <unknown> $27]
  [5] <unknown> $30 = StoreLocal Let <unknown> x$29 = <unknown> $28
  [6] <unknown> $31 = Array []
  [7] <unknown> $33 = StoreLocal Let <unknown> ret$32 = <unknown> $31
  [8] DoWhile loop=bb3 test=bb1 fallthrough=bb2
bb3 (block):
  predecessor blocks: bb0 bb1
  <unknown> x$34: phi(bb0: <unknown> x$29, bb1: <unknown> x$34)
  <unknown> ret$40: phi(bb0: <unknown> ret$32, bb1: <unknown> ret$40)
  [9] <unknown> $35 = LoadLocal <unknown> x$34
  [10] <unknown> $36 = PropertyLoad <unknown> $35.pop
  [11] <unknown> $37 = MethodCall <unknown> $35.<unknown> $36()
  [12] <unknown> $39 = StoreLocal Let <unknown> item$38 = <unknown> $37
  [13] <unknown> $41 = LoadLocal <unknown> ret$40
  [14] <unknown> $42 = PropertyLoad <unknown> $41.push
  [15] <unknown> $43 = LoadLocal <unknown> item$38
  [16] <unknown> $44 = 2
  [17] <unknown> $45 = Binary <unknown> $43 * <unknown> $44
  [18] <unknown> $46 = MethodCall <unknown> $41.<unknown> $42(<unknown> $45)
  [19] Goto(Continue) bb1
bb1 (loop):
  predecessor blocks: bb3
  [20] <unknown> $47 = LoadLocal <unknown> x$34
  [21] <unknown> $48 = PropertyLoad <unknown> $47.length
  [22] Branch (<unknown> $48) then:bb3 else:bb2 fallthrough:bb1
bb2 (block):
  predecessor blocks: bb1
  [23] <unknown> $49 = LoadLocal <unknown> ret$40
  [24] Return Explicit <unknown> $49";
    assert_eq!(normalize(printed), normalize(expected));
}

/// `eliminateRedundantPhi` drops the two loop phis from the `do...while` above:
/// each is `v_n = phi(v_init, v_n)` (an operand equal to its own output), hence
/// trivial, so every use is rewritten back to the pre-loop definition (`x$29` /
/// `ret$32`) and the phi lines disappear. Byte-identical to the oracle.
#[test]
fn eliminate_redundant_phi_drops_trivial_loop_phis() {
    let source = "function Component() {\n  let x = [1, 2, 3];\n  let ret = [];\n  do {\n    let item = x.pop();\n    ret.push(item * 2);\n  } while (x.length);\n  return ret;\n}\n";
    let lowered = compile_to_stage(source, "Component.js", "EliminateRedundantPhi");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered");
    let expected = "\
Component(): <unknown> $24
bb0 (block):
  [1] <unknown> $25 = 1
  [2] <unknown> $26 = 2
  [3] <unknown> $27 = 3
  [4] <unknown> $28 = Array [<unknown> $25, <unknown> $26, <unknown> $27]
  [5] <unknown> $30 = StoreLocal Let <unknown> x$29 = <unknown> $28
  [6] <unknown> $31 = Array []
  [7] <unknown> $33 = StoreLocal Let <unknown> ret$32 = <unknown> $31
  [8] DoWhile loop=bb3 test=bb1 fallthrough=bb2
bb3 (block):
  predecessor blocks: bb0 bb1
  [9] <unknown> $35 = LoadLocal <unknown> x$29
  [10] <unknown> $36 = PropertyLoad <unknown> $35.pop
  [11] <unknown> $37 = MethodCall <unknown> $35.<unknown> $36()
  [12] <unknown> $39 = StoreLocal Let <unknown> item$38 = <unknown> $37
  [13] <unknown> $41 = LoadLocal <unknown> ret$32
  [14] <unknown> $42 = PropertyLoad <unknown> $41.push
  [15] <unknown> $43 = LoadLocal <unknown> item$38
  [16] <unknown> $44 = 2
  [17] <unknown> $45 = Binary <unknown> $43 * <unknown> $44
  [18] <unknown> $46 = MethodCall <unknown> $41.<unknown> $42(<unknown> $45)
  [19] Goto(Continue) bb1
bb1 (loop):
  predecessor blocks: bb3
  [20] <unknown> $47 = LoadLocal <unknown> x$29
  [21] <unknown> $48 = PropertyLoad <unknown> $47.length
  [22] Branch (<unknown> $48) then:bb3 else:bb2 fallthrough:bb1
bb2 (block):
  predecessor blocks: bb1
  [23] <unknown> $49 = LoadLocal <unknown> ret$32
  [24] Return Explicit <unknown> $49";
    assert_eq!(normalize(printed), normalize(expected));
}
