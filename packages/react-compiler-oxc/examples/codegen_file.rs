//! Dev helper: run Rust codegen on an arbitrary source file and print the raw
//! (pre-canonicalize) output, to compare against `verify/capture-code.ts` (the
//! compiler-only oracle, no chained babel-plugin-fbt/idx).
//! Usage: cargo run --example codegen_file -- <path>

use std::fs;
use std::path::Path;

use react_compiler_oxc::codegen;

fn main() {
    let path = std::env::args().nth(1).expect("source file path");
    let source = fs::read_to_string(&path).unwrap();
    let filename = Path::new(&path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Component.tsx")
        .to_string();
    let rust = codegen(&source, &filename);
    print!("{rust}");
}
