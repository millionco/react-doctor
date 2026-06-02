//! ReactiveFunction parity harness (stages 5 + 6).
//!
//! Stage 5 ports `BuildReactiveFunction`, which converts the post-
//! `PropagateScopeDependenciesHIR` `HIRFunction` (an HIR control-flow graph) into
//! a `ReactiveFunction` (a nested, scoped tree), plus the
//! `printReactiveFunctionWithOutlined` printer.
//!
//! Stage 6 ports the post-`BuildReactiveFunction` ReactiveFunction passes that run
//! in pipeline order before codegen. This harness verifies parity at each of these
//! reactive stages against the TS oracle's reactive-IR dump (`debugLogIRs`):
//! - `BuildReactiveFunction`
//! - `PruneUnusedLabels`
//! - `PruneNonEscapingScopes` (the memoization escape analysis)
//! - `PruneNonReactiveDependencies`
//! - `PruneUnusedScopes`
//!
//! For every `tests/fixtures/hir/<name>.{js,jsx,ts,tsx}` input with a stored
//! `<name>.<Stage>.rfn` reference (produced byte-for-byte by the TS oracle), this
//! runs the pipeline to `<Stage>` via [`react_compiler_oxc::compile_to_stage`] and
//! compares the printed reactive function against the reference.
//!
//! No fixtures are excluded — `useMemo-simple` (manual memoization) is handled by
//! `dropManualMemoization` and flows through every reactive stage. All 69 inputs —
//! including `compound_update`, `for-in-lval`, `for-of-lval`, and `import_hook` —
//! have a stored `.<Stage>.rfn` reference: the TS oracle emits the reactive IR
//! before the later validation passes run, so even fixtures that ultimately fail a
//! downstream rule still produce a valid dump.

use std::fs;
use std::path::{Path, PathBuf};

use react_compiler_oxc::compile_to_stage;

/// The reactive stages verified here, in pipeline order.
const STAGES: &[&str] = &[
    "BuildReactiveFunction",
    "PruneUnusedLabels",
    "PruneNonEscapingScopes",
    "PruneNonReactiveDependencies",
    "PruneUnusedScopes",
    "MergeReactiveScopesThatInvalidateTogether",
    "PruneAlwaysInvalidatingScopes",
    "PropagateEarlyReturns",
    "PruneUnusedLValues",
    "PromoteUsedTemporaries",
    "ExtractScopeDeclarationsFromDestructuring",
    "StabilizeBlockIds",
    "RenameVariables",
    "PruneHoistedContexts",
];

/// No fixtures are excluded — `useMemo-simple` (manual memoization) is included.
const EXCLUDED: &[&str] = &[];

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hir")
}

/// Normalize CRLF + trailing whitespace so the harness is stable across OSes.
fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").trim_end().to_string()
}

/// All differing lines, capped, for diagnostics.
fn first_line_diff(expected: &str, actual: &str) -> String {
    let exp: Vec<&str> = expected.lines().collect();
    let act: Vec<&str> = actual.lines().collect();
    let mut out = String::new();
    let max = exp.len().max(act.len());
    let mut shown = 0usize;
    for i in 0..max {
        let e = exp.get(i).copied().unwrap_or("<missing>");
        let a = act.get(i).copied().unwrap_or("<missing>");
        if e != a {
            if shown < 12 {
                out.push_str(&format!(
                    "  line {}:\n    expected: {e}\n    actual:   {a}\n",
                    i + 1
                ));
                shown += 1;
            }
        }
    }
    out
}

struct Fixture {
    name: String,
    ext: String,
    source: String,
    expected: String,
}

/// Collect the fixtures with a stored `.<stage>.rfn` reference.
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
            let reference_path = input.with_extension(format!("{stage}.rfn"));
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

/// `(matched, total, mismatched_fixture_names)` for one stage.
fn tally(stage: &str) -> (usize, usize, Vec<String>) {
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

/// Measured parity for each reactive stage. Run with `--nocapture` to see the
/// matched/total counts and any mismatches.
#[test]
fn reactive_parity_build_reactive_function() {
    let mut all_pass = true;
    let mut summary = String::new();
    for stage in STAGES {
        let (matched, total, mismatched) = tally(stage);
        eprintln!("\nStage {stage}: {matched}/{total} fixtures matched");
        if !mismatched.is_empty() {
            eprintln!("  mismatched: {}", mismatched.join(", "));
        }
        assert!(total > 0, "expected at least one `.{stage}.rfn` reference dump");
        if matched != total {
            all_pass = false;
            summary.push_str(&format!(
                "\n  {stage}: {matched}/{total} (mismatched: {})",
                mismatched.join(", ")
            ));
        }
    }
    assert!(all_pass, "reactive-stage parity failures:{summary}");
}

/// Strict full parity for every reactive stage; surfaces every diff line on
/// failure. Kept as an explicit `--ignored` gate for symmetry with the stage 1-4
/// harnesses.
#[test]
#[ignore = "strict full-parity gate; run with --ignored"]
fn reactive_parity_build_reactive_function_full() {
    let mut failures: Vec<String> = Vec::new();
    for stage in STAGES {
        let fixtures = collect_fixtures(stage);
        assert!(!fixtures.is_empty(), "no `{stage}` reference dumps found");
        for fixture in &fixtures {
            let actual = actual_output(fixture, stage);
            if actual != fixture.expected {
                failures.push(format!(
                    "FIXTURE {} @ {stage}\n{}",
                    fixture.name,
                    first_line_diff(&fixture.expected, &actual)
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} fixture/stage pair(s) did not match the oracle:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
