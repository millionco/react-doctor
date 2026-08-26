use std::collections::HashSet;

use oxc_ast::{
    ast::{Expression, JSXAttributeValue, JSXOpeningElement, MemberExpression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const FORM_MESSAGE_SERVER_CAPABLE: &str = "Your users can't submit this <form> without JavaScript because onSubmit calls preventDefault(), so use a server action like `<form action={serverAction}>` to make it work either way.";
const FORM_MESSAGE_GENERIC: &str =
    "Your users can't submit this <form> because onSubmit calls preventDefault().";
const ANCHOR_MESSAGE: &str = "Your users click this <a> & nothing navigates because onClick calls preventDefault(), so use a <button> or a routing component instead.";
const NAVIGATION_RECEIVER_NAMES: [&str; 6] = [
    "router",
    "navigation",
    "navigator",
    "history",
    "location",
    "window",
];
const GLOBAL_LOCATION_RECEIVER_NAMES: [&str; 5] =
    ["window", "document", "globalThis", "self", "top"];
const NAVIGATION_METHOD_NAMES: [&str; 8] = [
    "push", "replace", "assign", "open", "go", "back", "forward", "reload",
];

#[derive(Debug, Default, Clone)]
pub struct NoPreventDefault;

declare_oxc_lint!(
    /// Disallow preventDefault on forms and links when it removes their native behavior.
    NoPreventDefault,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow preventDefault that removes native form or link behavior.",
);

impl Rule for NoPreventDefault {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let framework = react_doctor_framework_setting_from_json(ctx.settings().json.as_ref());
        let is_client_only_framework = has_capability(ctx, "client-only");
        let is_server_actions_framework = has_capability(ctx, "server-actions");
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let Some((element_name, _)) = resolve_jsx_element_type(opening_element, ctx) else {
                continue;
            };
            if !matches!(element_name, "form" | "a") {
                continue;
            }
            if element_name == "form"
                && (is_client_only_framework
                    || matches!(framework, None | Some("unknown"))
                    || (framework == Some("nextjs")
                        && is_server_actions_framework
                        && !ctx
                            .nodes()
                            .program()
                            .directives
                            .iter()
                            .any(|directive| directive.directive == "use client")))
            {
                continue;
            }
            if element_name == "a"
                && find_jsx_attribute(opening_element, "href").is_none()
                && !opening_element.attributes.iter().any(|attribute| {
                    matches!(
                        attribute,
                        oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                    )
                })
            {
                continue;
            }
            if element_name == "form" && find_jsx_attribute(opening_element, "action").is_some() {
                continue;
            }
            if element_name == "a" && prevent_default_has_literal_role_button(opening_element) {
                continue;
            }
            let event_attribute_name = if element_name == "form" {
                "onSubmit"
            } else {
                "onClick"
            };
            let Some(handler_expression) =
                find_jsx_attribute(opening_element, event_attribute_name)
                    .and_then(|attribute| attribute.value.as_ref())
                    .and_then(|value| match value {
                        JSXAttributeValue::ExpressionContainer(container) => {
                            container.expression.as_expression()
                        }
                        _ => None,
                    })
            else {
                continue;
            };
            let Some((handler_id, handler_span, is_async)) =
                prevent_default_inline_handler(handler_expression)
            else {
                continue;
            };
            let prevent_default_call_ids = prevent_default_call_ids(handler_span, ctx);
            if prevent_default_call_ids.is_empty() {
                continue;
            }
            if element_name == "form"
                && !prevent_default_contains_asynchronous_work(handler_span, is_async, ctx)
                && prevent_default_contains_controlled_input(node, ctx)
            {
                continue;
            }
            if element_name == "a" {
                if prevent_default_call_ids.iter().all(|call_id| {
                    prevent_default_call_is_inside_conditional(*call_id, handler_id, ctx)
                }) || prevent_default_contains_navigation_effect(handler_id, handler_span, ctx)
                {
                    continue;
                }
                if find_jsx_attribute(opening_element, "href")
                    .is_some_and(prevent_default_is_fragment_href)
                    && prevent_default_contains_scroll_or_focus_call(handler_span, ctx)
                {
                    continue;
                }
            }
            let message = if element_name == "a" {
                ANCHOR_MESSAGE
            } else if is_server_actions_framework {
                FORM_MESSAGE_SERVER_CAPABLE
            } else {
                FORM_MESSAGE_GENERIC
            };
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
        }
    }
}

