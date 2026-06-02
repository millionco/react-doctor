//! napi bindings for `react-compiler-oxc`'s lint surface. Exposes [`lint`] to JS:
//! it runs the React Compiler's validations over a source file and returns the
//! structured diagnostics (bucketed by `ErrorCategory`) that the
//! `oxlint-plugin-react-doctor` React-Compiler rules report — the native
//! replacement for `eslint-plugin-react-hooks` / `babel-plugin-react-compiler`.

use napi_derive::napi;
use react_compiler_oxc::{BabelSourceLocation, Diagnostic, rule_for_category};

/// A babel-style source position (1-based line, 0-based UTF-16 column).
#[napi(object)]
pub struct LintPosition {
    pub line: u32,
    pub column: u32,
}

/// A babel-style `[start, end)` source range.
#[napi(object)]
pub struct LintLocation {
    pub start: LintPosition,
    pub end: LintPosition,
}

/// One `kind: 'error'` detail (location + code-frame message) of a [`LintEvent`].
#[napi(object)]
pub struct LintDetail {
    pub loc: Option<LintLocation>,
    pub message: Option<String>,
}

/// One lint diagnostic. `category` is the stable `ErrorCategory` tag (e.g.
/// `"RenderSetState"`) the JS plugin filters on; `ruleName` is the rule the
/// diagnostic surfaces under (e.g. `"set-state-in-render"`); `severity` is the
/// ESLint string level (`"error"` / `"warn"` / `"off"`).
#[napi(object)]
pub struct LintEvent {
    pub category: String,
    pub rule_name: String,
    pub severity: String,
    pub reason: String,
    pub description: Option<String>,
    pub details: Vec<LintDetail>,
}

fn to_lint_location(loc: BabelSourceLocation) -> LintLocation {
    LintLocation {
        start: LintPosition {
            line: loc.start.line,
            column: loc.start.column,
        },
        end: LintPosition {
            line: loc.end.line,
            column: loc.end.column,
        },
    }
}

fn to_lint_event(diagnostic: Diagnostic) -> LintEvent {
    let rule_name = rule_for_category(diagnostic.category).name.to_string();
    let details = diagnostic
        .details
        .into_iter()
        .map(|detail| LintDetail {
            loc: detail.loc.map(to_lint_location),
            message: detail.message,
        })
        .collect();
    LintEvent {
        category: diagnostic.category.as_str().to_string(),
        rule_name,
        severity: diagnostic.severity.to_eslint().to_string(),
        reason: diagnostic.reason,
        description: diagnostic.description,
        details,
    }
}

/// Run the React Compiler lint validations over `source` and return the
/// diagnostics. `filename` drives source-type inference only.
#[napi]
pub fn lint(source: String, filename: String) -> Vec<LintEvent> {
    react_compiler_oxc::lint(&source, &filename)
        .into_iter()
        .map(to_lint_event)
        .collect()
}

/// The crate version, for cache-keying / diagnostics.
#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
