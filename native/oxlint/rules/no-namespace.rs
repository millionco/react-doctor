use oxc_ast::{
    AstKind,
    ast::{Argument, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule, utils::is_create_element_call};

#[derive(Debug, Default, Clone)]
pub struct NoNamespace;

declare_oxc_lint!(
    /// Disallow namespaced React element names.
    NoNamespace,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow namespaced React element names.",
);

impl Rule for NoNamespace {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let (component_name, span) = match node.kind() {
            AstKind::JSXOpeningElement(opening_element) => {
                let JSXElementName::NamespacedName(namespaced_name) = &opening_element.name else {
                    return;
                };
                (
                    format!(
                        "{}:{}",
                        namespaced_name.namespace.name, namespaced_name.name.name
                    ),
                    namespaced_name.span,
                )
            }
            AstKind::CallExpression(call_expression) if is_create_element_call(call_expression) => {
                let Some(Argument::StringLiteral(component_name)) =
                    call_expression.arguments.first()
                else {
                    return;
                };
                if !component_name.value.contains(':') {
                    return;
                }
                (component_name.value.to_string(), component_name.span())
            }
            _ => return,
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "React can't render namespaced names like `{component_name}`."
            ))
            .with_label(span),
        );
    }
}
