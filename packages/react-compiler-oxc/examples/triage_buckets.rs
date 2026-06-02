//! Dev helper: list fixtures in UNSUPPORTED + ts-types MISMATCH buckets.
//! Usage: cargo run --example triage_buckets -- [filter]

use std::fs;
use std::path::Path;

use react_compiler_oxc::{
    ModuleOptions, canonicalize, codegen, compile_to_reactive_with_options,
};

fn main() {
    let filter = std::env::args().nth(1).unwrap_or_default();
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/corpus");
    let manifest = fs::read_to_string(dir.join("manifest.tsv")).unwrap();

    let mut unsupported = Vec::new();
    let mut mismatch_ts = Vec::new();
    let mut mismatch_other = Vec::new();

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
        let Ok(compiled) = compiled else {
            continue;
        };
        let err: Option<String> = compiled.iter().find_map(|c| c.error.clone());

        let rust = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            codegen(&source, &filename)
        }));
        let Ok(rust_output) = rust else { continue };

        let oc = canonicalize(&oracle);
        let rc = canonicalize(&rust_output);
        if oc.trim_end() == rc.trim_end() {
            continue;
        }

        let is_ts = (ext == "ts" || ext == "tsx")
            && source.contains(": ")
            && !name.contains("fbt")
            && !source.contains("@gating");

        if let Some(e) = err {
            unsupported.push((name.to_string(), e));
        } else if is_ts {
            mismatch_ts.push(name.to_string());
        } else {
            mismatch_other.push(name.to_string());
        }
    }

    if filter.is_empty() || filter == "unsupported" {
        println!("=== UNSUPPORTED ({}) ===", unsupported.len());
        for (n, e) in &unsupported {
            let e1 = e.lines().next().unwrap_or("");
            println!("  {n}: {e1}");
        }
    }
    if filter.is_empty() || filter == "ts" {
        println!("\n=== MISMATCH ts-types ({}) ===", mismatch_ts.len());
        for n in &mismatch_ts {
            println!("  {n}");
        }
    }
    if filter == "other" {
        println!("\n=== MISMATCH other ({}) ===", mismatch_other.len());
        for n in &mismatch_other {
            println!("  {n}");
        }
    }
}
