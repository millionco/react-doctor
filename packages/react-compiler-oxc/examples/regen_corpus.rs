//! Reproducible corpus-ref regenerator (Stage 8b integrity fix; Stage 18
//! dual-oracle extension).
//!
//! The corpus oracle refs (`tests/fixtures/corpus/<name>.code`) are the
//! authoritative `result.code` the TS compiler emits for each fixture *under the
//! exact options the fixture harness uses* — i.e. honoring each fixture's
//! first-line pragmas (`@compilationMode`, `@outputMode`, `@gating`,
//! `@expectNothingCompiled`, `'use no memo'`, validations, ...). The harness
//! writes that output verbatim into the committed `<fixture>.expect.md` `## Code`
//! section (see `react-compiler/src/__tests__/runner/harness.ts`:
//! `writeOutputToString` only emits a `## Code` block when `compilerOutput != null`,
//! and `compilerOutput` is the pragma-honoring `forgetResult.code`).
//!
//! # Dual-oracle (Stage 18)
//!
//! There are TWO honest oracle kinds, selected per fixture by an optional 4th
//! manifest column (default `.expect.md`):
//!
//!   * `.expect.md`  — the default. `<name>.code` is the verbatim `## Code` block
//!                     of the fixture's `.expect.md` snapshot. This is the FULL
//!                     harness pipeline output: React Compiler, THEN the chained
//!                     downstream babel plugins (babel-plugin-fbt, babel-plugin-idx),
//!                     THEN prettier. 1356 of the corpus fixtures use this oracle.
//!
//!   * `.cc.code`    — the compiler-only oracle. `<name>.cc.code` is the verbatim
//!                     stdout of `src/verify/capture-code.ts` (run from the
//!                     `react-compiler` package dir): the React Compiler ALONE,
//!                     babel-generator output, with NO chained fbt/idx plugins and
//!                     NO prettier. A fixture is routed here ONLY when it has been
//!                     PROVEN (by diffing this capture against the `.expect.md`
//!                     `## Code`) that the only divergence is caused by a downstream
//!                     plugin (`fbt(...)` -> `fbt._(...)`, bare `idx(...)` -> a
//!                     safe-navigation ternary) or a prettier reformat that alters
//!                     the compiler's real output (e.g. `timers`: prettier collapsed
//!                     a SIGNIFICANT JSX whitespace the compiler emits) — i.e. the
//!                     React Compiler's OWN output is correct and the Rust output
//!                     canonical-matches it. The split is documented in `manifest.tsv`
//!                     (each `.cc.code` entry is preceded by a `# <name>: <reason>`
//!                     comment) and in `tests/corpus_parity.rs`. A fixture may NEVER
//!                     be moved here to mask a genuine compiler bug; those are
//!                     code-fixed instead.
//!
//! This regenerator derives every ref directly from its authoritative source (the
//! `.expect.md` `## Code` block, or `capture-code.ts` stdout) — it never hand-edits
//! or fabricates a ref, and on a clean tree it rewrites **0** of either kind.
//! Crucially, a `.expect.md` fixture whose oracle *throws* (a real compilation
//! error, `isExpectError`/validation bailout) has **no** `## Code` block — there is
//! no `result.code` to match — so it is **excluded** from the corpus entirely (it
//! must not be scored against a fabricated ref).
//!
//! It rewrites, in place, only:
//!   * `<name>.code` / `<name>.cc.code` — the oracle ref (per kind)
//!   * `manifest.tsv`                   — drops any `.expect.md` entry whose oracle
//!                                        has no `## Code` (preserving `#` reason
//!                                        comments + the 4th oracle-kind column)
//!
//! `<name>.src.<ext>` files are left untouched (they are byte-identical copies of
//! the upstream fixtures). Only fixtures already present in the manifest are
//! considered (this regenerator fixes integrity of the existing corpus; it does
//! not expand the fixture set).
//!
//! Usage (run from the crate dir):
//!     cargo run --example regen_corpus
//!
//! It prints how many refs were rewritten and how many fixtures were dropped.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The oracle a fixture's ref is derived from (4th manifest column).
#[derive(Clone, Copy, PartialEq, Eq)]
enum OracleKind {
    /// `<name>.code` from the fixture's `.expect.md` `## Code` block (default).
    ExpectMd,
    /// `<name>.cc.code` from `capture-code.ts` (compiler-only, pre-plugin/prettier).
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

fn corpus_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/corpus")
}

