//! Dev helper: dump Rust codegen vs oracle for a single corpus fixture.
//! Usage: cargo run --example diff_fixture -- <fixture-name>

use std::fs;
use std::path::Path;

use react_compiler_oxc::{canonicalize, codegen};

fn main() {
    let name = std::env::args().nth(1).expect("fixture name");
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/corpus");
    let manifest = fs::read_to_string(dir.join("manifest.tsv")).unwrap();
    let mut ext = String::new();
    for line in manifest.lines() {
        let mut parts = line.splitn(3, '\t');
        if parts.next() == Some(name.as_str()) {
            ext = parts.next().unwrap_or("js").to_string();
            break;
        }
    }
    let source = fs::read_to_string(dir.join(format!("{name}.src.{ext}"))).unwrap();
    let oracle = fs::read_to_string(dir.join(format!("{name}.code"))).unwrap();
    let filename = format!("{name}.{ext}");
    let rust = codegen(&source, &filename);

    let oracle_c = canonicalize(&oracle);
    let rust_c = canonicalize(&rust);

    if std::env::args().any(|a| a == "--canon") {
        println!("=== ORACLE (canonical) ===\n{oracle_c}");
        println!("\n=== RUST (canonical) ===\n{rust_c}");
        println!("\n=== MATCH: {} ===", oracle_c.trim_end() == rust_c.trim_end());
    } else {
        println!("=== ORACLE ===\n{oracle}");
        println!("\n=== RUST ===\n{rust}");
        println!("\n=== MATCH: {} ===", oracle_c.trim_end() == rust_c.trim_end());
    }
}
