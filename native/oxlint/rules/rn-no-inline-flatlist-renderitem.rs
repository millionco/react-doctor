use oxc_ast::{
    ast::{Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const LIST_COMPONENT_NAMES: [&str; 9] = [
    "FlatList",
    "SectionList",
    "VirtualizedList",
    "FlashList",
    "AnimatedFlashList",
    "LegendList",
    "AnimatedLegendList",
    "KeyboardAwareLegendList",
    "KeyboardAvoidingLegendList",
];

#[derive(Debug, Default, Clone)]
pub struct RnNoInlineFlatlistRenderitem;

declare_oxc_lint!(
    /// Disallow inline renderItem functions on React Native lists.
    RnNoInlineFlatlistRenderitem,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow inline React Native list renderItem functions.",
);

impl Rule for RnNoInlineFlatlistRenderitem {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(list_component_name) = resolve_jsx_element_name(opening_element) else {
            return;
        };
        if !LIST_COMPONENT_NAMES.contains(&list_component_name) {
            return;
        }
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if attribute_name.name != "renderItem" {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            if !matches!(
                expression,
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users see extra row work when renderItem on <{list_component_name}> is rebuilt every time the screen redraws."
                ))
                .with_label(expression.span()),
            );
        }
    }
}
