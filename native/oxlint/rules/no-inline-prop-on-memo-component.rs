use oxc_ast::{
    ast::{Argument, Expression, JSXAttributeName, JSXAttributeValue, JSXElementName},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const OBJECT_INTEGRITY_METHOD_NAMES: [&str; 3] = ["freeze", "seal", "preventExtensions"];

#[derive(Debug, Default, Clone)]
pub struct NoInlinePropOnMemoComponent;

declare_oxc_lint!(
    /// Disallow fresh reference props on memoized components.
    NoInlinePropOnMemoComponent,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow inline reference props that defeat memoized components.",
);

impl Rule for NoInlinePropOnMemoComponent {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let memoized_component_names = collect_memoized_component_names(ctx);
        if memoized_component_names.is_empty() {
            return;
        }
        for attribute_node in ctx.nodes().iter() {
            let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
                continue;
            };
            if matches!(
                &attribute.name,
                JSXAttributeName::Identifier(identifier) if identifier.name == "key"
            ) {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            let opening_element_node = ctx.nodes().parent_node(attribute_node.id());
            let AstKind::JSXOpeningElement(opening_element) = opening_element_node.kind() else {
                continue;
            };
            let element_name = match &opening_element.name {
                JSXElementName::Identifier(identifier) => identifier.name.as_str(),
                JSXElementName::IdentifierReference(identifier) => identifier.name.as_str(),
                _ => continue,
            };
            if !memoized_component_names.contains(element_name) {
                continue;
            }
            let Some(prop_type) = inline_reference_type(expression, ctx) else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This redraws {element_name} on every render because the prop is {prop_type} built right here, so memo() can't skip it. Move it to a stable value with useMemo, useCallback, or module scope"
                ))
                .with_label(expression.span()),
            );
        }
    }
}

fn collect_memoized_component_names(ctx: &LintContext<'_>) -> std::collections::HashSet<String> {
    let mut names = std::collections::HashSet::new();
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::VariableDeclarator(declarator) => {
                let Some(identifier) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                let Some(memo_call) = declarator.init.as_ref().and_then(memo_call_expression)
                else {
                    continue;
                };
                if !has_custom_comparator(memo_call, ctx) {
                    names.insert(identifier.name.to_string());
                }
            }
            AstKind::ExportDefaultDeclaration(declaration) => {
                let Some(expression) = declaration.declaration.as_expression() else {
                    continue;
                };
                let Some(memo_call) = memo_call_expression(expression) else {
                    continue;
                };
                if has_custom_comparator(memo_call, ctx) {
                    continue;
                }
                let Some(Expression::Identifier(identifier)) = memo_call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                else {
                    continue;
                };
                names.insert(identifier.name.to_string());
            }
            _ => {}
        }
    }
    names
}

fn memo_call_expression<'a, 'b>(
    expression: &'b Expression<'a>,
) -> Option<&'b oxc_ast::ast::CallExpression<'a>> {
    let Expression::CallExpression(call_expression) = expression else {
        return None;
    };
    is_memo_callee(&call_expression.callee).then_some(call_expression)
}

fn is_memo_callee(callee: &Expression<'_>) -> bool {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == "memo",
        Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "memo"
                && matches!(
                    member_expression.object.get_inner_expression(),
                    Expression::Identifier(identifier) if identifier.name == "React"
                )
        }
        _ => false,
    }
}

fn has_custom_comparator<'a>(
    memo_call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    memo_call
        .arguments
        .get(1)
        .is_some_and(|comparator| !is_identity_sensitive_comparator(comparator, ctx))
}

fn is_identity_sensitive_comparator<'a>(argument: &Argument<'a>, ctx: &LintContext<'a>) -> bool {
    let Some(expression) = argument.as_expression() else {
        return false;
    };
    match expression {
        Expression::Identifier(identifier) if identifier.name == "undefined" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none(),
        Expression::Identifier(_) => {
            imported_module_api_matches(expression, "shallowEqual", "react-redux", ctx)
        }
        Expression::StaticMemberExpression(member_expression)
            if member_expression.property.name == "shallowEqual" =>
        {
            imported_module_api_matches(expression, "shallowEqual", "react-redux", ctx)
        }
        _ => false,
    }
}

fn inline_reference_type<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    let reference =
        unwrap_object_integrity_expression(expression, ctx, &OBJECT_INTEGRITY_METHOD_NAMES);
    match reference {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            Some("functions")
        }
        Expression::CallExpression(call_expression) if is_bind_call(call_expression) => {
            Some("functions")
        }
        Expression::ObjectExpression(_) => Some("objects"),
        Expression::ArrayExpression(_) => Some("Arrays"),
        Expression::JSXElement(_) | Expression::JSXFragment(_) => Some("JSX"),
        _ => None,
    }
}

fn is_bind_call(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match &call_expression.callee {
        Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "bind"
        }
        Expression::ComputedMemberExpression(member_expression) => matches!(
            &member_expression.expression,
            Expression::Identifier(identifier) if identifier.name == "bind"
        ),
        _ => false,
    }
}
