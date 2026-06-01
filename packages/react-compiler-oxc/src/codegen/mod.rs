//! Codegen (Stage 7): the final step that turns the post-`PruneHoistedContexts`
//! [`ReactiveFunction`](crate::reactive_scopes::ReactiveFunction) into output JS.
//!
//! In the TypeScript compiler this is `CodegenReactiveFunction`, which builds a
//! Babel AST (`CodegenFunction`) and prints it with babel-generator. Here we
//! build an [oxc] AST (via the oxc allocator / parser) and print it with oxc's
//! [`Codegen`](oxc::codegen::Codegen), producing the compiled source. The
//! memoization runtime that Stage 7 emits is:
//!
//! - `import { c as _c } from "react/compiler-runtime";`
//! - `const $ = _c(N);` (the cache array, `N` = number of memo slots used),
//! - per-scope change-detection blocks
//!   (`if ($[i] !== dep) { …compute…; $[i] = dep; $[k] = out; } else { out = $[k]; }`),
//! - the sentinel form
//!   (`$[i] === Symbol.for("react.memo_cache_sentinel")`) for dependency-free
//!   scopes,
//! - and outlined functions appended after the main function.
//!
//! The compiler does **not** lower JSX — JSX is preserved verbatim in the output.
//!
//! ## What lives here so far (infrastructure)
//!
//! - [`print_program`] — print an assembled oxc [`Program`] to a `String` via
//!   `oxc::codegen`, with the [`codegen_options`] used consistently on both
//!   sides of the parity comparison.
//! - [`parse_program`] — parse a source string into an oxc [`Program`] with a
//!   consistent `tsx` [`SourceType`].
//! - [`canonicalize`] — normalize a source string (oracle `result.code` **or**
//!   Rust-emitted code) through the *same* oxc parser + printer so that the
//!   babel-generator vs. oxc-codegen formatting difference disappears and only
//!   real program/AST differences remain. This is the backbone of the canonical
//!   parity check in `tests/codegen_parity.rs`.
//! - [`codegen`] — the Stage 7 entry point. Runs the full pipeline (lower → all
//!   HIR passes → `BuildReactiveFunction` → reactive passes →
//!   `CodegenReactiveFunction`) and emits the compiled source. The emitter
//!   ([`codegen_reactive_function`]) is fully ported and matches the oracle on
//!   all stored `.code` refs under the canonical comparison.

pub mod codegen_reactive_function;
pub mod hash;

use oxc::allocator::{Allocator, FromIn, Vec as OxcVec};
use oxc::ast::AstBuilder;
use oxc::ast::ast::{
    JSXChild, JSXElement, JSXElementName, JSXExpression, JSXFragment, Program, Statement, Str,
};
use oxc::ast_visit::VisitMut;
use oxc::codegen::{Codegen, CodegenOptions};
use oxc::parser::Parser;
use oxc::span::{GetSpan, SourceType};

use crate::build_hir::lower_expression::trim_jsx_text;

/// The [`SourceType`] every Stage 7 input/output is parsed and printed under.
///
/// Stage 7 output is plain JS that may contain JSX (the compiler preserves JSX),
/// and fixtures may be authored as `.ts`/`.tsx` with type annotations, so we use
/// the TS+JSX source type uniformly. Using the *same* source type on both sides
/// of the canonical comparison is what makes the formatting identical.
pub fn source_type() -> SourceType {
    SourceType::tsx()
}

/// The [`CodegenOptions`] used to print every Stage 7 program.
///
/// Both the oracle `result.code` and the Rust-emitted AST are printed through
/// the *same* [`Codegen`] with these options, so byte differences reflect real
/// program differences rather than formatting. We keep the oxc defaults
/// (double quotes, 2-space indent, no minify) — the point is consistency, not a
/// specific style.
pub fn codegen_options() -> CodegenOptions {
    CodegenOptions::default()
}

/// Print an assembled oxc [`Program`] to a `String` via `oxc::codegen`.
///
/// This is the single choke point for turning an oxc AST into source text; the
/// Rust Stage 7 emitter builds a `Program` and hands it here, and the parity
/// harness prints the re-parsed oracle output the same way.
pub fn print_program(program: &Program<'_>) -> String {
    Codegen::new()
        .with_options(codegen_options())
        .with_source_text(program.source_text)
        .build(program)
        .code
}

/// Parse a source string into an oxc [`Program`] using the Stage 7 [`source_type`].
///
/// The returned `Program` borrows from `allocator`; callers own the allocator so
/// the AST outlives the call. Parse errors are not surfaced here — the caller
/// (e.g. the parity harness) inspects the parser result directly when it needs
/// to distinguish "did not parse" from "parsed but differs".
pub fn parse_program<'a>(allocator: &'a Allocator, source: &'a str) -> Program<'a> {
    Parser::new(allocator, source, source_type())
        .parse()
        .program
}

