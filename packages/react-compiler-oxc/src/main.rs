//! CLI: print the control-flow outline for a React file.
//!
//!   cargo run -- path/to/Component.tsx

use std::process::ExitCode;

fn main() -> ExitCode {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: react-compiler-oxc <file>");
        return ExitCode::from(2);
    };

    let source = match std::fs::read_to_string(&path) {
        Ok(source) => source,
        Err(error) => {
            eprintln!("error: cannot read {path}: {error}");
            return ExitCode::from(2);
        }
    };

    let outline = react_compiler_oxc::print_control_flow(&source, &path);
    if outline.is_empty() {
        eprintln!("? {path} — no top-level function found");
        return ExitCode::from(2);
    }
    print!("{outline}");
    ExitCode::SUCCESS
}
