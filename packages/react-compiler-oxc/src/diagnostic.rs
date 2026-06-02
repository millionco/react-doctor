//! Structured lint diagnostics — the Rust port of the parts of
//! `react-compiler/src/CompilerError.ts` that the lint surface needs:
//! [`ErrorCategory`], [`ErrorSeverity`], [`LintRulePreset`], the per-category
//! [`LintRule`] table ([`rule_for_category`] / [`lint_rules`]), and the
//! [`Diagnostic`] value the napi `lint` entry returns.
//!
//! The codegen pipeline historically reduced each validation pass to a single
//! "did any violation occur" boolean (see `passes::validate_hooks_usage`) because
//! that is all the recoverable-bailout decision needs. The lint surface instead
//! needs one located, categorized, message-formatted [`Diagnostic`] per
//! violation, bucketed by [`ErrorCategory`] into the rules
//! `eslint-plugin-react-hooks` exposes. This module is the shared vocabulary for
//! that surface; passes push [`Diagnostic`]s into [`Diagnostics`].

/// `ErrorSeverity` (`CompilerError.ts`): the lint level a category maps to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ErrorSeverity {
    /// Maps to ESLint `error`.
    Error,
    /// Maps to ESLint `warn`.
    Warning,
    /// Maps to ESLint `off` (surfaced only when explicitly enabled).
    Hint,
    /// Maps to ESLint `off`.
    Off,
}

impl ErrorSeverity {
    /// The ESLint string severity (`mapErrorSeverityToESlint`).
    pub fn to_eslint(self) -> &'static str {
        match self {
            ErrorSeverity::Error => "error",
            ErrorSeverity::Warning => "warn",
            ErrorSeverity::Hint | ErrorSeverity::Off => "off",
        }
    }
}

/// `LintRulePreset` (`CompilerError.ts`): which shipped preset a rule belongs to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LintRulePreset {
    /// Stable, included in the `recommended` preset.
    Recommended,
    /// Experimental, only in `recommended-latest`.
    RecommendedLatest,
    /// Disabled by default.
    Off,
}

impl LintRulePreset {
    pub fn as_str(self) -> &'static str {
        match self {
            LintRulePreset::Recommended => "recommended",
            LintRulePreset::RecommendedLatest => "recommended-latest",
            LintRulePreset::Off => "off",
        }
    }
}

/// `ErrorCategory` (`CompilerError.ts`): the analysis bucket a diagnostic belongs
/// to. The rule a diagnostic surfaces under is derived from its category via
/// [`rule_for_category`]; the variant set is kept byte-identical to the TS enum so
/// the JS plugin can filter by category without a translation table.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ErrorCategory {
    Hooks,
    CapitalizedCalls,
    StaticComponents,
    UseMemo,
    VoidUseMemo,
    PreserveManualMemo,
    MemoDependencies,
    IncompatibleLibrary,
    Immutability,
    Globals,
    Refs,
    EffectDependencies,
    EffectExhaustiveDependencies,
    EffectSetState,
    EffectDerivationsOfState,
    ErrorBoundaries,
    Purity,
    RenderSetState,
    Invariant,
    Todo,
    Syntax,
    UnsupportedSyntax,
    Config,
    Gating,
    Suppression,
    Fbt,
}

