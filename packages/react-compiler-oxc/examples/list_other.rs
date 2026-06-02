//! Dev helper: list all MISMATCH fixtures classified as "other" (the genuinely
//! fixable, heterogeneous bucket), matching corpus_parity's subcategory logic.
//! Usage: cargo run --example list_other

use std::fs;
use std::path::Path;

use react_compiler_oxc::{ModuleOptions, canonicalize, codegen, compile_to_reactive_with_options};

fn subcategory(source: &str, name: &str, ext: &str) -> &'static str {
    let s = source;
    let n = name;
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
    if s.contains(": ") && (ext == "ts" || ext == "tsx") {
        return "typescript-types";
    }
    "other"
}

fn main() {
    let want = std::env::args().nth(1).unwrap_or_else(|| "other".to_string());
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/corpus");
    let manifest = fs::read_to_string(dir.join("manifest.tsv")).unwrap();

    let mut out = Vec::new();
    for line in manifest.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(name), Some(ext)) = (parts.next(), parts.next()) else {
            continue;
        };
        let src_path = dir.join(format!("{name}.src.{ext}"));
        let code_path = dir.join(format!("{name}.code"));
        let (Ok(source), Ok(oracle)) =
            (fs::read_to_string(&src_path), fs::read_to_string(&code_path))
        else {
            continue;
        };
        let filename = format!("{name}.{ext}");

        let options = ModuleOptions::from_source(&source);
        let compiled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            compile_to_reactive_with_options(&source, &filename, &options)
        }));
        let Ok(compiled) = compiled else { continue };
        let err: Option<String> = compiled.iter().find_map(|c| c.error.clone());
        if err.is_some() {
            continue;
        }
        let rust = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            codegen(&source, &filename)
        }));
        let Ok(rust_output) = rust else { continue };

        let oc = canonicalize(&oracle);
        let rc = canonicalize(&rust_output);
        if oc.trim_end() == rc.trim_end() {
            continue;
        }
        if subcategory(&source, name, ext) == want {
            out.push(name.to_string());
        }
    }
    out.sort();
    println!("=== MISMATCH {} ({}) ===", want, out.len());
    for n in &out {
        println!("  {n}");
    }
}
