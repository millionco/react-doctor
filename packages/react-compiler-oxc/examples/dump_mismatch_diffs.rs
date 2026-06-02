//! Dev helper: dump canonical diffs for all MISMATCH fixtures so they can be
//! classified formatting-void vs semantic.
//! Usage: cargo run --example dump_mismatch_diffs -- [name-substr]

use std::fs;
use std::path::Path;

use react_compiler_oxc::{ModuleOptions, canonicalize, codegen, compile_to_reactive_with_options};

fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").trim_end().to_string()
}

fn main() {
    let filter = std::env::args().nth(1).unwrap_or_default();
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/corpus");
    let manifest = fs::read_to_string(dir.join("manifest.tsv")).unwrap();

    for line in manifest.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(name), Some(ext)) = (parts.next(), parts.next()) else {
            continue;
        };
        if !filter.is_empty() && !name.contains(&filter) {
            continue;
        }
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

        let oc = normalize(&canonicalize(&oracle));
        let rc = normalize(&canonicalize(&rust_output));
        if oc == rc {
            continue;
        }

        println!("\n========== {name} ==========");
        // Line-by-line diff
        let ol: Vec<&str> = oc.lines().collect();
        let rl: Vec<&str> = rc.lines().collect();
        let max = ol.len().max(rl.len());
        for i in 0..max {
            let o = ol.get(i).copied().unwrap_or("");
            let r = rl.get(i).copied().unwrap_or("");
            if o != r {
                println!("  O[{i}]: {o}");
                println!("  R[{i}]: {r}");
            }
        }
    }
}
