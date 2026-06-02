//! Stage-4 HIR parity harness (HIR-level reactive-scope passes).
//!
//! Stage 4 ports the reactive-scope passes that run on the HIR, in pipeline
//! order (`Entrypoint/Pipeline.ts`). This harness covers the ones this crate has
//! implemented so far. The keystone pass is `InferReactiveScopeVariables`, which
//! assigns each group of co-mutating identifiers a reactive `ScopeId` (printed as
//! the `_@<scopeId>` identifier suffix) and merges the group's `mutableRange`s
//! into one shared scope range.
//!
//! For every `tests/fixtures/hir/<name>.{js,jsx,ts,tsx}` input with a stored
//! `<name>.<stage>.hir` reference (produced by the TS oracle,
//! `npx tsx src/verify/cli.ts <file> --hir --stage <stage>`, bold name line
//! stripped + ANSI removed + trailing ws trimmed), this runs the pipeline to that
//! stage via [`react_compiler_oxc::compile_to_stage`] and compares the printed HIR
//! of the matching function against the reference.
//!
//! `useMemo-simple` is excluded (manual memoization is deferred). Parity is
//! reported as a per-stage `matched/total` table; each implemented stage also has
//! a strict full-parity gate that fails on any mismatch.

use std::fs;
use std::path::{Path, PathBuf};

use react_compiler_oxc::compile_to_stage;

/// No fixtures are excluded — `useMemo-simple` (manual memoization) is handled by
/// `dropManualMemoization` and flows through every stage-4 stage.
const EXCLUDED: &[&str] = &[];

/// The stage-4 stages this crate implements (in pipeline order). All are at full
/// 68/68 parity, including `PropagateScopeDependenciesHIR` (the
/// dependency-collection subsystem — `findTemporariesUsedOutsideDeclaringScope`,
/// `collectTemporariesSidemap`, `collectOptionalChainSidemap`,
/// `collectHoistablePropertyLoads`, the `DependencyCollectionContext` traversal,
/// and `DeriveMinimalDependenciesHIR` — plus `line:col` dependency source-location
/// resolution).
const STAGE4_STAGES: &[&str] = &[
    "InferReactiveScopeVariables",
    "MemoizeFbtAndMacroOperandsInSameScope",
    "OutlineFunctions",
    "AlignMethodCallScopes",
    "AlignObjectMethodScopes",
    "PruneUnusedLabelsHIR",
    "AlignReactiveScopesToBlockScopesHIR",
    "MergeOverlappingReactiveScopesHIR",
    "BuildReactiveScopeTerminalsHIR",
    "FlattenReactiveLoopsHIR",
    "FlattenScopesWithHooksOrUseHIR",
    "PropagateScopeDependenciesHIR",
];

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hir")
}

/// Normalize CRLF + trailing whitespace so the harness is stable across OSes.
fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").trim_end().to_string()
}

/// Show up to `max_lines` differing lines, then a `... (N more)` tail.
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

/// All differing lines, uncapped (used by the strict full-parity gate).
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

/// Compute `(matched, total, mismatched_fixture_names)` for a stage.
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

