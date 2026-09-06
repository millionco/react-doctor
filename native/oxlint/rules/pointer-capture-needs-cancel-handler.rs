use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This drag captures a pointer and cleans up only on pointer-up. Add pointer-cancel or lost-capture cleanup for interruptions such as scrolling, app switches, or orientation changes.";

#[derive(Debug, Default, Clone)]
pub struct PointerCaptureNeedsCancelHandler;

declare_oxc_lint!(
    /// Requires cancellation cleanup for captured pointer interactions.
    PointerCaptureNeedsCancelHandler,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Requires cancellation cleanup for captured pointer interactions.",
);

impl Rule for PointerCaptureNeedsCancelHandler {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(element_name) = &opening_element.name else {
            return;
        };
        if !element_name
            .name
            .as_str()
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_lowercase)
            || has_any_jsx_spread_attribute(opening_element)
        {
            return;
        }
        let Some(pointer_down_attribute) =
            get_authoritative_jsx_attribute(opening_element, "onPointerDown", true)
        else {
            return;
        };
        if get_authoritative_jsx_attribute(opening_element, "onPointerMove", true).is_none()
            || get_authoritative_jsx_attribute(opening_element, "onPointerUp", true).is_none()
            || [
                "onPointerCancel",
                "onPointerCancelCapture",
                "onLostPointerCapture",
                "onLostPointerCaptureCapture",
            ]
            .iter()
            .any(|name| get_authoritative_jsx_attribute(opening_element, name, true).is_some())
        {
            return;
        }
        let Some(handler_expression) = jsx_attribute_expression(pointer_down_attribute) else {
            return;
        };
        let Some(handler_id) = pointer_down_handler_id(handler_expression, ctx) else {
            return;
        };
        if handler_captures_its_pointer(handler_id, ctx) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(pointer_down_attribute.span()));
        }
    }
}

fn pointer_down_handler_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    let mut resolution_cache = LocalFunctionResolutionCache::default();
    if let Some(function_id) = exact_local_function_id_including_generators(
        expression,
        ctx,
        &mut Vec::new(),
        &mut resolution_cache,
    ) {
        return Some(function_id);
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let initializer = pointer_handler_const_initializer(identifier, ctx, &mut Vec::new())?;
    let Expression::CallExpression(use_callback_call) = initializer.get_inner_expression() else {
        return None;
    };
    if !is_react_api_call(use_callback_call, "useCallback", ctx) {
        return None;
    }
    let wrapped_handler = use_callback_call
        .arguments
        .first()
        .and_then(Argument::as_expression)?;
    exact_local_function_id_including_generators(
        wrapped_handler,
        ctx,
        &mut Vec::new(),
        &mut resolution_cache,
    )
}

fn pointer_handler_const_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    if !variable_declaration.kind.is_const()
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let initializer = declarator.init.as_ref()?;
    if let Expression::Identifier(next_identifier) = initializer.get_inner_expression() {
        return pointer_handler_const_initializer(next_identifier, ctx, visited_symbol_ids);
    }
    Some(initializer)
}

fn handler_captures_its_pointer(handler_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let handler = ctx.nodes().get_node(handler_id);
    let (first_parameter, body_span) = match handler.kind() {
        AstKind::Function(function) => {
            let Some(body) = &function.body else {
                return false;
            };
            (function.params.items.first(), body.span)
        }
        AstKind::ArrowFunctionExpression(function) => {
            (function.params.items.first(), function.body.span())
        }
        _ => return false,
    };
    let Some(BindingPattern::BindingIdentifier(event_parameter)) =
        first_parameter.map(|parameter| &parameter.pattern)
    else {
        return false;
    };
    let event_symbol_id = event_parameter.symbol_id();

    ctx.scoping()
        .get_resolved_references(event_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            body_span.contains_inclusive(reference_node.span())
                && local_callback_nearest_function_id(reference_node.id(), ctx) == Some(handler_id)
                && event_reference_captures_pointer(reference_node, event_symbol_id, ctx)
        })
}

fn event_reference_captures_pointer<'a>(
    event_reference: &AstNode<'a>,
    event_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let event_root = transparent_expression_root(event_reference, ctx);
    let capture_receiver_node = ctx.nodes().parent_node(event_root.id());
    let Some(capture_receiver) = capture_receiver_node.kind().as_member_expression_kind() else {
        return false;
    };
    if capture_receiver.object().span() != event_root.span()
        || capture_receiver.static_property_name().as_deref() != Some("currentTarget")
    {
        return false;
    }
    let capture_receiver_root = transparent_expression_root(capture_receiver_node, ctx);
    let callee_node = ctx.nodes().parent_node(capture_receiver_root.id());
    let Some(callee) = callee_node.kind().as_member_expression_kind() else {
        return false;
    };
    if callee.object().span() != capture_receiver_root.span()
        || callee.static_property_name().as_deref() != Some("setPointerCapture")
    {
        return false;
    }
    let callee_root = transparent_expression_root(callee_node, ctx);
    let call_node = ctx.nodes().parent_node(callee_root.id());
    let AstKind::CallExpression(call_expression) = call_node.kind() else {
        return false;
    };
    if call_expression.callee.span() != callee_root.span() {
        return false;
    }
    let Some(pointer_id_member) = call_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
        .and_then(Expression::as_member_expression)
    else {
        return false;
    };
    if static_member_expression_property_name(pointer_id_member) != Some("pointerId") {
        return false;
    }
    let Expression::Identifier(pointer_event) = pointer_id_member.object().get_inner_expression()
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(pointer_event.reference_id())
        .symbol_id()
        == Some(event_symbol_id)
}