/// The `react-compiler` package dir, from which `capture-code.ts` must be run
/// (its TS module resolution depends on the cwd). Derived relative to this crate.
fn react_compiler_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate parent (packages/)")
        .join("react-compiler")
}

/// Run `npx --no-install tsx src/verify/capture-code.ts <abspath>` from the
/// `react-compiler` dir and return its stdout (the compiler-only `result.code`,
/// babel-generator output). Returns `None` if the capture fails (the compiler
/// raised / emitted nothing).
fn capture_compiler_only(abspath: &str) -> Option<String> {
    let output = Command::new("npx")
        .args(["--no-install", "tsx", "src/verify/capture-code.ts", abspath])
        .current_dir(react_compiler_dir())
        .output()
        .unwrap_or_else(|e| panic!("run capture-code.ts for {abspath}: {e}"));
    if !output.status.success() {
        eprintln!(
            "capture-code.ts FAILED for {abspath}:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Extract the verbatim contents of the first ```` ```javascript ```` fenced
/// block that follows a `## Code` header in an `.expect.md`. Returns `None` if
/// the file has no `## Code` section (the oracle threw / emitted no code).
fn extract_code_block(expect_md: &str) -> Option<String> {
    let mut lines = expect_md.lines().peekable();
    // Find the `## Code` header.
    let mut found_header = false;
    for line in lines.by_ref() {
        if line.trim_end() == "## Code" {
            found_header = true;
            break;
        }
    }
    if !found_header {
        return None;
    }
    // Skip blank lines, then expect an opening fence (```javascript or ```js).
    let mut opened = false;
    for line in lines.by_ref() {
        let t = line.trim_end();
        if t.is_empty() {
            continue;
        }
        if t.starts_with("```") {
            opened = true;
            break;
        }
        // Unexpected content before the fence: not a code block we understand.
        return None;
    }
    if !opened {
        return None;
    }
    // Collect until the closing fence.
    let mut body: Vec<String> = Vec::new();
    for line in lines.by_ref() {
        if line.trim_end() == "```" {
            return Some(normalize_runtime_import_line(body).join("\n"));
        }
        body.push(line.to_string());
    }
    // No closing fence — malformed.
    None
}

/// The harness emits `result.code` with `retainLines: true`, so the prepended
/// `react/compiler-runtime` cache import lands on the *same source line* as the
/// fixture's first line — frequently a leading `//` comment, producing
/// `import { c as _c } from "react/compiler-runtime"; // <comment>` (ES-module
/// fixtures) or `const { c: _c } = require("react/compiler-runtime"); // <comment>`
/// (`@script` source-type fixtures). When that trailing line-comment rides on the
/// import statement, oxc's parser attaches it as a trailing comment and the
/// printer drops it on reprint — whereas the Rust pipeline prepends the import on
/// its *own* line (`codegen()` does `format!("…;\n{out}")`), so the comment
/// survives. To make the canonical comparison faithful to the real compiler output
/// (the comment IS real `result.code`), split any such trailing comment onto its
/// own following line — matching both how Rust prepends and how the canonicalizer
/// treats own-line comments. This is purely a line-placement normalization (no
/// token added or removed) and is canonicalization-neutral for every other fixture.
fn normalize_runtime_import_line(body: Vec<String>) -> Vec<String> {
    // Both the ES-module (`import { c as _c } from …;`) and the CommonJS
    // (`const { c: _c } = require(…);`, emitted for `@script` source-type
    // fixtures) cache-import prefixes.
    const IMPORT_PREFIXES: [&str; 2] = [
        "import { c as _c } from \"react/compiler-runtime\";",
        "const { c: _c } = require(\"react/compiler-runtime\");",
    ];
    let Some(first) = body.first() else {
        return body;
    };
    let Some((prefix, rest)) = IMPORT_PREFIXES
        .iter()
        .find_map(|p| first.strip_prefix(p).map(|rest| (*p, rest)))
    else {
        return body;
    };
    let rest = rest.trim_start();
    if rest.is_empty() {
        return body;
    }
    // Split the trailing content (a `//` or `/* */` comment) onto its own line.
    let mut out = Vec::with_capacity(body.len() + 1);
    out.push(prefix.to_string());
    out.push(rest.to_string());
    out.extend(body.into_iter().skip(1));
    out
}

/// Apply `normalize_runtime_import_line` to a raw multi-line code string (used for
/// the compiler-only `capture-code.ts` stdout, which is plain code, not markdown).
fn normalize_code(code: &str) -> String {
    let body: Vec<String> = code.lines().map(str::to_string).collect();
    normalize_runtime_import_line(body).join("\n")
}

fn main() {
    let dir = corpus_dir();
    let manifest = fs::read_to_string(dir.join("manifest.tsv")).expect("read manifest.tsv");

    let mut kept_lines: Vec<String> = Vec::new();
    let mut rewritten = 0usize;
    let mut unchanged = 0usize;
    let mut cc_rewritten = 0usize;
    let mut cc_unchanged = 0usize;
    let mut dropped: Vec<String> = Vec::new();

    for line in manifest.lines() {
        // Preserve `#` reason comments (the auditable oracle-split manifest)
        // and blank lines verbatim.
        if line.starts_with('#') || line.trim().is_empty() {
            kept_lines.push(line.to_string());
            continue;
        }

        let mut parts = line.splitn(4, '\t');
        let (Some(name), Some(ext), Some(abspath)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let kind = OracleKind::parse(parts.next());

        match kind {
            OracleKind::ExpectMd => {
                // The oracle snapshot sits beside the fixture: `<fixture-stem>.expect.md`,
                // where the fixture path is `abspath` and `ext` is its trailing extension
                // (so `foo.flow.js` -> stem `foo.flow`).
                let stem = abspath.strip_suffix(&format!(".{ext}")).unwrap_or(abspath);
                let expect_path = format!("{stem}.expect.md");
                let expect_md = fs::read_to_string(&expect_path)
                    .unwrap_or_else(|_| panic!("read oracle snapshot {expect_path}"));

                match extract_code_block(&expect_md) {
                    None => {
                        // Oracle threw / emitted no code: drop from the corpus and
                        // delete the fabricated `.code` ref + `.src` so the corpus
                        // stays self-consistent.
                        dropped.push(name.to_string());
                        let _ = fs::remove_file(dir.join(format!("{name}.code")));
                        let _ = fs::remove_file(dir.join(format!("{name}.src.{ext}")));
                    }
                    Some(code) => {
                        let code_path = dir.join(format!("{name}.code"));
                        let new_contents = format!("{code}\n");
                        let prev = fs::read_to_string(&code_path).unwrap_or_default();
                        if prev != new_contents {
                            fs::write(&code_path, &new_contents).expect("write .code ref");
                            rewritten += 1;
                        } else {
                            unchanged += 1;
                        }
                        kept_lines.push(line.to_string());
                    }
                }
            }
            OracleKind::CompilerOnly => {
                // Compiler-only oracle: derive `<name>.cc.code` verbatim from
                // `capture-code.ts` stdout (the React Compiler alone, no chained
                // fbt/idx plugins, no prettier).
                match capture_compiler_only(abspath) {
                    None => {
                        dropped.push(name.to_string());
                        let _ = fs::remove_file(dir.join(format!("{name}.cc.code")));
                        let _ = fs::remove_file(dir.join(format!("{name}.src.{ext}")));
                    }
                    Some(raw) => {
                        let code = normalize_code(&raw);
                        let code_path = dir.join(format!("{name}.cc.code"));
                        let new_contents = format!("{}\n", code.trim_end());
                        let prev = fs::read_to_string(&code_path).unwrap_or_default();
                        if prev != new_contents {
                            fs::write(&code_path, &new_contents).expect("write .cc.code ref");
                            cc_rewritten += 1;
                        } else {
                            cc_unchanged += 1;
                        }
                        kept_lines.push(line.to_string());
                    }
                }
            }
        }
    }

    // Rewrite the manifest with only the kept (oracle-emits-code) fixtures,
    // preserving the `#` reason comments + 4th oracle-kind column.
    let mut manifest_out = kept_lines.join("\n");
    manifest_out.push('\n');
    fs::write(dir.join("manifest.tsv"), manifest_out).expect("write manifest.tsv");

    eprintln!(
        "regen_corpus: .expect.md refs: {rewritten} rewritten, {unchanged} unchanged; \
         .cc.code refs: {cc_rewritten} rewritten, {cc_unchanged} unchanged; \
         dropped {} (oracle threw / no ## Code / capture failed)",
        dropped.len()
    );
    if !dropped.is_empty() {
        eprintln!("dropped fixtures:");
        for d in &dropped {
            eprintln!("  {d}");
        }
    }
}
