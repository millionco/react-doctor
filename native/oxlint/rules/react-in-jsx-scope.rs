use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_str::static_ident;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This JSX crashes because `React` isn't in scope.";

#[derive(Debug, Default, Clone)]
pub struct ReactInJsxScope;

declare_oxc_lint!(
    /// Require a visible React binding for the classic JSX runtime.
    ReactInJsxScope,
    react_doctor_native,
    suspicious,
    version = "0.1.0",
    short_description = "Require a visible React binding for the classic JSX runtime.",
);

impl Rule for ReactInJsxScope {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let span = match node.kind() {
            AstKind::JSXOpeningElement(opening_element) => opening_element.name.span(),
            AstKind::JSXFragment(fragment) => fragment.opening_fragment.span,
            _ => return,
        };
        if ctx
            .scoping()
            .find_binding(node.scope_id(), static_ident!("React"))
            .is_none()
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }
}