impl ErrorCategory {
    /// The TS enum member name (e.g. `"RenderSetState"`), used as the stable wire
    /// tag the JS plugin filters on.
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCategory::Hooks => "Hooks",
            ErrorCategory::CapitalizedCalls => "CapitalizedCalls",
            ErrorCategory::StaticComponents => "StaticComponents",
            ErrorCategory::UseMemo => "UseMemo",
            ErrorCategory::VoidUseMemo => "VoidUseMemo",
            ErrorCategory::PreserveManualMemo => "PreserveManualMemo",
            ErrorCategory::MemoDependencies => "MemoDependencies",
            ErrorCategory::IncompatibleLibrary => "IncompatibleLibrary",
            ErrorCategory::Immutability => "Immutability",
            ErrorCategory::Globals => "Globals",
            ErrorCategory::Refs => "Refs",
            ErrorCategory::EffectDependencies => "EffectDependencies",
            ErrorCategory::EffectExhaustiveDependencies => "EffectExhaustiveDependencies",
            ErrorCategory::EffectSetState => "EffectSetState",
            ErrorCategory::EffectDerivationsOfState => "EffectDerivationsOfState",
            ErrorCategory::ErrorBoundaries => "ErrorBoundaries",
            ErrorCategory::Purity => "Purity",
            ErrorCategory::RenderSetState => "RenderSetState",
            ErrorCategory::Invariant => "Invariant",
            ErrorCategory::Todo => "Todo",
            ErrorCategory::Syntax => "Syntax",
            ErrorCategory::UnsupportedSyntax => "UnsupportedSyntax",
            ErrorCategory::Config => "Config",
            ErrorCategory::Gating => "Gating",
            ErrorCategory::Suppression => "Suppression",
            ErrorCategory::Fbt => "FBT",
        }
    }
}

/// `LintRule` (`CompilerError.ts`): the public rule a category surfaces under.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct LintRule {
    pub category: ErrorCategory,
    pub severity: ErrorSeverity,
    /// The rule name developers enable/disable (e.g. `"set-state-in-render"`).
    pub name: &'static str,
    pub preset: LintRulePreset,
}

/// `getRuleForCategory` (`CompilerError.ts`): the rule metadata for a category.
pub fn rule_for_category(category: ErrorCategory) -> LintRule {
    use ErrorCategory as Cat;
    use ErrorSeverity as Sev;
    use LintRulePreset as Pre;
    let (severity, name, preset) = match category {
        Cat::CapitalizedCalls => (Sev::Error, "capitalized-calls", Pre::Off),
        Cat::Config => (Sev::Error, "config", Pre::Recommended),
        Cat::EffectDependencies => (Sev::Error, "memoized-effect-dependencies", Pre::Off),
        Cat::EffectExhaustiveDependencies => {
            (Sev::Error, "exhaustive-effect-dependencies", Pre::Off)
        }
        Cat::EffectDerivationsOfState => (Sev::Error, "no-deriving-state-in-effects", Pre::Off),
        Cat::EffectSetState => (Sev::Error, "set-state-in-effect", Pre::Recommended),
        Cat::ErrorBoundaries => (Sev::Error, "error-boundaries", Pre::Recommended),
        Cat::Fbt => (Sev::Error, "fbt", Pre::Off),
        Cat::Gating => (Sev::Error, "gating", Pre::Recommended),
        Cat::Globals => (Sev::Error, "globals", Pre::Recommended),
        Cat::Hooks => (Sev::Error, "hooks", Pre::Off),
        Cat::Immutability => (Sev::Error, "immutability", Pre::Recommended),
        Cat::Invariant => (Sev::Error, "invariant", Pre::Off),
        Cat::PreserveManualMemo => (Sev::Error, "preserve-manual-memoization", Pre::Recommended),
        Cat::Purity => (Sev::Error, "purity", Pre::Recommended),
        Cat::Refs => (Sev::Error, "refs", Pre::Recommended),
        Cat::RenderSetState => (Sev::Error, "set-state-in-render", Pre::Recommended),
        Cat::StaticComponents => (Sev::Error, "static-components", Pre::Recommended),
        Cat::Suppression => (Sev::Error, "rule-suppression", Pre::Off),
        Cat::Syntax => (Sev::Error, "syntax", Pre::Off),
        Cat::Todo => (Sev::Hint, "todo", Pre::Off),
        Cat::UnsupportedSyntax => (Sev::Warning, "unsupported-syntax", Pre::Recommended),
        Cat::UseMemo => (Sev::Error, "use-memo", Pre::Recommended),
        Cat::VoidUseMemo => (Sev::Error, "void-use-memo", Pre::RecommendedLatest),
        Cat::MemoDependencies => (Sev::Error, "memo-dependencies", Pre::Off),
        Cat::IncompatibleLibrary => (Sev::Warning, "incompatible-library", Pre::Recommended),
    };
    LintRule {
        category,
        severity,
        name,
        preset,
    }
}