fn prevent_default_inline_handler(
    expression: &Expression<'_>,
) -> Option<(NodeId, oxc_span::Span, bool)> {
    match expression {
        Expression::ArrowFunctionExpression(function) => {
            Some((function.node_id.get(), function.span, function.r#async))
        }
        Expression::FunctionExpression(function) => {
            Some((function.node_id.get(), function.span, function.r#async))
        }
        _ => None,
    }
}

fn prevent_default_call_ids(handler_span: oxc_span::Span, ctx: &LintContext<'_>) -> Vec<NodeId> {
    ctx.nodes()
        .iter()
        .filter(|candidate| handler_span.contains_inclusive(candidate.span()))
        .filter_map(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return None;
            };
            matches!(
                &call.callee,
                Expression::StaticMemberExpression(member)
                    if member.property.name == "preventDefault"
            )
            .then(|| candidate.id())
        })
        .collect()
}

fn prevent_default_call_is_inside_conditional(
    call_id: NodeId,
    handler_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(call_id) {
        if ancestor.id() == handler_id {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::IfStatement(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
                | AstKind::SwitchCase(_)
        ) {
            return true;
        }
    }
    false
}

fn prevent_default_contains_navigation_effect(
    handler_id: NodeId,
    handler_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    let enclosing_parameter_names =
        prevent_default_collect_enclosing_parameter_names(handler_id, ctx);
    ctx.nodes()
        .iter()
        .filter(|candidate| handler_span.contains_inclusive(candidate.span()))
        .any(|candidate| match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                prevent_default_is_location_assignment_target(&assignment.left)
            }
            AstKind::CallExpression(call) => match &call.callee {
                Expression::StaticMemberExpression(member) => {
                    let method_name = member.property.name.as_str();
                    prevent_default_is_unambiguous_navigation_callee_name(method_name)
                        || (NAVIGATION_METHOD_NAMES.contains(&method_name)
                            && prevent_default_is_navigation_receiver(&member.object))
                }
                Expression::Identifier(identifier) => {
                    prevent_default_is_navigation_function_name(identifier.name.as_str())
                        || enclosing_parameter_names.contains(identifier.name.as_str())
                }
                _ => false,
            },
            _ => false,
        })
}

fn prevent_default_collect_enclosing_parameter_names(
    handler_id: NodeId,
    ctx: &LintContext<'_>,
) -> HashSet<String> {
    let mut parameter_names = HashSet::new();
    let handler = ctx.nodes().get_node(handler_id);
    for candidate in std::iter::once(handler).chain(ctx.nodes().ancestors(handler_id)) {
        let parameters = if let AstKind::ArrowFunctionExpression(function) = candidate.kind() {
            function.params.as_ref()
        } else if let AstKind::Function(function) = candidate.kind() {
            function.params.as_ref()
        } else {
            continue;
        };
        for parameter in &parameters.items {
            collect_binding_pattern_names(&parameter.pattern, &mut parameter_names);
        }
    }
    parameter_names
}

fn prevent_default_is_unambiguous_navigation_callee_name(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    ["navigate", "redirect", "openlink", "openurl"]
        .iter()
        .any(|prefix| lowercase_name.starts_with(prefix))
}

fn prevent_default_is_navigation_function_name(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    ["navigate", "redirect", "open"]
        .iter()
        .any(|prefix| lowercase_name.starts_with(prefix))
}

fn prevent_default_is_navigation_receiver(receiver: &Expression<'_>) -> bool {
    match receiver {
        Expression::Identifier(identifier) => {
            NAVIGATION_RECEIVER_NAMES.contains(&identifier.name.as_str())
        }
        Expression::StaticMemberExpression(member) => {
            NAVIGATION_RECEIVER_NAMES.contains(&member.property.name.as_str())
        }
        _ => false,
    }
}

fn prevent_default_is_location_assignment_target(
    target: &oxc_ast::ast::AssignmentTarget<'_>,
) -> bool {
    let Some(MemberExpression::StaticMemberExpression(member)) = target.as_member_expression()
    else {
        return false;
    };
    if member.property.name == "location" {
        return matches!(
            &member.object,
            Expression::Identifier(identifier)
                if GLOBAL_LOCATION_RECEIVER_NAMES.contains(&identifier.name.as_str())
        );
    }
    if member.property.name != "href" {
        return false;
    }
    match &member.object {
        Expression::Identifier(identifier) => identifier.name == "location",
        Expression::StaticMemberExpression(location_member) => {
            location_member.property.name == "location"
                && matches!(
                    &location_member.object,
                    Expression::Identifier(identifier)
                        if GLOBAL_LOCATION_RECEIVER_NAMES.contains(&identifier.name.as_str())
                )
        }
        _ => false,
    }
}

fn prevent_default_is_fragment_href(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(value)) => {
            value.value.starts_with('#') && value.value.len() > 1
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => matches!(
            container.expression.as_expression(),
            Some(Expression::TemplateLiteral(template))
                if template.quasis.first().is_some_and(|quasi| quasi.value.raw.starts_with('#'))
        ),
        _ => false,
    }
}

fn prevent_default_contains_scroll_or_focus_call(
    handler_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .iter()
        .filter(|candidate| handler_span.contains_inclusive(candidate.span()))
        .any(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            let callee_name = match &call.callee {
                Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
                _ => None,
            };
            callee_name.is_some_and(|name| {
                let lowercase_name = name.to_ascii_lowercase();
                lowercase_name.starts_with("scroll") || lowercase_name == "focus"
            })
        })
}

fn prevent_default_contains_controlled_input(
    form_opening_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let form_element = ctx.nodes().parent_node(form_opening_node.id());
    let AstKind::JSXElement(form_element) = form_element.kind() else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if candidate.id() == form_opening_node.id()
            || !form_element.span.contains_inclusive(candidate.span())
        {
            return false;
        }
        let AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            return false;
        };
        find_jsx_attribute(opening_element, "value").is_some()
            && find_jsx_attribute(opening_element, "onChange").is_some()
    })
}

fn prevent_default_contains_asynchronous_work(
    handler_span: oxc_span::Span,
    handler_is_async: bool,
    ctx: &LintContext<'_>,
) -> bool {
    handler_is_async
        || ctx
            .nodes()
            .iter()
            .filter(|candidate| handler_span.contains_inclusive(candidate.span()))
            .any(|candidate| match candidate.kind() {
                AstKind::AwaitExpression(_) => true,
                AstKind::CallExpression(call) => matches!(
                    &call.callee,
                    Expression::StaticMemberExpression(member) if member.property.name == "then"
                ),
                _ => false,
            })
}

fn prevent_default_has_literal_role_button(opening_element: &JSXOpeningElement<'_>) -> bool {
    matches!(
        find_jsx_attribute(opening_element, "role").and_then(|attribute| attribute.value.as_ref()),
        Some(JSXAttributeValue::StringLiteral(value)) if value.value == "button"
    )
}
