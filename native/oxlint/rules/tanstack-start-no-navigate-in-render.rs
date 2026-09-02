use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DEFERRED_HOOK_NAMES: [&str; 4] = ["useEffect", "useLayoutEffect", "useCallback", "useMemo"];
const PROMISE_CONTINUATION_METHOD_NAMES: [&str; 3] = ["then", "catch", "finally"];
const RENDER_SYNCHRONOUS_HOOK_NAMES: [&str; 2] = ["useState", "useSyncExternalStore"];
const MESSAGE: &str = "navigate() runs during render here, so server and browser output can diverge during hydration.";

#[derive(Debug, Default, Clone)]
pub struct TanstackStartNoNavigateInRender;

declare_oxc_lint!(
    /// Disallow navigate calls during TanStack Start route rendering.
    TanstackStartNoNavigateInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow navigate calls during TanStack Start route rendering.",
);

impl Rule for TanstackStartNoNavigateInRender {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !is_in_project_directory(ctx, "routes") {
            return;
        }
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if call_expression.arguments.is_empty()
            || !matches!(
                &call_expression.callee,
                Expression::Identifier(identifier) if identifier.name == "navigate"
            )
            || navigate_call_is_deferred(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}

fn navigate_call_is_deferred<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    if navigate_call_is_inside_deferred_scope(node, ctx) {
        return true;
    }

    let mut enclosing_function = nearest_navigate_function(node.id(), ctx);
    while let Some(function_node) = enclosing_function {
        if navigate_function_is_deferred_callback(function_node, ctx)
            || navigate_function_is_wired_as_event_handler(function_node, ctx)
            || navigate_function_is_returned_from_custom_hook(function_node, ctx)
        {
            return true;
        }
        if navigate_function_binding(function_node, ctx).is_some()
            || !navigate_function_is_synchronously_invoked_wrapper(function_node, ctx)
        {
            return false;
        }
        enclosing_function = nearest_navigate_function(function_node.id(), ctx);
    }
    false
}

fn navigate_call_is_inside_deferred_scope<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .any(|ancestor| match ancestor.kind() {
            AstKind::CallExpression(call_expression) => {
                navigate_callee_name(&call_expression.callee)
                    .is_some_and(|callee_name| DEFERRED_HOOK_NAMES.contains(&callee_name))
            }
            AstKind::JSXAttribute(attribute) => matches!(
                &attribute.name,
                oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                    if is_navigate_event_handler_name(identifier.name.as_str())
            ),
            AstKind::ObjectProperty(property) => {
                navigate_property_name(property).is_some_and(is_navigate_event_handler_name)
                    && navigate_expression_is_function(&property.value)
            }
            AstKind::VariableDeclarator(declarator) => {
                matches!(
                    &declarator.id,
                    oxc_ast::ast::BindingPattern::BindingIdentifier(identifier)
                        if is_navigate_handler_function_name(identifier.name.as_str())
                ) && declarator
                    .init
                    .as_ref()
                    .is_some_and(navigate_expression_is_function)
            }
            AstKind::Function(function) => {
                function.is_function_declaration()
                    && function.id.as_ref().is_some_and(|identifier| {
                        is_navigate_handler_function_name(identifier.name.as_str())
                    })
            }
            _ => false,
        })
}

fn navigate_function_is_deferred_callback<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    if call_expression.callee.span() == function_node.span() {
        return false;
    }
    if let Some(member_expression) = call_expression.callee.as_member_expression()
        && !member_expression.is_computed()
        && member_expression_identifier_property_name(member_expression)
            .is_some_and(|method_name| PROMISE_CONTINUATION_METHOD_NAMES.contains(&method_name))
    {
        return true;
    }
    let Expression::Identifier(callee_identifier) = &call_expression.callee else {
        return false;
    };
    let callee_name = callee_identifier.name.as_str();
    is_navigate_hook_name(callee_name)
        && !RENDER_SYNCHRONOUS_HOOK_NAMES.contains(&callee_name)
        && call_expression.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == function_node.span())
        })
}

fn navigate_function_is_wired_as_event_handler<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((symbol_id, _)) = navigate_function_binding(function_node, ctx) else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| navigate_reference_is_inside_event_handler(reference.node_id(), ctx))
}

fn navigate_reference_is_inside_event_handler(
    reference_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(reference_node_id)
        .any(|ancestor| match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => matches!(
                &attribute.name,
                oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                    if is_navigate_event_handler_name(identifier.name.as_str())
            ),
            AstKind::ObjectProperty(property) => {
                navigate_property_name(property).is_some_and(is_navigate_event_handler_name)
            }
            _ => false,
        })
}

fn navigate_function_is_returned_from_custom_hook<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    if matches!(parent.kind(), AstKind::ReturnStatement(_)) {
        return nearest_navigate_function(parent.id(), ctx)
            .and_then(|outer_function| navigate_function_binding(outer_function, ctx))
            .is_some_and(|(_, function_name)| is_navigate_hook_name(&function_name));
    }
    let AstKind::ArrowFunctionExpression(outer_function) = parent.kind() else {
        return false;
    };
    outer_function
        .get_expression()
        .is_some_and(|expression| expression.span() == function_node.span())
        && navigate_function_binding(parent, ctx)
            .is_some_and(|(_, function_name)| is_navigate_hook_name(&function_name))
}

fn navigate_function_is_synchronously_invoked_wrapper<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    call_expression.callee.span() == function_node.span()
        || call_expression.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == function_node.span())
        })
}

fn navigate_function_binding<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<(oxc_semantic::SymbolId, String)> {
    if let AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
        && let Some(identifier) = &function.id
    {
        return Some((identifier.symbol_id(), identifier.name.to_string()));
    }

    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    if let AstKind::VariableDeclarator(declarator) = parent.kind()
        && let oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) = &declarator.id
    {
        return Some((identifier.symbol_id(), identifier.name.to_string()));
    }
    if let AstKind::AssignmentExpression(assignment) = parent.kind()
        && assignment.right.span() == function_root.span()
        && let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
            &assignment.left
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
    {
        return Some((symbol_id, identifier.name.to_string()));
    }
    let AstKind::CallExpression(_) = parent.kind() else {
        return None;
    };
    let call_parent = ctx.nodes().parent_node(parent.id());
    let AstKind::VariableDeclarator(declarator) = call_parent.kind() else {
        return None;
    };
    let oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return None;
    };
    Some((identifier.symbol_id(), identifier.name.to_string()))
}

fn nearest_navigate_function<'a, 'b>(
    node_id: oxc_semantic::NodeId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    ctx.nodes().ancestors(node_id).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    })
}

fn navigate_callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(member_expression_identifier_property_name),
    }
}

fn navigate_property_name<'a>(property: &'a oxc_ast::ast::ObjectProperty<'a>) -> Option<&'a str> {
    property_key_identifier_name(&property.key).or_else(|| match &property.key {
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    })
}

fn navigate_expression_is_function(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_)
    )
}

fn is_navigate_event_handler_name(name: &str) -> bool {
    name.starts_with("on") && name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase)
}

fn is_navigate_handler_function_name(name: &str) -> bool {
    name.strip_prefix("on")
        .or_else(|| name.strip_prefix("handle"))
        .is_some_and(|suffix| {
            suffix
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_uppercase)
        })
}

fn is_navigate_hook_name(name: &str) -> bool {
    name.starts_with("use") && name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase)
}