/// `LintRules` (`CompilerError.ts`): every rule, in `ErrorCategory` declaration
/// order (the order the JS `index.ts` iterates to build its rule map).
pub fn lint_rules() -> [LintRule; 26] {
    [
        ErrorCategory::Hooks,
        ErrorCategory::CapitalizedCalls,
        ErrorCategory::StaticComponents,
        ErrorCategory::UseMemo,
        ErrorCategory::VoidUseMemo,
        ErrorCategory::PreserveManualMemo,
        ErrorCategory::MemoDependencies,
        ErrorCategory::IncompatibleLibrary,
        ErrorCategory::Immutability,
        ErrorCategory::Globals,
        ErrorCategory::Refs,
        ErrorCategory::EffectDependencies,
        ErrorCategory::EffectExhaustiveDependencies,
        ErrorCategory::EffectSetState,
        ErrorCategory::EffectDerivationsOfState,
        ErrorCategory::ErrorBoundaries,
        ErrorCategory::Purity,
        ErrorCategory::RenderSetState,
        ErrorCategory::Invariant,
        ErrorCategory::Todo,
        ErrorCategory::Syntax,
        ErrorCategory::UnsupportedSyntax,
        ErrorCategory::Config,
        ErrorCategory::Gating,
        ErrorCategory::Suppression,
        ErrorCategory::Fbt,
    ]
    .map(rule_for_category)
}

/// A babel-style source position: 1-based line, 0-based UTF-16-code-unit column —
/// the exact shape ESLint expects in `context.report({ loc })`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BabelPosition {
    pub line: u32,
    pub column: u32,
}

/// A babel-style source range (`SourceLocation`): `[start, end)` positions.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BabelSourceLocation {
    pub start: BabelPosition,
    pub end: BabelPosition,
}

/// One `kind: 'error'` detail of a [`Diagnostic`] (`CompilerDiagnosticDetail`):
/// a source location plus an optional message rendered into the code frame. The
/// first detail's `loc` is the diagnostic's `primaryLocation()`.
#[derive(Clone, Debug)]
pub struct DiagnosticDetail {
    pub loc: Option<BabelSourceLocation>,
    pub message: Option<String>,
}

/// One lint diagnostic, bucketed by [`ErrorCategory`] — the Rust mirror of the TS
/// `CompilerDiagnostic`. The JS plugin formats the final eslint message
/// (`printErrorMessage`) from these structured fields, so the message and code
/// frame match `eslint-plugin-react-hooks` byte-for-byte.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub category: ErrorCategory,
    pub severity: ErrorSeverity,
    pub reason: String,
    pub description: Option<String>,
    pub details: Vec<DiagnosticDetail>,
}

impl Diagnostic {
    /// `CompilerDiagnostic.create(...)`: a diagnostic with no details yet. The
    /// severity is derived from the category, exactly as the TS getter does.
    pub fn create(category: ErrorCategory, reason: impl Into<String>) -> Self {
        Self {
            category,
            severity: rule_for_category(category).severity,
            reason: reason.into(),
            description: None,
            details: Vec::new(),
        }
    }

    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// `withDetails({ kind: 'error', loc, message })`.
    pub fn with_error_detail(
        mut self,
        loc: Option<BabelSourceLocation>,
        message: Option<String>,
    ) -> Self {
        self.details.push(DiagnosticDetail { loc, message });
        self
    }

    /// `primaryLocation()`: the first error detail's location.
    pub fn primary_location(&self) -> Option<BabelSourceLocation> {
        self.details.first().and_then(|detail| detail.loc)
    }
}

/// A collector passes push diagnostics into during a lint run.
#[derive(Default, Debug)]
pub struct Diagnostics {
    items: Vec<Diagnostic>,
}

impl Diagnostics {
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

    pub fn push(&mut self, diagnostic: Diagnostic) {
        self.items.push(diagnostic);
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn into_vec(self) -> Vec<Diagnostic> {
        self.items
    }

    pub fn iter(&self) -> std::slice::Iter<'_, Diagnostic> {
        self.items.iter()
    }
}

