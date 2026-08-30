use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, JSXAttributeValue, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::LogicalOperator;
use rustc_hash::FxHashSet;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EMPTY_ARRAY_FALLBACK_MESSAGE: &str = "This redraws the memo child anyway because fallback `[]` builds a brand new array each render when the left value is empty, so the child sees a different value. Hoist a constant (e.g. `const EMPTY_ITEMS: Item[] = []`) & use that as the fallback.";
const EMPTY_OBJECT_FALLBACK_MESSAGE: &str = "This redraws the memo child anyway because fallback `{}` builds a brand new object each render when the left value is empty, so the child sees a different value. Hoist a constant (e.g. `const EMPTY_CONFIG: Config = {}`) & use that as the fallback.";

#[derive(Debug, Default, Clone)]
pub struct PreferStableEmptyFallback;

declare_oxc_lint!(
    /// Warns when an empty fallback defeats a memoized child component.
    PreferStableEmptyFallback,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when an empty fallback defeats a memoized child component.",
);

impl Rule for PreferStableEmptyFallback {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if has_capability(ctx, "react-compiler") {
            return;
        }
        let memoized_component_names = stable_fallback_memoized_component_names(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXAttribute(attribute) = node.kind() else {
                continue;
            };
            if crate::ast_util::get_enclosing_function(node, ctx).is_none() {
                continue;
            }
            let AstKind::JSXOpeningElement(opening_element) =
                ctx.nodes().parent_node(node.id()).kind()
            else {
                continue;
            };
            let JSXElementName::IdentifierReference(component_name) = &opening_element.name else {
                continue;
            };
            if !memoized_component_names.contains(component_name.name.as_str()) {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            let Expression::LogicalExpression(logical_expression) =
                expression.get_inner_expression()
            else {
                continue;
            };
            if !matches!(
                logical_expression.operator,
                LogicalOperator::Or | LogicalOperator::Coalesce
            ) || !stable_fallback_non_empty_expression(&logical_expression.left)
            {
                continue;
            }
            let message = match logical_expression.right.get_inner_expression() {
                Expression::ArrayExpression(array) if array.elements.is_empty() => {
                    EMPTY_ARRAY_FALLBACK_MESSAGE
                }
                Expression::ObjectExpression(object) if object.properties.is_empty() => {
                    EMPTY_OBJECT_FALLBACK_MESSAGE
                }
                _ => continue,
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(message).with_label(logical_expression.right.span()),
            );
        }
    }
}

fn stable_fallback_memoized_component_names<'a>(ctx: &LintContext<'a>) -> FxHashSet<&'a str> {
    ctx.nodes()
        .iter()
        .filter_map(|node| {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                return None;
            };
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                return None;
            };
            if !is_program_owned_variable_declarator(identifier.symbol_id(), ctx) {
                return None;
            }
            let Expression::CallExpression(call) = declarator.init.as_ref()? else {
                return None;
            };
            stable_fallback_is_memoizing_callee(&call.callee).then_some(identifier.name.as_str())
        })
        .collect()
}

fn stable_fallback_is_memoizing_callee(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => matches!(
            identifier.name.as_str(),
            "memo" | "observer" | "observable" | "withTracking"
        ),
        Expression::StaticMemberExpression(member) => {
            member.property.name == "memo"
                && matches!(
                    member.object.get_inner_expression(),
                    Expression::Identifier(identifier) if identifier.name == "React"
                )
        }
        _ => false,
    }
}

fn stable_fallback_non_empty_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(_) | Expression::ThisExpression(_) => true,
        Expression::StaticMemberExpression(member) => {
            stable_fallback_non_empty_expression(&member.object)
        }
        Expression::PrivateFieldExpression(member) => {
            stable_fallback_non_empty_expression(&member.object)
        }
        _ => false,
    }
}
