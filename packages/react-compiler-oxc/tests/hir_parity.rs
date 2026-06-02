//! Stage-1 HIR parity harness.
//!
//! For every `tests/fixtures/hir/<name>.{js,jsx,ts,tsx}` input with a stored
//! `tests/fixtures/hir/<name>.hir` reference dump (produced by the TS parity
//! oracle, `npx tsx src/verify/cli.ts <file> --hir --stage HIR`, with the
//! print-cfg bold name line stripped), this lowers the fixture with
//! [`react_compiler_oxc::lower_to_hir`] and compares the printed HIR of the
//! first lowered function against the reference.
//!
//! Parity is a *measured* metric, not a hard gate (per the stage-1 spec): the
//! test prints a `matched/total` summary plus a unified-ish diff for each
//! mismatch, and only fails if *zero* fixtures match (which would indicate the
//! pipeline is broken rather than merely imperfect).

use std::fs;
use std::path::{Path, PathBuf};

use react_compiler_oxc::lower_to_hir;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hir")
}

/// Normalize CRLF so the harness is stable on Windows CI checkouts.
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
            out.push_str(&format!("  line {}:\n    expected: {e}\n    actual:   {a}\n", i + 1));
        }
    }
    out
}

/// A single fixture: its name and the input path's extension.
struct Fixture {
    name: String,
    ext: String,
    source: String,
    expected: String,
}

/// Collect every fixture with a stored `.hir` reference, sorted by name.
fn collect_fixtures() -> Vec<Fixture> {
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
            let reference_path = input.with_extension("hir");
            if !reference_path.exists() {
                return None;
            }
            let name = input.file_stem().unwrap().to_str().unwrap().to_string();
            let ext = input
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("tsx")
                .to_string();
            let source = fs::read_to_string(&input).expect("read fixture");
            let expected = normalize(&fs::read_to_string(&reference_path).expect("read reference"));
            Some(Fixture {
                name,
                ext,
                source,
                expected,
            })
        })
        .collect()
}

/// Lower `fixture` and return the printed HIR of the lowered function that
/// matches the reference (by header), or a placeholder describing why no
/// printed output was produced (so a panic-free `<unsupported>`/`<no functions>`
/// surfaces in the diff rather than aborting the run).
fn actual_output(fixture: &Fixture) -> String {
    let lowered = lower_to_hir(&fixture.source, &format!("{}.{}", fixture.name, fixture.ext));
    // The reference dumps a single function; pick the matching lowered fn by the
    // header line so fixtures with extra top-level declarations still line up.
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

/// Measured parity: print a per-fixture pass/fail plus a per-line diff for each
/// mismatch and an overall `matched/total` summary. Per the stage-1 spec this is
/// a *metric*, not a hard gate — it only fails if zero fixtures match (which
/// would mean the pipeline is broken) or if a fixture produced no output at all.
#[test]
fn hir_parity() {
    let fixtures = collect_fixtures();
    let total = fixtures.len();
    let mut matched = 0usize;
    let mut mismatches: Vec<String> = Vec::new();

    for fixture in &fixtures {
        let actual = actual_output(fixture);
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

    eprintln!("\nHIR parity: {matched}/{total} fixtures matched");
    for m in &mismatches {
        eprintln!("\n{m}");
    }

    assert!(total > 0, "expected at least one fixture with a reference dump");
    assert!(
        matched > 0,
        "no fixtures matched the parity oracle — pipeline likely broken"
    );
}

/// Sanity: every fixture lowers without panicking and produces *some* printed
/// HIR for the function that matches the reference header (i.e. lowering did not
/// silently drop the function or only emit an `<unsupported>` error). Always a
/// hard assertion.
#[test]
fn lowering_does_not_panic() {
    let fixtures = collect_fixtures();
    assert!(!fixtures.is_empty(), "expected fixtures with reference dumps");
    for fixture in &fixtures {
        let actual = actual_output(fixture);
        assert!(
            !matches!(
                actual.as_str(),
                "<no functions>" | "<no output>"
            ) && !actual.starts_with("<unsupported:"),
            "fixture {} produced no printed HIR: {actual}",
            fixture.name
        );
    }
}

/// Strict full parity: assert *every* fixture matches its reference exactly.
/// Run with `cargo test -- --ignored` to track progress toward (or guard) full
/// parity; currently all curated stage-1 fixtures match.
#[test]
#[ignore = "strict full-parity gate; run with --ignored"]
fn hir_parity_full() {
    let fixtures = collect_fixtures();
    let mut failures: Vec<String> = Vec::new();
    for fixture in &fixtures {
        let actual = actual_output(fixture);
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
        "{} fixture(s) did not match the parity oracle:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Smoke test: the simplest fixture lowers to the exact expected HIR. This is a
/// hard assertion (unlike the measured parity above) so a regression in the core
/// const/return/load path fails the build.
#[test]
fn const_return_exact() {
    let source = "function Component() {\n  const x = 42;\n  return x;\n}\n";
    let lowered = lower_to_hir(source, "Component.tsx");
    let printed = lowered[0].printed.as_ref().expect("lowered");
    let expected = "\
Component(): <unknown> $5
bb0 (block):
  [1] <unknown> $0 = 42
  [2] <unknown> $2 = StoreLocal Const <unknown> x$1 = <unknown> $0
  [3] <unknown> $3 = LoadLocal <unknown> x$1
  [4] Return Explicit <unknown> $3";
    assert_eq!(normalize(printed), normalize(expected));
}

/// Unsupported constructs surface as a structured error rather than panicking or
/// miscompiling. A `class` expression is not handled by stage-1 lowering.
#[test]
fn unsupported_is_reported() {
    let source = "function Component() {\n  const C = class {};\n  return C;\n}\n";
    let lowered = lower_to_hir(source, "Component.tsx");
    assert!(
        lowered[0].error.is_some(),
        "class expression should be reported as unsupported"
    );
}
