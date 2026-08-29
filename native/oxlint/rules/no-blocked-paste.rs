use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This authentication field blocks paste, forcing users to transcribe credentials or verification codes. Remove preventDefault() from the paste handler.";
const AUTHENTICATION_AUTOCOMPLETE_TOKENS: [&str; 4] = [
    "current-password",
    "new-password",
    "one-time-code",
    "username",
];

#[derive(Debug, Default, Clone)]
pub struct NoBlockedPaste;

declare_oxc_lint!(
    /// Disallow blocking paste in authentication fields.
    NoBlockedPaste,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow blocking paste in authentication fields.",
);

impl Rule for NoBlockedPaste {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name) != Some("input")
            || !blocked_paste_is_authentication_input(opening_element)
            || has_any_jsx_spread_attribute(opening_element)
        {
            return;
        }
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for attribute in &opening_element.attributes {
            let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            if !matches!(&attribute.name, JSXAttributeName::Identifier(identifier) if identifier.name == "onPaste")
            {
                continue;
            }
            let Some(handler_expression) = jsx_attribute_expression(attribute) else {
                continue;
            };
            let Some(handler_node_id) = blocked_paste_exact_local_function_node_id(
                handler_expression,
                ctx,
                &mut Vec::new(),
                &mut resolution_cache,
            ) else {
                continue;
            };
            let Some(prevention_span) =
                blocked_paste_definite_prevention_span(handler_node_id, ctx)
            else {
                continue;
            };
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(prevention_span));
        }
    }
}

fn blocked_paste_is_authentication_input(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    let mut input_type = None;
    let mut autocomplete = None;
    let mut has_input_type_attribute = false;
    let mut has_autocomplete_attribute = false;
    for attribute in &opening_element.attributes {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            continue;
        };
        let JSXAttributeName::Identifier(identifier) = &attribute.name else {
            continue;
        };
        let value = attribute
            .value
            .as_ref()
            .and_then(get_direct_string_literal_attribute_value);
        if !has_input_type_attribute && identifier.name.eq_ignore_ascii_case("type") {
            has_input_type_attribute = true;
            input_type = value;
        } else if !has_autocomplete_attribute
            && identifier.name.eq_ignore_ascii_case("autocomplete")
        {
            has_autocomplete_attribute = true;
            autocomplete = value;
        }
    }
    input_type.is_some_and(|value| value.eq_ignore_ascii_case("password"))
        || autocomplete.is_some_and(|value| {
            value.split_whitespace().any(|token| {
                AUTHENTICATION_AUTOCOMPLETE_TOKENS
                    .iter()
                    .any(|candidate| token.eq_ignore_ascii_case(candidate))
            })
        })
}

fn blocked_paste_exact_local_function_node_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call_expression) = expression
        && let Some(member_expression) = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
        && static_member_expression_property_name(member_expression) == Some("bind")
    {
        return blocked_paste_exact_local_function_node_id(
            member_expression.object(),
            ctx,
            visited_symbol_ids,
            resolution_cache,
        );
    }
    if let Some(member_expression) = expression.as_member_expression()
        && matches!(
            static_member_expression_property_name(member_expression),
            Some("call" | "apply")
        )
    {
        return blocked_paste_exact_local_function_node_id(
            member_expression.object(),
            ctx,
            visited_symbol_ids,
            resolution_cache,
        );
    }
    exact_local_function_id_including_generators(
        expression,
        ctx,
        visited_symbol_ids,
        resolution_cache,
    )
}

fn blocked_paste_definite_prevention_span(
    function_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Option<Span> {
    let (event_symbol_id, body_span) = match ctx.nodes().get_node(function_node_id).kind() {
        AstKind::Function(function) => (
            function
                .params
                .items
                .first()
                .map(|parameter| &parameter.pattern)
                .and_then(blocked_paste_binding_symbol_id)?,
            function.body.as_ref()?.span(),
        ),
        AstKind::ArrowFunctionExpression(function) => (
            function
                .params
                .items
                .first()
                .map(|parameter| &parameter.pattern)
                .and_then(blocked_paste_binding_symbol_id)?,
            function.body.span(),
        ),
        _ => return None,
    };
    for candidate in ctx.nodes().iter() {
        if !body_span.contains_inclusive(candidate.span())
            || blocked_paste_nearest_function_node_id(candidate.id(), ctx) != Some(function_node_id)
        {
            continue;
        }
        if let AstKind::CallExpression(call_expression) = candidate.kind()
            && blocked_paste_is_event_prevention_call(call_expression, event_symbol_id, ctx)
        {
            return Some(call_expression.span);
        }
        if blocked_paste_is_control_flow_node(candidate, event_symbol_id, ctx) {
            return None;
        }
    }
    None
}

fn blocked_paste_binding_symbol_id(
    binding_pattern: &BindingPattern<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let BindingPattern::BindingIdentifier(identifier) = binding_pattern else {
        return None;
    };
    Some(identifier.symbol_id())
}

fn blocked_paste_nearest_function_node_id(
    node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn blocked_paste_is_control_flow_node(
    node: &AstNode<'_>,
    event_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    match node.kind() {
        AstKind::ReturnStatement(statement) => !statement.argument.as_ref().is_some_and(|argument| {
            matches!(argument.get_inner_expression(), Expression::CallExpression(call_expression)
                if blocked_paste_is_event_prevention_call(call_expression, event_symbol_id, ctx))
        }),
        AstKind::DoWhileStatement(_)
        | AstKind::ForInStatement(_)
        | AstKind::ForOfStatement(_)
        | AstKind::ForStatement(_)
        | AstKind::IfStatement(_)
        | AstKind::ConditionalExpression(_)
        | AstKind::LogicalExpression(_)
        | AstKind::SwitchStatement(_)
        | AstKind::SwitchCase(_)
        | AstKind::ThrowStatement(_)
        | AstKind::TryStatement(_)
        | AstKind::WhileStatement(_) => true,
        _ => false,
    }
}

fn blocked_paste_is_event_prevention_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    event_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if static_member_expression_property_name(member_expression) != Some("preventDefault") {
        return false;
    }
    let Expression::Identifier(receiver) = member_expression.object().get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
        == Some(event_symbol_id)
}
