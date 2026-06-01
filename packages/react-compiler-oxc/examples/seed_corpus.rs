//! One-time corpus seeder: expand the corpus manifest to the FULL set of fixtures
//! whose oracle emits a `## Code` block (the honest emitting-fixture universe).
//!
//! `regen_corpus.rs` deliberately only repairs the integrity of EXISTING manifest
//! entries — it never expands the fixture set. As a result the committed manifest
//! historically under-counted: ~87 fixtures whose `.expect.md` DOES contain a
//! `## Code` block were never seeded, so the reported denominator (1334) was a
//! subset of the true emitting universe (~1421). The excluded set skewed toward
//! harder control-flow variants (useMemo-*, useCallback-*, repro-*), so omitting
//! them was not denominator-honest.
//!
//! This seeder walks the ENTIRE fixture tree
//! (`react-compiler/src/__tests__/fixtures/compiler/**/*.expect.md`), and for each
//! fixture whose oracle emits a `## Code` block AND whose source oxc can parse,
//! ensures a manifest entry + `<name>.src.<ext>` copy exists. It DROPS:
//!   * fixtures whose `.expect.md` has no `## Code` block (the oracle threw), and
//!   * fixtures oxc cannot parse (e.g. some Flow-only syntax) — these can never
//!     match and would only add PANIC/parse noise, so they are reported and
//!     skipped, NOT scored.
//!
//! It does NOT write `.code` refs — those are derived authoritatively by
//! `regen_corpus.rs` from the `.expect.md` `## Code` block (run it after this).
//!
//! Usage (run from the crate dir):
//!     cargo run --example seed_corpus
//!     cargo run --example regen_corpus    # then derive/refresh all `.code` refs
//!
//! It prints how many fixtures were added, how many were already present, how many
//! were dropped (no `## Code`), and how many were skipped (oxc parse failure).

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use oxc::allocator::Allocator;
use oxc::parser::Parser;
use oxc::span::SourceType;

fn crate_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

fn corpus_dir() -> PathBuf {
    crate_dir().join("tests/fixtures/corpus")
}

/// The root of the upstream fixture tree.
fn fixtures_root() -> PathBuf {
    crate_dir().join("../react-compiler/src/__tests__/fixtures/compiler")
}

/// The known source extensions a fixture can use (the trailing component only).
const SOURCE_EXTS: [&str; 5] = ["js", "ts", "tsx", "jsx", "mjs"];

/// Whether an `.expect.md` contains a `## Code` header (the oracle emitted code).
fn has_code_block(expect_md: &str) -> bool {
    expect_md.lines().any(|l| l.trim_end() == "## Code")
}

/// Recursively collect every `*.expect.md` under `dir`.
fn walk_expect_md(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_expect_md(&path, out);
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".expect.md"))
        {
            out.push(path);
        }
    }
}

fn main() {
    let corpus = corpus_dir();
    let root = fixtures_root().canonicalize().expect("canonicalize fixtures root");
    let manifest_path = corpus.join("manifest.tsv");
    let manifest = fs::read_to_string(&manifest_path).expect("read manifest.tsv");

    // Existing sanitized names already present in the manifest (skipping the
    // Stage-18 `#` reason-comment / header lines of the dual-oracle manifest).
    let existing: BTreeSet<String> = manifest
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .filter_map(|l| l.split('\t').next().map(|s| s.to_string()))
        .collect();

    let mut md_files = Vec::new();
    walk_expect_md(&root, &mut md_files);
    md_files.sort();

    let mut new_lines: Vec<String> = Vec::new();
    let mut added = 0usize;
    let mut already = 0usize;
    let mut no_code = 0usize;
    let mut unparseable: Vec<String> = Vec::new();
    let mut missing_src: Vec<String> = Vec::new();

    for md in &md_files {
        let md_str = md.to_string_lossy();
        let stem = md_str.strip_suffix(".expect.md").unwrap_or(&md_str).to_string();

        // Find the sibling source file `<stem>.<ext>`.
        let mut src_path: Option<(PathBuf, String)> = None;
        for ext in SOURCE_EXTS {
            let candidate = PathBuf::from(format!("{stem}.{ext}"));
            if candidate.exists() {
                src_path = Some((candidate, ext.to_string()));
                break;
            }
        }
        let Some((src, ext)) = src_path else {
            continue; // no source (shouldn't happen)
        };

        // Sanitized name: the path relative to the fixtures root, minus the
        // trailing `.<ext>`, with `/` -> `__`.
        let abs_src = src.canonicalize().unwrap_or(src.clone());
        let rel = abs_src
            .strip_prefix(&root)
            .unwrap_or(&abs_src)
            .to_string_lossy()
            .to_string();
        let rel_no_ext = rel.strip_suffix(&format!(".{ext}")).unwrap_or(&rel);
        let name = rel_no_ext.replace(['/', std::path::MAIN_SEPARATOR], "__");

        let expect_md = fs::read_to_string(md).expect("read expect.md");
        if !has_code_block(&expect_md) {
            no_code += 1;
            continue;
        }

        if existing.contains(&name) {
            already += 1;
            continue;
        }

        // Only seed fixtures oxc can parse — an unparseable fixture can never match
        // and would only add noise. Report (do not silently inflate or drop into a
        // scored bucket).
        let source = match fs::read_to_string(&abs_src) {
            Ok(s) => s,
            Err(_) => {
                missing_src.push(name);
                continue;
            }
        };
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &source, SourceType::tsx()).parse();
        if !parsed.errors.is_empty() {
            unparseable.push(name);
            continue;
        }

        // Copy the source into the corpus as `<name>.src.<ext>` and add a manifest
        // line. The `.code` ref is written by regen_corpus.
        let src_dst = corpus.join(format!("{name}.src.{ext}"));
        fs::write(&src_dst, &source).expect("write .src copy");
        new_lines.push(format!("{name}\t{ext}\t{}", abs_src.to_string_lossy()));
        added += 1;
    }

    if !new_lines.is_empty() {
        let mut out = manifest.trim_end().to_string();
        out.push('\n');
        out.push_str(&new_lines.join("\n"));
        out.push('\n');
        fs::write(&manifest_path, out).expect("write manifest.tsv");
    }

    eprintln!(
        "seed_corpus: added {added} fixtures, {already} already present, \
         {no_code} dropped (no ## Code), {} unparseable (skipped), {} missing src",
        unparseable.len(),
        missing_src.len()
    );
    if !unparseable.is_empty() {
        eprintln!("unparseable (oxc) — not seeded:");
        for u in &unparseable {
            eprintln!("  {u}");
        }
    }
}