/// Resolves byte offsets in `source` to babel-style line/column positions
/// (1-based line, 0-based UTF-16 column). Built once per file and reused for every
/// diagnostic, since each lookup is O(log lines) + O(column-bytes).
pub struct PositionResolver<'s> {
    source: &'s str,
    line_starts: Vec<u32>,
}

impl<'s> PositionResolver<'s> {
    pub fn new(source: &'s str) -> Self {
        let mut line_starts = vec![0u32];
        for (index, byte) in source.bytes().enumerate() {
            if byte == b'\n' {
                line_starts.push((index + 1) as u32);
            }
        }
        Self {
            source,
            line_starts,
        }
    }

    /// The babel position of a byte `offset`.
    pub fn position(&self, offset: u32) -> BabelPosition {
        let line_index = self.line_starts.partition_point(|&start| start <= offset) - 1;
        let line_start = self.line_starts[line_index];
        // Column is the count of UTF-16 code units between the line start and the
        // offset — babel/ESLint columns are 0-based UTF-16, not byte, counts.
        let segment_start = line_start as usize;
        let segment_end = (offset as usize).min(self.source.len());
        let column = self.source[segment_start..segment_end]
            .chars()
            .map(char::len_utf16)
            .sum::<usize>() as u32;
        BabelPosition {
            line: (line_index + 1) as u32,
            column,
        }
    }

    /// The babel `[start, end)` location for a byte span.
    pub fn location(&self, start: u32, end: u32) -> BabelSourceLocation {
        BabelSourceLocation {
            start: self.position(start),
            end: self.position(end),
        }
    }

    /// Resolve an HIR [`SourceLocation`](crate::hir::place::SourceLocation) to a
    /// babel location: byte spans are resolved against the source, an
    /// already-resolved span passes through, and the generated sentinel yields
    /// `None` (a whole-program diagnostic with no primary location).
    pub fn resolve(&self, loc: &crate::hir::place::SourceLocation) -> Option<BabelSourceLocation> {
        use crate::hir::place::SourceLocation;
        match loc {
            SourceLocation::Generated => None,
            SourceLocation::Span { start, end, .. } => Some(self.location(*start, *end)),
            SourceLocation::Resolved {
                start_line,
                start_column,
                end_line,
                end_column,
            } => Some(BabelSourceLocation {
                start: BabelPosition {
                    line: *start_line,
                    column: *start_column,
                },
                end: BabelPosition {
                    line: *end_line,
                    column: *end_column,
                },
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_table_matches_compiler_error() {
        assert_eq!(rule_for_category(ErrorCategory::RenderSetState).name, "set-state-in-render");
        assert_eq!(rule_for_category(ErrorCategory::EffectSetState).name, "set-state-in-effect");
        assert_eq!(rule_for_category(ErrorCategory::VoidUseMemo).preset, LintRulePreset::RecommendedLatest);
        assert_eq!(rule_for_category(ErrorCategory::Todo).severity, ErrorSeverity::Hint);
        assert_eq!(
            rule_for_category(ErrorCategory::UnsupportedSyntax).severity,
            ErrorSeverity::Warning
        );
        assert_eq!(lint_rules().len(), 26);
    }

    #[test]
    fn position_resolver_handles_utf16_columns() {
        let source = "const a = 1;\nconst b = 2;\n";
        let resolver = PositionResolver::new(source);
        // Offset 0 -> line 1, col 0.
        assert_eq!(resolver.position(0), BabelPosition { line: 1, column: 0 });
        // First char of line 2 (after the 13-byte first line incl. newline).
        assert_eq!(resolver.position(13), BabelPosition { line: 2, column: 0 });
    }

    #[test]
    fn position_resolver_counts_astral_as_two_utf16_units() {
        // "😀" is one char but two UTF-16 code units; the column after it is 2.
        let source = "😀x";
        let resolver = PositionResolver::new(source);
        let offset_of_x = "😀".len() as u32;
        assert_eq!(resolver.position(offset_of_x), BabelPosition { line: 1, column: 2 });
    }
}
