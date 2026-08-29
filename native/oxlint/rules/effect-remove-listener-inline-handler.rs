use rustc_hash::FxHashSet;

use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule};

const REMOVAL_METHOD_NAMES: [&str; 3] = ["removeEventListener", "removeListener", "off"];
const REGISTRATION_METHOD_NAMES: [&str; 4] = ["addEventListener", "addListener", "on", "once"];
const HANDLER_ONLY_EVENT_KEY: &str = "handler-only";

#[derive(Debug, Default, Clone)]
pub struct EffectRemoveListenerInlineHandler;

declare_oxc_lint!(
    /// Require listener removal to reuse the registered handler reference.
    EffectRemoveListenerInlineHandler,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require listener removal to reuse the registered handler reference.",
);

impl Rule for EffectRemoveListenerInlineHandler {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let registration_keys = collect_registration_keys(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                continue;
            };
            let Some(method_name) = member.static_property_name() else {
                continue;
            };
            if !REMOVAL_METHOD_NAMES.contains(&method_name) {
                continue;
            }

            let handler_index =
                usize::from(method_name != "removeListener" || call.arguments.len() != 1);
            let Some(handler) = call
                .arguments
                .get(handler_index)
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            if handler_index == 1
                && call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| numeric_first_argument(argument, ctx))
            {
                continue;
            }
            if !is_fresh_function_reference(handler) {
                continue;
            }
            let Some(receiver_key) = serialize_reference(member.object(), ctx) else {
                continue;
            };
            let event_key = if method_name == "removeListener" && call.arguments.len() == 1 {
                Some(HANDLER_ONLY_EVENT_KEY.to_string())
            } else {
                call.arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .and_then(|argument| serialize_event(argument, ctx))
            };
            let Some(event_key) = event_key else {
                continue;
            };
            if !registration_keys.contains(&(receiver_key, event_key)) {
                continue;
            }

            let message = format!(
                "`{method_name}` gets a brand-new function reference here that never equals the registered listener, so this removal silently no-ops; pass the same named handler to both the add and remove calls."
            );
            ctx.diagnostic(OxcDiagnostic::error(message).with_label(handler.span()));
        }
    }
}

fn numeric_first_argument(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(_) => true,
        Expression::Identifier(identifier) => {
            let lowercase_name = identifier.name.to_ascii_lowercase();
            if ["duration", "delay", "timeout", "ms"]
                .iter()
                .any(|suffix| lowercase_name.ends_with(suffix))
            {
                return true;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            matches!(
                ctx.symbol_declaration(symbol_id).kind(),
                AstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|initializer| matches!(
                        initializer.get_inner_expression(),
                        Expression::NumericLiteral(_)
                    ))
            )
        }
        _ => false,
    }
}

fn is_fresh_function_reference(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::CallExpression(call) => call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member| member.static_property_name() == Some("bind")),
        _ => false,
    }
}

fn collect_registration_keys(ctx: &LintContext<'_>) -> FxHashSet<(String, String)> {
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return None;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return None;
            };
            let Some(method_name) = member.static_property_name() else {
                return None;
            };
            if !REGISTRATION_METHOD_NAMES.contains(&method_name) {
                return None;
            }
            let receiver_key = serialize_reference(member.object(), ctx)?;
            let registration_event_key =
                if method_name == "addListener" && call.arguments.len() == 1 {
                    Some(HANDLER_ONLY_EVENT_KEY.to_string())
                } else {
                    call.arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .and_then(|argument| serialize_event(argument, ctx))
                };
            Some((receiver_key, registration_event_key?))
        })
        .collect()
}

fn serialize_event(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(format!("literal:{}", literal.value)),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(format!(
                "literal:{}",
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
            ))
        }
        expression => serialize_reference(expression, ctx).map(|key| format!("reference:{key}")),
    }
}

fn serialize_reference(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            Some(symbol_id.map_or_else(
                || identifier.name.to_string(),
                |symbol_id| format!("{}#{symbol_id:?}", identifier.name),
            ))
        }
        Expression::ThisExpression(_) => Some("this".to_string()),
        expression => {
            let member = expression.as_member_expression()?;
            let receiver = serialize_reference(member.object(), ctx)?;
            let property_name = member.static_property_name()?;
            Some(format!("{receiver}.{property_name}"))
        }
    }
}
