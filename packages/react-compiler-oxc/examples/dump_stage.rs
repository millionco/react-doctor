//! Dev helper: dump Rust HIR/reactive at a named stage for a corpus fixture.
//! Usage: cargo run --example dump_stage -- <fixture-name> <Stage>

use std::fs;
use std::path::Path;

use react_compiler_oxc::compile_to_stage;

fn main() {
    let name = std::env::args().nth(1).expect("fixture name");
    let stage = std::env::args().nth(2).expect("stage name");
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
    let filename = format!("{name}.{ext}");
    let fns = compile_to_stage(&source, &filename, &stage);
    for f in fns {
        println!("=== {} ===", f.name.unwrap_or_default());
        if let Some(err) = f.error {
            println!("ERROR: {err}");
        }
        if let Some(p) = f.printed {
            println!("{p}");
        }
    }
}