/// Canonicalize a source string by round-tripping it through the *same* oxc
/// parser + printer used everywhere else in Stage 7.
///
/// This is the formatting-independent normalization the parity check relies on:
///
/// ```text
/// oracle_canonical = canonicalize(result.code)   // re-parse + print babel output
/// rust_canonical   = print_program(rust_ast)     // already an oxc AST
/// ```
///
/// Because both pass through the identical [`Codegen`] configuration, only real
/// program/AST differences can show up in `oracle_canonical != rust_canonical`.
///
/// `canonicalize` is idempotent: `canonicalize(canonicalize(x)) ==
/// canonicalize(x)` for any input that oxc round-trips cleanly (proven by
/// `tests/codegen_parity.rs::canonicalization_is_idempotent`).
pub fn canonicalize(source: &str) -> String {
    let allocator = Allocator::default();
    let mut program = parse_program(&allocator, source);
    let mut normalizer = Normalizer {
        allocator: &allocator,
        builder: AstBuilder::new(&allocator),
        fbt_depth: 0,
    };
    normalizer.visit_program(&mut program);
    print_program(&program)
}

/// A formatting-independence pass run over the parsed AST before printing, so the
/// canonical comparison sees only *semantic* program differences — not artifacts
/// of which printer (babel-generator's `result.code` vs. the harness's prettier
/// `.expect.md`) produced the oracle text.
///
/// Both sides of the parity comparison (the oracle `result.code`/`.expect.md` and
/// the Rust-emitted code) pass through this *same* normalizer + the *same* oxc
/// codegen, so a difference that survives is a real program difference. Each
/// normalization is independently semantic-preserving:
///
///   * **Empty statements** (a bare `;`) are dropped. The TS compiler genuinely
///     emits `t.emptyStatement()` for a catch-binding `DeclareLocal(Catch)`, so it
///     is present in the raw `result.code` — but prettier strips it in the
///     `.expect.md`. It carries no behavior, so removing it on both sides makes
///     the two oracle forms agree. (`EmptyStatement` is a no-op per the ECMAScript
///     spec; it cannot change runtime behavior.)
///
///   * **JSX text whitespace** is normalized via [`trim_jsx_text`] — the *exact*
///     JSX-spec whitespace algorithm (babel's `cleanJSXElementLiteralChild`, the
///     same one [`crate::build_hir`] uses at lowering time). The runtime children a
///     JSX element produces are determined by this trim: leading/trailing
///     whitespace touching a newline is stripped, blank lines are removed, and an
///     interior newline collapses to a single space. A whitespace-only child that
///     trims to nothing is dropped entirely; otherwise the child's text is replaced
///     by its trimmed value. This is what makes a prettier-rewrapped multi-line
///     oracle JSX (`<div>\n  a {x}\n</div>`) and the single-line Rust emission
///     (`<div>a {x}</div>`) compare equal — they describe the *same* element
///     children. Crucially, **significant whitespace is preserved**: a same-line
///     space between expressions (`<a>{x} {y}</a>`) has no newline, so `trim_jsx_text`
///     leaves it untouched; only newline-adjacent (insignificant) whitespace moves.
///
///     **FBT subtrees are exempt.** Inside an `<fbt>`/`<fbs>` element the TS
///     compiler deliberately preserves *all* whitespace verbatim (`BuildHIR`'s
///     `fbtDepth > 0` branch), because the fbt transform — which runs afterwards —
///     has its own whitespace rules. Trimming there could alter fbt-significant
///     whitespace, so the normalizer tracks fbt nesting and skips the trim within
///     it. (This is conservative: it never *introduces* a normalization the TS
///     compiler would not have applied, so it cannot hide a real difference.)
///
/// Things this normalizer deliberately does **not** touch (they are either already
/// made consistent by routing both sides through the same oxc codegen, or are
/// genuinely semantic and must be preserved): redundant parentheses, quote style,
/// numeric-literal form, string escapes, semicolon/ASI, `var`/`let`, function
/// decl-vs-expression, template-literal interior text (a runtime string value),
/// and single-statement block unwrapping (no fixture differs only by it).
struct Normalizer<'a> {
    allocator: &'a Allocator,
    /// Builder used to synthesize replacement JSX nodes (e.g. turning a
    /// whitespace-only `{" "}` expression container into a plain JSX-text child).
    builder: AstBuilder<'a>,
    /// Nesting depth inside `<fbt>`/`<fbs>` elements; JSX-text trimming is skipped
    /// while `> 0` to match `BuildHIR`'s fbt whitespace preservation.
    fbt_depth: usize,
}

