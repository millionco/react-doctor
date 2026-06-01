//! Dev helper: compiler-only canonical parity for a list of fixtures, comparing
//! the Rust codegen against an oracle `.code` captured via
//! `verify/capture-code.ts` (the React-Compiler-only output, WITHOUT the chained
//! babel-plugin-fbt / babel-plugin-idx transforms). Reads a manifest on stdin of
//! `<src-path>\t<oracle-code-path>` lines and reports per-fixture match + a tally.
//! Usage: cargo run --example compiler_only_parity < manifest.tsv

use std::fs;
use std::io::Read;

use react_compiler_oxc::{canonicalize, codegen};

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let mut matched = 0usize;
    let mut total = 0usize;
    for line in input.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(2, '\t');
        let (Some(src_path), Some(oracle_path)) = (parts.next(), parts.next()) else {
            continue;
        };
        let Ok(source) = fs::read_to_string(src_path) else {
            println!("SKIP (no src): {src_path}");
            continue;
        };
        let Ok(oracle) = fs::read_to_string(oracle_path) else {
            println!("SKIP (no oracle): {oracle_path}");
            continue;
        };
        let filename = std::path::Path::new(src_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Component.tsx")
            .to_string();
        let rust = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            codegen(&source, &filename)
        }));
        total += 1;
        let name = std::path::Path::new(src_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(src_path);
        match rust {
            Ok(rust_output) => {
                let oc = canonicalize(&oracle);
                let rc = canonicalize(&rust_output);
                if oc.trim_end() == rc.trim_end() {
                    matched += 1;
                    println!("MATCH    {name}");
                } else {
                    println!("MISMATCH {name}");
                }
            }
            Err(_) => println!("PANIC    {name}"),
        }
    }
    println!("\n=== compiler-only parity: {matched}/{total} ===");
}
