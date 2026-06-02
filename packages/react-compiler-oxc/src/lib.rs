//! A Rust port of the React Doctor verifier's control-flow outline, built on
//! [oxc](https://oxc.rs). Given a React source string it produces a structured,
//! source-anchored description of each component/hook's behavior — the same
//! agent-friendly CFG shape as the TypeScript `react-compiler` verifier — by
//! walking oxc's AST directly.

pub mod build_hir;
pub mod codegen;
pub mod compile;
pub mod diagnostic;
pub mod environment;
pub mod gating;
pub mod hir;
mod line_map;
pub mod passes;
mod printer;
pub mod reactive_scopes;
pub mod suppression;
pub mod type_inference;

pub use codegen::{canonicalize, codegen, compile_module, print_program};
pub use diagnostic::{
    BabelPosition, BabelSourceLocation, Diagnostic, DiagnosticDetail, Diagnostics, ErrorCategory,
    ErrorSeverity, LintRule, LintRulePreset, PositionResolver, lint_rules, rule_for_category,
};
pub use compile::{
    CompilationMode, CompiledReactive, DynamicGatingOptions, ExternalFunction, LoweredFn,
    ModuleOptions, PanicThreshold, compile_to_reactive, compile_to_reactive_with_options,
    compile_to_stage, has_memo_cache_import, has_module_scope_opt_out, lint, lint_rename_source,
    lower_to_hir,
};

use oxc::allocator::Allocator;
use oxc::parser::Parser;
use oxc::span::SourceType;

use crate::printer::Printer;

/// Render the control-flow outline for every top-level function-like
/// declaration in `source`. `filename` only drives source-type inference
/// (`.ts`/`.tsx`/`.js`/`.jsx`).
pub fn print_control_flow(source: &str, filename: &str) -> String {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type).parse();

    let mut printer = Printer::new(source);
    printer.render_program(&parsed.program.body);
    printer.finish()
}
