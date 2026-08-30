use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeName, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const RN_LIST_CALLBACK_RENDER_PROP_NAMES: [&str; 3] =
    ["renderItem", "renderSectionHeader", "renderSectionFooter"];
const RN_LIST_CALLBACK_HANDLER_PROP_NAMES: [&str; 6] = [
    "onPress",
    "onLongPress",
    "onPressIn",
    "onPressOut",
    "onSelect",
    "onClick",
];

#[derive(Debug, Default, Clone)]
pub struct RnListCallbackPerRow;

declare_oxc_lint!(
    /// Warns when a React Native list render function creates a handler for every row.
    RnListCallbackPerRow,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when a React Native list render function creates a handler for every row.",
);

impl Rule for RnListCallbackPerRow {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_non_production_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            return;
        };
        if !RN_LIST_CALLBACK_HANDLER_PROP_NAMES.contains(&attribute_name.name.as_str()) {
            return;
        }
        if has_capability(ctx, "react-compiler") {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let Some(expression) = container.expression.as_expression() else {
            return;
        };
        if !matches!(
            expression,
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        ) || !ctx
            .nodes()
            .ancestors(node.id())
            .any(|ancestor| rn_list_callback_is_render_function(ancestor, ctx))
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This {} is rebuilt for every row, so your memo() rows still redraw.",
                attribute_name.name
            ))
            .with_label(attribute.span),
        );
    }
}

fn rn_list_callback_is_render_function(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
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
        JSXAttributeName::Identifier(identifier)
            if RN_LIST_CALLBACK_RENDER_PROP_NAMES.contains(&identifier.name.as_str())
    )
}
