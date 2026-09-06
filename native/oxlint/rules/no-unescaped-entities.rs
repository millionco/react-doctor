use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NoUnescapedEntities;

declare_oxc_lint!(
    /// Disallow unescaped entities in JSX text.
    NoUnescapedEntities,
    react_doctor_native,
    pedantic,
    version = "0.1.0",
    short_description = "Disallow unescaped entities in JSX text.",
);

impl Rule for NoUnescapedEntities {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXText(jsx_text) = node.kind() else {
            return;
        };
        let source = jsx_text
            .raw
            .map_or(jsx_text.value.as_str(), |raw| raw.as_str());
        let Some(character) = source
            .chars()
            .find(|character| matches!(character, '\'' | '"' | '>' | '}'))
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "`{character}` in JSX text can read as markup & confuse readers."
            ))
            .with_label(jsx_text.span),
        );
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }
}
