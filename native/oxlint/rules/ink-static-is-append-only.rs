use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const NON_APPEND_COLLECTION_METHODS: [&str; 4] = ["reverse", "sort", "toReversed", "toSorted"];

#[derive(Debug, Default, Clone)]
pub struct InkStaticIsAppendOnly;

declare_oxc_lint!(
    /// Disallow reordered collections in Ink Static components.
    InkStaticIsAppendOnly,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow reordered collections in Ink Static components.",
);

impl Rule for InkStaticIsAppendOnly {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_imported_jsx_component_name(opening_element, "ink", ctx) != Some("Static") {
            return;
        }
        let Some(items_attribute) = find_jsx_attribute(opening_element, "items") else {
            return;
        };
        let Some(Expression::CallExpression(call_expression)) = items_attribute
            .value
            .as_ref()
            .and_then(|value| match value {
                oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => {
                    container.expression.as_expression()
                }
                _ => None,
            })
        else {
            return;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return;
        };
        let Some(method_name) = member_expression.static_property_name() else {
            return;
        };
        if !NON_APPEND_COLLECTION_METHODS.contains(&method_name)
            || is_static_literal_array(member_expression.object())
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "`<Static>` never revises prior output, but `.{method_name}()` can change existing item order."
            ))
            .with_label(items_attribute.span),
        );
    }
}

fn is_static_literal_array(expression: &Expression<'_>) -> bool {
    let Expression::ArrayExpression(array_expression) = expression else {
        return false;
    };
    array_expression
        .elements
        .iter()
        .all(|element| match element {
            oxc_ast::ast::ArrayExpressionElement::Elision(_) => true,
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(_) => false,
            element => element.as_expression().is_some_and(|expression| {
                expression.is_literal()
                    || matches!(
                        expression,
                        Expression::TemplateLiteral(template_literal)
                            if template_literal.expressions.is_empty()
                    )
            }),
        })
}
