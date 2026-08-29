use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeName, JSXAttributeValue, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
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
const RENDER_PROP_NAMES: [&str; 3] = ["renderItem", "renderSectionHeader", "renderSectionFooter"];

#[derive(Debug, Default, Clone)]
pub struct RnNoRenderitemKey;

declare_oxc_lint!(
    /// Disallow ignored keys on JSX returned by native-list render props.
    RnNoRenderitemKey,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "renderItem key is ignored by React Native lists.",
);

impl Rule for RnNoRenderitemKey {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_native_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            return;
        };
        let render_prop_name = attribute_name.name.as_str();
        if !RENDER_PROP_NAMES.contains(&render_prop_name) {
            return;
        }
        let opening_node = ctx.nodes().parent_node(node.id());
        let AstKind::JSXOpeningElement(opening) = opening_node.kind() else {
            return;
        };
        let list_name = match &opening.name {
            JSXElementName::Identifier(identifier) => identifier.name.as_str(),
            JSXElementName::IdentifierReference(identifier) => identifier.name.as_str(),
            JSXElementName::MemberExpression(member) => member.property.name.as_str(),
            _ => return,
        };
        if !LIST_COMPONENT_NAMES.contains(&list_name) {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let Some(render_function) = container.expression.as_expression() else {
            return;
        };
        let mut return_expressions = Vec::new();
        let function_span = match render_function {
            Expression::ArrowFunctionExpression(function) => {
                if let Some(expression) = function.get_expression() {
                    return_expressions.push(expression);
                }
                function.span
            }
            Expression::FunctionExpression(function) => function.span,
            _ => return,
        };
        let function_node = ctx.nodes().iter().find(|candidate| {
            candidate.span() == function_span
                && matches!(
                    candidate.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
        });
        if let Some(function_node) = function_node {
            for candidate in ctx.nodes().iter() {
                let AstKind::ReturnStatement(statement) = candidate.kind() else {
                    continue;
                };
                if !function_span.contains_inclusive(candidate.span())
                    || crate::ast_util::get_enclosing_function(candidate, ctx)
                        .is_none_or(|owner| owner.id() != function_node.id())
                {
                    continue;
                }
                if let Some(argument) = &statement.argument {
                    return_expressions.push(argument);
                }
            }
        }
        for expression in return_expressions {
            rn_renderitem_visit_returned_jsx(expression, render_prop_name, ctx);
        }
    }
}

fn rn_renderitem_visit_returned_jsx(
    expression: &Expression<'_>,
    render_prop_name: &str,
    ctx: &LintContext<'_>,
) {
    match expression.get_inner_expression() {
        Expression::JSXElement(element) => {
            let has_key = element.opening_element.attributes.iter().any(|attribute| {
                matches!(attribute, oxc_ast::ast::JSXAttributeItem::Attribute(attribute)
                    if matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                        if identifier.name == "key"))
            });
            if has_key {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Your users get no benefit from `key` on the JSX from {render_prop_name}; the list ignores it."
                    ))
                    .with_label(element.opening_element.span),
                );
            }
        }
        Expression::ConditionalExpression(conditional) => {
            rn_renderitem_visit_returned_jsx(&conditional.consequent, render_prop_name, ctx);
            rn_renderitem_visit_returned_jsx(&conditional.alternate, render_prop_name, ctx);
        }
        Expression::LogicalExpression(logical) => {
            rn_renderitem_visit_returned_jsx(&logical.right, render_prop_name, ctx);
            if matches!(
                logical.operator,
                oxc_syntax::operator::LogicalOperator::Or
                    | oxc_syntax::operator::LogicalOperator::Coalesce
            ) {
                rn_renderitem_visit_returned_jsx(&logical.left, render_prop_name, ctx);
            }
        }
        _ => {}
    }
}
