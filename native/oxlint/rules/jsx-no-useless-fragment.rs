use oxc_ast::{AstKind, ast::JSXChild};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const NEEDS_MORE_CHILDREN: &str = "This fragment wraps a single child & does nothing.";
const CHILD_OF_HTML_ELEMENT: &str =
    "This fragment does nothing inside an HTML tag that can hold the children directly.";

#[derive(Debug, Default, Clone)]
pub struct JsxNoUselessFragment;

declare_oxc_lint!(
    /// Disallow unnecessary React fragments.
    JsxNoUselessFragment,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unnecessary React fragments.",
);

impl Rule for JsxNoUselessFragment {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXElement(element) => {
                if !is_scoped_react_fragment_element(&element.opening_element.name, ctx)
                    || find_jsx_attribute(&element.opening_element, "key").is_some()
                {
                    return;
                }
                if jsx_fragment_children_report(
                    node,
                    element.opening_element.span,
                    &element.children,
                    ctx,
                ) {
                    return;
                }
                if jsx_fragment_is_child_of_html(node, ctx) {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(CHILD_OF_HTML_ELEMENT)
                            .with_label(element.opening_element.span),
                    );
                }
            }
            AstKind::JSXFragment(fragment) => {
                if jsx_fragment_children_report(
                    node,
                    fragment.opening_fragment.span(),
                    &fragment.children,
                    ctx,
                ) {
                    return;
                }
                if jsx_fragment_is_child_of_html(node, ctx) {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(CHILD_OF_HTML_ELEMENT)
                            .with_label(fragment.opening_fragment.span()),
                    );
                }
            }
            _ => {}
        }
    }
}

fn jsx_fragment_children_report(
    fragment_node: &AstNode<'_>,
    span: oxc_span::Span,
    children: &[JSXChild<'_>],
    ctx: &LintContext<'_>,
) -> bool {
    let meaningful: Vec<_> = children
        .iter()
        .filter(|child| {
            !matches!(child, JSXChild::Text(text) if text.value.trim().is_empty() && text.value.contains('\n'))
        })
        .collect();
    if meaningful.len() >= 2
        || (jsx_no_useless_fragment_allow_expressions(ctx)
            && meaningful
                .first()
                .is_some_and(|child| matches!(child, JSXChild::ExpressionContainer(_)))
            && meaningful.len() == 1)
        || meaningful.iter().any(|child| {
            matches!(child, JSXChild::ExpressionContainer(container)
                if matches!(container.expression, oxc_ast::ast::JSXExpression::CallExpression(_)))
        })
        || (meaningful
            .first()
            .is_some_and(|child| matches!(child, JSXChild::Text(_)))
            && meaningful.len() == 1
            && !matches!(
                ctx.nodes().parent_node(fragment_node.id()).kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            ))
    {
        return false;
    }
    ctx.diagnostic(OxcDiagnostic::warn(NEEDS_MORE_CHILDREN).with_label(span));
    true
}

fn jsx_fragment_is_child_of_html(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::JSXElement(parent_element) = parent.kind() else {
        return false;
    };
    matches!(&parent_element.opening_element.name,
        oxc_ast::ast::JSXElementName::Identifier(identifier)
            if identifier.name.as_bytes().first().is_some_and(u8::is_ascii_lowercase))
}

fn jsx_no_useless_fragment_allow_expressions(ctx: &LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("jsxNoUselessFragment"))
        .and_then(|settings| settings.get("allowExpressions"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}
