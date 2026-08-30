use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashMap;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DERIVING_ARRAY_METHODS: [&str; 5] = ["toSorted", "toReversed", "filter", "map", "slice"];

#[derive(Debug, Default, Clone)]
pub struct ServerDedupProps;

declare_oxc_lint!(
    /// Disallow sending both an array and a derived copy through server component props.
    ServerDedupProps,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow duplicate data in server component props.",
);

impl Rule for ServerDedupProps {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if ctx
            .nodes()
            .program()
            .directives
            .iter()
            .any(|directive| directive.directive == "use client")
            || ctx.nodes().iter().any(|node| {
                matches!(node.kind(), AstKind::CallExpression(call) if server_dedup_is_hook_call(call))
            })
        {
            return;
        }

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let mut direct_prop_names_by_identifier = FxHashMap::<&str, &str>::default();
            let mut derived_props = Vec::<(&str, &str, Span)>::new();

            for attribute in &opening_element.attributes {
                let JSXAttributeItem::Attribute(attribute) = attribute else {
                    continue;
                };
                let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                    continue;
                };
                if attribute_name.name == "key" {
                    continue;
                }
                let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                else {
                    continue;
                };
                let Some(expression) = container.expression.as_expression() else {
                    continue;
                };

                if let Expression::Identifier(identifier) = expression {
                    direct_prop_names_by_identifier
                        .insert(identifier.name.as_str(), attribute_name.name.as_str());
                    continue;
                }
                let Expression::CallExpression(call_expression) = expression else {
                    continue;
                };
                let Some(method_name) =
                    server_dedup_member_identifier_name(&call_expression.callee)
                else {
                    continue;
                };
                if !DERIVING_ARRAY_METHODS.contains(&method_name) {
                    continue;
                }
                let Some(root_name) = server_dedup_root_identifier_name(expression) else {
                    continue;
                };
                derived_props.push((attribute_name.name.as_str(), root_name, attribute.span()));
            }

            for (derived_prop_name, root_name, span) in derived_props {
                let Some(source_prop_name) = direct_prop_names_by_identifier.get(root_name) else {
                    continue;
                };
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Passing both \"{derived_prop_name}\" & \"{source_prop_name}\" ships the same data twice to your users (source: {root_name})."
                    ))
                    .with_label(span),
                );
            }
        }
    }
}

fn server_dedup_is_hook_call(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match &call_expression.callee {
        Expression::Identifier(identifier) => server_dedup_is_hook_name(&identifier.name),
        expression => {
            server_dedup_member_identifier_name(expression).is_some_and(server_dedup_is_hook_name)
        }
    }
}

fn server_dedup_is_hook_name(name: &str) -> bool {
    name.strip_prefix("use")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn server_dedup_member_identifier_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.as_member_expression()? {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = &member.expression else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn server_dedup_root_identifier_name<'a>(mut expression: &'a Expression<'a>) -> Option<&'a str> {
    loop {
        expression = expression.get_inner_expression();
        match expression {
            Expression::Identifier(identifier) => return Some(identifier.name.as_str()),
            Expression::CallExpression(call_expression) => {
                expression = call_expression.callee.as_member_expression()?.object();
            }
            candidate_expression => {
                expression = candidate_expression.as_member_expression()?.object();
            }
        }
    }
}
