use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SYNTAX_MESSAGE: &str = "`<React.Fragment>` is used where shorthand fragments are configured, so similar wrappers look different across the codebase.";
const ELEMENT_MESSAGE: &str = "Fragment shorthand is used where explicit fragments are configured, so similar wrappers look different across the codebase.";

#[derive(Debug, Default, Clone)]
pub struct JsxFragments;

declare_oxc_lint!(
    /// Enforce the configured React fragment form.
    JsxFragments,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Enforce the configured React fragment form.",
);

impl Rule for JsxFragments {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXElement(element) if fragment_mode(ctx) == "syntax" => {
                if element.closing_element.is_none()
                    || !element.opening_element.attributes.is_empty()
                    || !is_scoped_react_fragment_element(
                        &element.opening_element.name,
                        ctx,
                    )
                {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(SYNTAX_MESSAGE).with_label(element.opening_element.span),
                );
            }
            AstKind::JSXFragment(fragment) if fragment_mode(ctx) == "element" => {
                ctx.diagnostic(
                    OxcDiagnostic::warn(ELEMENT_MESSAGE)
                        .with_label(fragment.opening_fragment.span()),
                );
            }
            _ => {}
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }
}

fn fragment_mode<'a>(ctx: &'a LintContext<'_>) -> &'a str {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("jsxFragments"))
        .and_then(|settings| settings.get("mode"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("syntax")
}