/// Whether `child` is the `{" "}` JSX-space form: an expression container holding
/// a string literal that is exactly a single space.
///
/// React renders `<a>{" "}b</a>` and `<a> b</a>` identically (one space then `b`):
/// a single-space string-literal child and a JSX-text child carrying `" "` are the
/// same runtime children. babel-generator emits the compiler's `{" "}` verbatim,
/// while the prettier-formatted `.expect.md` rewrites it to literal JSX whitespace
/// — so to compare the two oracle forms (and the Rust emission, which matches
/// babel-generator) we canonicalize the container form into a JSX-text `" "` child
/// before the JSX-text trim runs. (A bare `" "` text between two non-text children
/// is on one line, so the trim keeps it.)
///
/// This is exactly the substitution prettier performs and is strictly
/// semantic-preserving: it is restricted to a single literal space, so it never
/// touches `{"\n"}`/`{"  "}` (which render verbatim and prettier likewise leaves as
/// containers) and never collapses a difference the compiler could have produced.
fn is_jsx_space_container(child: &JSXChild<'_>) -> bool {
    let JSXChild::ExpressionContainer(container) = child else {
        return false;
    };
    let JSXExpression::StringLiteral(lit) = &container.expression else {
        return false;
    };
    lit.value.as_str() == " "
}

/// Whether a JSX element's tag is `fbt` or `fbs` (the fbt macro elements whose
/// whitespace the compiler preserves verbatim).
fn is_fbt_element(element: &JSXElement<'_>) -> bool {
    match &element.opening_element.name {
        JSXElementName::Identifier(id) => id.name == "fbt" || id.name == "fbs",
        JSXElementName::IdentifierReference(id) => id.name == "fbt" || id.name == "fbs",
        _ => false,
    }
}

impl<'a> VisitMut<'a> for Normalizer<'a> {
    fn visit_statements(&mut self, stmts: &mut OxcVec<'a, Statement<'a>>) {
        stmts.retain(|s| !matches!(s, Statement::EmptyStatement(_)));
        // Recurse into the (now-filtered) statements.
        for stmt in stmts.iter_mut() {
            self.visit_statement(stmt);
        }
    }

    fn visit_jsx_element(&mut self, element: &mut JSXElement<'a>) {
        let is_fbt = is_fbt_element(element);
        if is_fbt {
            self.fbt_depth += 1;
        }
        self.visit_jsx_opening_element(&mut element.opening_element);
        self.visit_jsx_children(&mut element.children);
        if let Some(closing) = &mut element.closing_element {
            self.visit_jsx_closing_element(closing);
        }
        if is_fbt {
            self.fbt_depth -= 1;
        }
    }

    fn visit_jsx_fragment(&mut self, fragment: &mut JSXFragment<'a>) {
        // Fragments (`<>…</>`) are never fbt elements, so just recurse.
        self.visit_jsx_children(&mut fragment.children);
    }

    fn visit_jsx_children(&mut self, children: &mut OxcVec<'a, JSXChild<'a>>) {
        // Outside fbt, apply the JSX-spec whitespace trim to every text child:
        // drop children that trim to nothing, and replace the value of the rest
        // with the trimmed (runtime) text. Inside fbt, leave text verbatim.
        if self.fbt_depth == 0 {
            // First rewrite the `{" "}` JSX-space form into a literal-space text
            // child, matching prettier's substitution, so it canonicalizes the
            // same whether babel-generator (`{" "}`) or prettier (` `) produced it.
            for child in children.iter_mut() {
                if is_jsx_space_container(child) {
                    *child = self.builder.jsx_child_text(
                        child.span(),
                        Str::from_in(" ", self.allocator),
                        None,
                    );
                }
            }
            children.retain_mut(|c| match c {
                JSXChild::Text(text) => match trim_jsx_text(text.value.as_str()) {
                    Some(trimmed) => {
                        if trimmed != text.value.as_str() {
                            text.value = Str::from_in(trimmed.as_str(), self.allocator);
                            // `raw` is only used by the printer to reproduce the
                            // original source verbatim; clear it so the printer
                            // emits the normalized `value`.
                            text.raw = None;
                        }
                        true
                    }
                    None => false,
                },
                _ => true,
            });
        }
        for child in children.iter_mut() {
            self.visit_jsx_child(child);
        }
    }
}

/// Stage 7 entry point: compile `code` and return the emitted JS.
///
/// Runs the full pipeline (lower → all HIR passes → `BuildReactiveFunction` →
/// reactive passes → `CodegenReactiveFunction`) and emits the compiled source.
///
/// The emitter regenerates each top-level function-like from its post-
/// `PruneHoistedContexts` [`ReactiveFunction`](crate::reactive_scopes::ReactiveFunction),
/// splices it over the original node, and prepends the
/// `react/compiler-runtime` import when any cache slots are used. The result is
/// normalized by the harness through [`canonicalize`] — the same parser+printer
/// the oracle `result.code` passes through — so the comparison is
/// formatting-independent.
pub fn codegen(code: &str, filename: &str) -> String {
    codegen_reactive_function::codegen(code, filename)
}

/// The Program/Entrypoint whole-module compiler. See
/// [`codegen_reactive_function::compile_module`] — the Rust analog of
/// `Entrypoint/Program.ts::compileProgram` (function discovery, module-scope +
/// per-function opt-out directives, skip-already-compiled files, verbatim
/// non-component code, conditional+deduped runtime import).
pub fn compile_module(code: &str, filename: &str) -> String {
    codegen_reactive_function::compile_module(code, filename)
}
