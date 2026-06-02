//! CLI for react-compiler-oxc.
//!
//!   react-compiler-oxc <file>            # control-flow outline (default)
//!   react-compiler-oxc --cfg <file>      # control-flow outline
//!   react-compiler-oxc --compile <file>  # compile the file (emit memoized JS)

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mode, path): (&str, &str) = match args.as_slice() {
        [flag, p] if flag == "--compile" => ("compile", p.as_str()),
        [flag, p] if flag == "--canonicalize" => ("canonicalize", p.as_str()),
        [flag, p] if flag == "--cfg" => ("cfg", p.as_str()),
        [p] if !p.starts_with("--") => ("cfg", p.as_str()),
        _ => {
            eprintln!("usage: react-compiler-oxc [--compile|--cfg] <file>");
            return ExitCode::from(2);
        }
    };

    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) => {
            eprintln!("error: cannot read {path}: {error}");
            return ExitCode::from(2);
        }
    };

    match mode {
        "compile" => {
            // Compilation may bail (panic/invariant) on constructs outside the
            // supported set; fall back to the original source so a batch run over
            // a whole app never loses a file, and report the bail on stderr.
            match catch_unwind(AssertUnwindSafe(|| {
                react_compiler_oxc::compile_module(&source, path)
            })) {
                Ok(out) => {
                    print!("{out}");
                    ExitCode::SUCCESS
                }
                Err(_) => {
                    eprintln!("! {path} — compilation bailed; emitting source unchanged");
                    print!("{source}");
                    ExitCode::from(1)
                }
            }
        }
        "canonicalize" => {
            // Re-parse + reprint via oxc (formatting-independent normal form) so
            // two emitters' outputs can be compared for semantic equality.
            print!("{}", react_compiler_oxc::canonicalize(&source));
            ExitCode::SUCCESS
        }
        _ => {
            let outline = react_compiler_oxc::print_control_flow(&source, path);
            if outline.is_empty() {
                eprintln!("? {path} — no top-level function found");
                return ExitCode::from(2);
            }
            print!("{outline}");
            ExitCode::SUCCESS
        }
    }
}
