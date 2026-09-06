use oxc_ast::{
    AstKind,
    ast::{ArrayExpressionElement, Expression, JSXAttributeName, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const RENDER_ITEM_PROP_NAMES: [&str; 3] =
    ["renderItem", "renderSectionHeader", "renderSectionFooter"];

#[derive(Debug, Default, Clone)]
pub struct RnNoInlineObjectInListItem;

declare_oxc_lint!(
    /// Disallow fresh object and array props inside list render functions.
    RnNoInlineObjectInListItem,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow fresh object and array props inside list render functions.",
);

impl Rule for RnNoInlineObjectInListItem {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_test_noise_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let Some(expression) = container.expression.as_expression() else {
            return;
        };
        let (literal_kind, is_inline_array) = match expression {
            Expression::ObjectExpression(_) => ("object", false),
            Expression::ArrayExpression(_) => ("array", true),
            _ => return,
        };
        if has_capability(ctx, "react-compiler")
            || !ctx
                .nodes()
                .ancestors(node.id())
                .any(|ancestor| rn_inline_object_is_render_function(ancestor, ctx))
        {
            return;
        }
        let is_style_attribute = matches!(
            &attribute.name,
            JSXAttributeName::Identifier(attribute_name)
                if attribute_name.name == "style" || attribute_name.name.ends_with("Style")
        );
        if is_inline_array
            && is_style_attribute
            && !rn_inline_object_contains_fresh_object_literal(expression)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This {literal_kind} is rebuilt for every row, so your memo() rows still redraw."
            ))
            .with_label(attribute.span),
        );
    }
}

fn rn_inline_object_is_render_function(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    if !matches!(
        node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    ) {
        return false;
    }
    let container_node = ctx.nodes().parent_node(node.id());
    if !matches!(container_node.kind(), AstKind::JSXExpressionContainer(_)) {
        return false;
    }
    let attribute_node = ctx.nodes().parent_node(container_node.id());
    let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
        return false;
    };
    matches!(
        &attribute.name,
        JSXAttributeName::Identifier(attribute_name)
            if RENDER_ITEM_PROP_NAMES.contains(&attribute_name.name.as_str())
    )
}

fn rn_inline_object_contains_fresh_object_literal(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::ObjectExpression(_) => true,
        Expression::ArrayExpression(array_expression) => {
            array_expression
                .elements
                .iter()
                .any(|element| match element {
                    ArrayExpressionElement::SpreadElement(spread_element) => {
                        rn_inline_object_contains_fresh_object_literal(&spread_element.argument)
                    }
                    ArrayExpressionElement::Elision(_) => false,
                    element => element
                        .as_expression()
                        .is_some_and(rn_inline_object_contains_fresh_object_literal),
                })
        }
        Expression::LogicalExpression(logical_expression) => {
            rn_inline_object_contains_fresh_object_literal(&logical_expression.left)
                || rn_inline_object_contains_fresh_object_literal(&logical_expression.right)
        }
        Expression::ConditionalExpression(conditional_expression) => {
            rn_inline_object_contains_fresh_object_literal(&conditional_expression.consequent)
                || rn_inline_object_contains_fresh_object_literal(&conditional_expression.alternate)
        }
        _ => false,
    }
}