/// Strict full parity for a stage; fails on any mismatch.
fn strict_parity(stage: &str) {
    let fixtures = collect_fixtures(stage);
    assert!(!fixtures.is_empty(), "no `{stage}` reference dumps found");
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

/// Stages at full (68/68) parity. Every implemented stage-4 stage —
/// `InferReactiveScopeVariables` through `PropagateScopeDependenciesHIR` — is
/// exact.
const FULL_PARITY_STAGES: &[&str] = &[
    "InferReactiveScopeVariables",
    "MemoizeFbtAndMacroOperandsInSameScope",
    "OutlineFunctions",
    "AlignMethodCallScopes",
    "AlignObjectMethodScopes",
    "PruneUnusedLabelsHIR",
    "AlignReactiveScopesToBlockScopesHIR",
    "MergeOverlappingReactiveScopesHIR",
    "BuildReactiveScopeTerminalsHIR",
    "FlattenReactiveLoopsHIR",
    "FlattenScopesWithHooksOrUseHIR",
    "PropagateScopeDependenciesHIR",
];

/// No stage-4 stages remain partial: `PropagateScopeDependenciesHIR` is now at
/// full 68/68 parity.
const PARTIAL_STAGES: &[(&str, usize)] = &[];

/// Per-stage parity table across every implemented stage-4 stage. Run with
/// `--nocapture` to see it. Asserts every fully-implemented stage is at 68/68 and
/// each partial stage holds its measured floor, so the table doubles as a
/// non-regression guard.
#[test]
fn stage4_parity_table() {
    eprintln!("\n=== Stage-4 per-stage parity (68 fixtures, useMemo-simple excluded) ===");
    eprintln!("{:<46} {:>9}  mismatched", "stage", "matched");
    let mut failures: Vec<String> = Vec::new();
    for &stage in STAGE4_STAGES {
        let (matched, total, mismatched) = stage_tally(stage);
        eprintln!(
            "{stage:<46} {matched:>4}/{total:<4}  {}",
            if mismatched.is_empty() {
                "-".to_string()
            } else {
                mismatched.join(", ")
            }
        );
        if FULL_PARITY_STAGES.contains(&stage) && matched < total {
            failures.push(format!("{stage} regressed below full parity ({matched}/{total})"));
        }
        if let Some((_, floor)) = PARTIAL_STAGES.iter().find(|(s, _)| *s == stage) {
            if matched < *floor {
                failures.push(format!(
                    "{stage} regressed below its measured floor ({matched} < {floor})"
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Measured `InferReactiveScopeVariables` parity. The keystone reactive-scope
/// pass: it assigns each group of co-mutating identifiers a `ScopeId` (the
/// `_@<scopeId>` suffix) and merges their `mutableRange`s into one shared scope
/// range. Expected at full parity (68/68) — including `nested_fn`, whose nested
/// closure body's `_@0` scope suffixes are assigned during `AnalyseFunctions`
/// (the inner sub-pipeline) and whose outer function value `$17` gets `_@1`.
#[test]
fn hir_parity_infer_reactive_scope_variables() {
    let (matched, total, mismatched) = stage_tally("InferReactiveScopeVariables");
    eprintln!("\nStage InferReactiveScopeVariables: {matched}/{total} fixtures matched");
    if !mismatched.is_empty() {
        eprintln!("  mismatched: {}", mismatched.join(", "));
    }
    assert!(total > 0, "expected at least one reference dump");
    assert_eq!(
        matched, total,
        "`InferReactiveScopeVariables` parity: {matched}/{total} matched (mismatched: {})",
        mismatched.join(", ")
    );
}

/// Strict full `InferReactiveScopeVariables` parity (also covered by the
/// non-ignored test above; kept for symmetry with the other stage harnesses and
/// to surface every diff line on failure).
#[test]
fn hir_parity_infer_reactive_scope_variables_full() {
    strict_parity("InferReactiveScopeVariables");
}

/// `nested_fn` exercises the cross-function scope-id sequence: the inner closure
/// is analysed first (`AnalyseFunctions`) and consumes scope id `0` for its
/// co-mutating `props`-derived identifiers (`$18`/`$19`/`$20`/`$24`, merged range
/// `[1:8]`); the outer function's `InferReactiveScopeVariables` then assigns the
/// function value `$17` scope id `1` (`_@1`). The captured `props` is reset to no
/// scope/range on the outer side (its body and effect references included).
#[test]
fn nested_fn_scope_ids_exact() {
    let source =
        "function Component(props) {\n  const cb = () => { props.setCount(props.count + 1); };\n  return cb;\n}\n";
    let lowered = compile_to_stage(source, "Component.tsx", "InferReactiveScopeVariables");
    let printed = lowered
        .iter()
        .find_map(|f| f.printed.as_deref())
        .expect("Component lowered");
    let printed = normalize(printed);
    // The outer function value is scope 1.
    assert!(
        printed.contains("$17_@1:TFunction<BuiltInFunction>"),
        "the outer function value should be in scope 1:\n{printed}"
    );
    // The inner co-mutating identifiers share scope 0 with the merged [1:8] range.
    assert!(
        printed.contains("$18_@0[1:8]") && printed.contains("$24_@0[1:8]"),
        "inner co-mutating ids should share scope 0 / range [1:8]:\n{printed}"
    );
    // The captured `props` has no scope suffix (reset on the outer side).
    assert!(
        printed.contains("Assign $18_@0 = props$16\n"),
        "captured props must carry no scope suffix in effect lines:\n{printed}"
    );
    assert!(
        !printed.contains("props$16_@"),
        "captured props must not be assigned a scope:\n{printed}"
    );
}

/// Measured `MemoizeFbtAndMacroOperandsInSameScope` parity. A no-op on every
/// fixture (no `fbt`/`fbs` tags, `customMacros` empty), so this must stay at
/// `InferReactiveScopeVariables`'s 68/68.
#[test]
fn hir_parity_memoize_fbt_and_macro_operands_in_same_scope() {
    let (matched, total, mismatched) = stage_tally("MemoizeFbtAndMacroOperandsInSameScope");
    assert_eq!(
        matched, total,
        "`MemoizeFbtAndMacroOperandsInSameScope` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_memoize_fbt_and_macro_operands_in_same_scope_full() {
    strict_parity("MemoizeFbtAndMacroOperandsInSameScope");
}

/// Measured `OutlineFunctions` parity (`enableFunctionOutlining`, default on).
/// Hoists context-free anonymous closures into top-level `function _temp:`
/// blocks; only `array-join` is affected, where the stringified-not-called arrow
/// is outlined.
#[test]
fn hir_parity_outline_functions() {
    let (matched, total, mismatched) = stage_tally("OutlineFunctions");
    assert_eq!(
        matched, total,
        "`OutlineFunctions` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_outline_functions_full() {
    strict_parity("OutlineFunctions");
}

/// `array-join` is the one fixture that exercises function outlining: the
/// `() => 'this closure gets stringified, not called'` argument has no captured
/// context and no name, so it is hoisted to a top-level `function _temp:` and the
/// inline `FunctionExpression` becomes `LoadGlobal(global) _temp`.
#[test]
fn outline_functions_array_join_exact() {
    let source = "function Component(props) {\n  const x = [{}, [], props.value];\n  const y = x.join(() => 'this closure gets stringified, not called');\n  foo(y);\n  return [x, y];\n}\n";
    let lowered = compile_to_stage(source, "Component.js", "OutlineFunctions");
    let printed = normalize(
        lowered
            .iter()
            .find_map(|f| f.printed.as_deref())
            .expect("Component lowered"),
    );
    assert!(
        printed.contains("= LoadGlobal(global) _temp"),
        "the outlined closure should become a LoadGlobal of `_temp`:\n{printed}"
    );
    assert!(
        printed.contains("\nfunction _temp:\n"),
        "the outlined function body should be appended as `function _temp:`:\n{printed}"
    );
    assert!(
        !printed.contains("@context[] @aliasingEffects=[Create $12 = primitive]"),
        "the inline FunctionExpression must be gone after outlining:\n{printed}"
    );
}

/// Measured `AlignMethodCallScopes` parity. On the fixtures only the case where
/// the call result has no scope but the resolved method (`property`) does fires,
/// dropping the property's `_@N` suffix (its `[a:b]` range is preserved).
#[test]
fn hir_parity_align_method_call_scopes() {
    let (matched, total, mismatched) = stage_tally("AlignMethodCallScopes");
    assert_eq!(
        matched, total,
        "`AlignMethodCallScopes` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_align_method_call_scopes_full() {
    strict_parity("AlignMethodCallScopes");
}

/// `do-while-simple` exercises `AlignMethodCallScopes` case 3: the `.pop`/`.push`
/// property loads (`$36`/`$42`) are in their receiver's scope but the call
/// results (`$37`/`$46`) are not, so the property scope is cleared — its `_@N`
/// suffix drops while its `[a:b]` range stays (and later follows the scope's
/// block-aligned range extension).
#[test]
fn align_method_call_scopes_clears_property_scope() {
    let source = "function Component() {\n  let x = [1, 2, 3];\n  let ret = [];\n  do {\n    let item = x.pop();\n    ret.push(item * 2);\n  } while (x.length);\n  return ret;\n}\n";
    let printed = normalize(
        compile_to_stage(source, "Component.js", "AlignMethodCallScopes")
            .iter()
            .find_map(|f| f.printed.as_deref())
            .expect("Component lowered"),
    );
    // The `.pop` property load result keeps its range but loses the scope suffix.
    assert!(
        printed.contains("$36[4:12]:TFunction") && !printed.contains("$36_@"),
        "the method property scope should be cleared, range kept:\n{printed}"
    );
}

#[test]
fn hir_parity_align_object_method_scopes() {
    let (matched, total, mismatched) = stage_tally("AlignObjectMethodScopes");
    assert_eq!(
        matched, total,
        "`AlignObjectMethodScopes` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_align_object_method_scopes_full() {
    strict_parity("AlignObjectMethodScopes");
}

#[test]
fn hir_parity_prune_unused_labels_hir() {
    let (matched, total, mismatched) = stage_tally("PruneUnusedLabelsHIR");
    assert_eq!(
        matched, total,
        "`PruneUnusedLabelsHIR` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_prune_unused_labels_hir_full() {
    strict_parity("PruneUnusedLabelsHIR");
}

/// Measured `AlignReactiveScopesToBlockScopesHIR` parity. Extends scope ranges to
/// block-scope boundaries (e.g. a do-while scope `[4:12]` → `[4:23]`); critically,
/// a method property whose scope was cleared by the prior pass still follows its
/// former scope's extended range via `range_scope`.
#[test]
fn hir_parity_align_reactive_scopes_to_block_scopes_hir() {
    let (matched, total, mismatched) = stage_tally("AlignReactiveScopesToBlockScopesHIR");
    assert_eq!(
        matched, total,
        "`AlignReactiveScopesToBlockScopesHIR` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_align_reactive_scopes_to_block_scopes_hir_full() {
    strict_parity("AlignReactiveScopesToBlockScopesHIR");
}

/// `do-while-simple` shows a scope range extended to the loop's block scope
/// (`[4:12]` → `[4:23]`), and — load-bearing — the scope-cleared `.pop` property
/// (`$36`) following that extension to `[4:23]` even though it no longer carries a
/// `_@N` suffix.
#[test]
fn align_reactive_scopes_extends_and_follows_through_cleared_scope() {
    let source = "function Component() {\n  let x = [1, 2, 3];\n  let ret = [];\n  do {\n    let item = x.pop();\n    ret.push(item * 2);\n  } while (x.length);\n  return ret;\n}\n";
    let printed = normalize(
        compile_to_stage(source, "Component.js", "AlignReactiveScopesToBlockScopesHIR")
            .iter()
            .find_map(|f| f.printed.as_deref())
            .expect("Component lowered"),
    );
    assert!(
        printed.contains("$35_@0[4:23]"),
        "the array scope range should extend to the loop block scope [4:23]:\n{printed}"
    );
    assert!(
        printed.contains("$36[4:23]") && !printed.contains("$36_@"),
        "the scope-cleared `.pop` property should follow the extended range [4:23]:\n{printed}"
    );
}

/// Measured `MergeOverlappingReactiveScopesHIR` parity (full 68/68). On the
/// fixtures only `do-while-simple` and `optional-call-with-optional-property-load`
/// actually merge; the rest are no-ops (their scopes are already disjoint/nested).
#[test]
fn hir_parity_merge_overlapping_reactive_scopes_hir() {
    let (matched, total, mismatched) = stage_tally("MergeOverlappingReactiveScopesHIR");
    assert_eq!(
        matched, total,
        "`MergeOverlappingReactiveScopesHIR` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_merge_overlapping_reactive_scopes_hir_full() {
    strict_parity("MergeOverlappingReactiveScopesHIR");
}

/// `do-while-simple` is the load-bearing merge case: scope `@1` (range `[6:23]`)
/// overlaps the loop-aligned scope `@0` (`[4:23]`), so `@1`'s members are remapped
/// onto `@0` and print `_@0` with the merged `[4:23]` range, while the
/// scope-cleared `.pop` property `$42` keeps its own `[6:23]` range untouched.
#[test]
fn merge_overlapping_remaps_to_group_root() {
    let source = "function Component() {\n  let x = [1, 2, 3];\n  let ret = [];\n  do {\n    let item = x.pop();\n    ret.push(item * 2);\n  } while (x.length);\n  return ret;\n}\n";
    let printed = normalize(
        compile_to_stage(source, "Component.js", "MergeOverlappingReactiveScopesHIR")
            .iter()
            .find_map(|f| f.printed.as_deref())
            .expect("Component lowered"),
    );
    assert!(
        printed.contains("ret$32_@0[4:23]") && !printed.contains("_@1"),
        "scope @1 should merge into @0 with the merged [4:23] range:\n{printed}"
    );
}

/// Measured `BuildReactiveScopeTerminalsHIR` parity (full 68/68). Inserts the
/// `scope`/`goto` terminals and their fallthrough blocks (drawing new `bbN` ids
/// from the env block counter, pre-advanced past the pre-Build post-dominator
/// allocations), restores RPO, renumbers, and fixes scope/identifier ranges.
#[test]
fn hir_parity_build_reactive_scope_terminals_hir() {
    let (matched, total, mismatched) = stage_tally("BuildReactiveScopeTerminalsHIR");
    assert_eq!(
        matched, total,
        "`BuildReactiveScopeTerminalsHIR` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_build_reactive_scope_terminals_hir_full() {
    strict_parity("BuildReactiveScopeTerminalsHIR");
}

/// `simple` builds two scope terminals; the new scope-body/fallthrough block ids
/// (`bb8`/`bb9`, `bb10`/`bb11`) continue the env block counter past the three
/// pre-Build post-dominator computations (`validateHooksUsage`,
/// `validateNoSetStateInRender`, `inferReactivePlaces`).
#[test]
fn build_terminals_block_ids_continue_env_counter() {
    let source = "export default function foo(x, y) {\n  if (x) {\n    return foo(false, y);\n  }\n  return [y * 10];\n}\n";
    let printed = normalize(
        compile_to_stage(source, "simple.js", "BuildReactiveScopeTerminalsHIR")
            .iter()
            .find_map(|f| f.printed.as_deref())
            .expect("foo lowered"),
    );
    assert!(
        printed.contains("block=bb8 fallthrough=bb9"),
        "the first scope terminal should use bb8/bb9 (env counter past +3):\n{printed}"
    );
}

/// Measured `FlattenReactiveLoopsHIR` parity (full 68/68). Converts a `scope`
/// terminal inside a loop to `pruned-scope`; only `for-in-lval`/`for-of-lval` have
/// a scope nested in their loop body.
#[test]
fn hir_parity_flatten_reactive_loops_hir() {
    let (matched, total, mismatched) = stage_tally("FlattenReactiveLoopsHIR");
    assert_eq!(
        matched, total,
        "`FlattenReactiveLoopsHIR` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_flatten_reactive_loops_hir_full() {
    strict_parity("FlattenReactiveLoopsHIR");
}

/// Measured `FlattenScopesWithHooksOrUseHIR` parity (full 68/68). Converts a
/// hook/`use`-containing scope to `pruned-scope` (or `label` when the scope body
/// is a single hook call); only a couple of fixtures call a hook within a scope.
#[test]
fn hir_parity_flatten_scopes_with_hooks_or_use_hir() {
    let (matched, total, mismatched) = stage_tally("FlattenScopesWithHooksOrUseHIR");
    assert_eq!(
        matched, total,
        "`FlattenScopesWithHooksOrUseHIR` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_flatten_scopes_with_hooks_or_use_hir_full() {
    strict_parity("FlattenScopesWithHooksOrUseHIR");
}

/// Measured `PropagateScopeDependenciesHIR` parity (full 68/68). Computes each
/// reactive scope's reactive `dependencies` (via the dependency-collection
/// subsystem: temporaries sidemap, optional-chain sidemap, hoistable-property-load
/// CFG analysis, the `DependencyCollectionContext` traversal, and
/// `DeriveMinimalDependenciesHIR` minimization) plus the `declarations` /
/// `reassignments` populated as a side effect, and resolves each dependency's
/// byte span to a Babel `line:col:line:col` source location.
#[test]
fn hir_parity_propagate_scope_dependencies_hir() {
    let (matched, total, mismatched) = stage_tally("PropagateScopeDependenciesHIR");
    eprintln!("\nStage PropagateScopeDependenciesHIR: {matched}/{total} fixtures matched");
    if !mismatched.is_empty() {
        eprintln!("  mismatched: {}", mismatched.join(", "));
    }
    assert_eq!(
        matched, total,
        "`PropagateScopeDependenciesHIR` parity: {matched}/{total} (mismatched: {})",
        mismatched.join(", ")
    );
}

#[test]
fn hir_parity_propagate_scope_dependencies_hir_full() {
    strict_parity("PropagateScopeDependenciesHIR");
}

/// `function_decl` is the load-bearing dependency case: the inner `helper`
/// function reads `props.base`, so the outer scope @0 (which builds the closure)
/// takes a single property-path dependency `props.base` resolved to its source
/// span (`props` at line 3, the chain ending in `base`).
#[test]
fn propagate_collects_inner_fn_property_path_dependency() {
    let source = "function Component(props) {\n  function helper(x) {\n    return x + props.base;\n  }\n  return helper(1);\n}\n";
    let printed = normalize(
        compile_to_stage(source, "Component.js", "PropagateScopeDependenciesHIR")
            .iter()
            .find_map(|f| f.printed.as_deref())
            .expect("Component lowered"),
    );
    assert!(
        printed.contains("dependencies=[props$16.base_3:15:3:25]"),
        "scope @0 should depend on the property path props.base at 3:15:3:25:\n{printed}"
    );
}
