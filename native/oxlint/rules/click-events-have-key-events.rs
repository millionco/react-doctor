use std::collections::{HashMap, HashSet};

use oxc_ast::{
    AstKind,
    ast::{
        ClassElement, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXChild,
        JSXElement, JSXElementName, JSXMemberExpressionObject, JSXOpeningElement,
        ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
    utils::{
        get_element_type, has_jsx_prop_ignore_case, is_hidden_from_screen_reader,
        is_interactive_element, is_presentation_role,
    },
};

const MESSAGE: &str = "Keyboard users can't trigger this click handler because there's no keyboard one, so add `onKeyUp`, `onKeyDown`, or `onKeyPress`.";
const CLICK_HANDLERS: [&str; 2] = ["onclick", "onclickcapture"];
const KEY_HANDLERS: [&str; 6] = [
    "onkeyup",
    "onkeydown",
    "onkeypress",
    "onkeyupcapture",
    "onkeydowncapture",
    "onkeypresscapture",
];
const CONSERVATIVE_SPREAD_PROP_NAMES: [&str; 4] =
    ["aria-hidden", "onmouseenter", "onmouseover", "role"];
const FOCUSLESS_CONTAINER_TAGS: [&str; 4] = ["tr", "td", "th", "canvas"];
const COMPOSITE_ITEM_ROLES: [&str; 8] = [
    "option",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "treeitem",
    "tab",
    "gridcell",
    "row",
];
const NATIVE_KEYBOARD_ACTIVATABLE_TAGS: [&str; 6] =
    ["a", "button", "input", "select", "summary", "textarea"];
const EVENT_BLOCKER_METHOD_NAMES: [&str; 3] = [
    "stopPropagation",
    "preventDefault",
    "stopImmediatePropagation",
];
const FOCUS_FORWARDING_METHOD_NAMES: [&str; 2] = ["focus", "select"];

#[derive(Debug, Default, Clone)]
pub struct ClickEventsHaveKeyEvents;

#[derive(Clone, Copy)]
struct HandlerFunction {
    node_id: NodeId,
    span: Span,
    is_conditional: bool,
    blockers_only: bool,
}

declare_oxc_lint!(
    /// Require clickable non-interactive elements to have a keyboard handler.
    ClickEventsHaveKeyEvents,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require click handlers to have keyboard equivalents.",
);

impl Rule for ClickEventsHaveKeyEvents {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }

        let element_type = member_factory_element_type(opening_element)
            .map_or_else(|| get_element_type(ctx, opening_element), Into::into);
        if !HTML_TAG.contains(element_type.as_ref()) || element_type == "label" {
            return;
        }
        if !FOCUSLESS_CONTAINER_TAGS.contains(&element_type.as_ref())
            && is_interactive_element(&element_type, opening_element)
        {
            return;
        }

        let spread_event_values = transparent_spread_event_values(opening_element, ctx);
        if spread_event_values.is_none() && should_use_curated_port_behavior(ctx) {
            return;
        }
        let spread_event_values = spread_event_values.unwrap_or_default();
        let click_attribute = jsx_attribute(opening_element, "onClick")
            .or_else(|| jsx_attribute(opening_element, "onClickCapture"));
        let spread_click_expression = CLICK_HANDLERS
            .iter()
            .find_map(|handler_name| spread_event_values.get(*handler_name).copied());
        if click_attribute.is_none() && spread_click_expression.is_none() {
            return;
        }

        if click_attribute.is_some_and(|attribute| {
            handler_is_focus_forwarding_or_blocking(attribute_expression(attribute), node, ctx)
        }) || spread_click_expression.is_some_and(|expression| {
            handler_is_focus_forwarding_or_blocking(Some(expression), node, ctx)
        }) {
            return;
        }
        if click_attribute.is_some_and(|attribute| {
            handler_contains_backdrop_comparison(attribute_expression(attribute), node, ctx)
        }) || spread_click_expression.is_some_and(|expression| {
            handler_contains_backdrop_comparison(Some(expression), node, ctx)
        }) {
            return;
        }
        if has_composite_item_role(opening_element)
            || (element_type == "li"
                && (jsx_attribute(opening_element, "onMouseEnter").is_some()
                    || jsx_attribute(opening_element, "onMouseOver").is_some()))
        {
            return;
        }

        let AstKind::JSXElement(element) = ctx.nodes().parent_kind(node.id()) else {
            return;
        };
        if has_keyboard_activatable_descendant(element, None, node, ctx) {
            return;
        }
        if let Some(attribute) = click_attribute
            && let Some(expression) = attribute_expression(attribute)
            && has_keyboard_activatable_descendant(element, Some(expression), node, ctx)
        {
            return;
        }
        if is_hidden_from_screen_reader(ctx, opening_element)
            || is_presentation_role(opening_element)
        {
            return;
        }
        if KEY_HANDLERS.iter().any(|handler_name| {
            jsx_attribute(opening_element, handler_name).is_some()
                || spread_event_values.contains_key(*handler_name)
        }) {
            return;
        }

        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
    }
}

fn jsx_attribute<'a, 'b>(
    opening_element: &'b JSXOpeningElement<'a>,
    name: &'b str,
) -> Option<&'b JSXAttribute<'a>> {
    has_jsx_prop_ignore_case(opening_element, name).and_then(JSXAttributeItem::as_attribute)
}

fn attribute_expression<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a Expression<'a>> {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return None;
    };
    container.expression.as_expression()
}

fn member_factory_element_type<'a>(opening_element: &'a JSXOpeningElement<'a>) -> Option<&'a str> {
    let JSXElementName::MemberExpression(member_expression) = &opening_element.name else {
        return None;
    };
    let JSXMemberExpressionObject::IdentifierReference(receiver) = &member_expression.object else {
        return None;
    };
    if !matches!(receiver.name.as_str(), "motion" | "styled") {
        return None;
    }
    let element_type = member_expression.property.name.as_str();
    HTML_TAG.contains(element_type).then_some(element_type)
}

fn transparent_spread_event_values<'a>(
    opening_element: &'a JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<HashMap<String, &'a Expression<'a>>> {
    let mut event_values = HashMap::new();
    for attribute in &opening_element.attributes {
        let JSXAttributeItem::SpreadAttribute(spread_attribute) = attribute else {
            continue;
        };
        if !collect_transparent_spread_event_values(
            &spread_attribute.argument,
            ctx,
            &mut event_values,
            &mut HashSet::new(),
        ) {
            return None;
        }
    }
    Some(event_values)
}

fn collect_transparent_spread_event_values<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    event_values: &mut HashMap<String, &'a Expression<'a>>,
    visited_objects: &mut HashSet<(u32, u32)>,
) -> bool {
    let expression = match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) else {
                return false;
            };
            initializer.get_inner_expression()
        }
        expression => expression,
    };
    let Expression::ObjectExpression(object_expression) = expression else {
        return false;
    };
    let object_key = (object_expression.span.start, object_expression.span.end);
    if !visited_objects.insert(object_key) {
        return false;
    }
    for property in &object_expression.properties {
        match property {
            ObjectPropertyKind::SpreadProperty(spread_property) => {
                if !collect_transparent_spread_event_values(
                    &spread_property.argument,
                    ctx,
                    event_values,
                    visited_objects,
                ) {
                    visited_objects.remove(&object_key);
                    return false;
                }
            }
            ObjectPropertyKind::ObjectProperty(property) => {
                let Some(property_name) = property.key.static_name() else {
                    visited_objects.remove(&object_key);
                    return false;
                };
                let property_name = property_name.to_ascii_lowercase();
                if CONSERVATIVE_SPREAD_PROP_NAMES.contains(&property_name.as_str()) {
                    visited_objects.remove(&object_key);
                    return false;
                }
                if CLICK_HANDLERS.contains(&property_name.as_str())
                    || KEY_HANDLERS.contains(&property_name.as_str())
                {
                    event_values.insert(property_name, &property.value);
                }
            }
        }
    }
    visited_objects.remove(&object_key);
    true
}

fn has_composite_item_role(opening_element: &JSXOpeningElement<'_>) -> bool {
    jsx_attribute(opening_element, "role")
        .and_then(static_attribute_string)
        .and_then(|role| role.split_whitespace().next())
        .is_some_and(|role| {
            COMPOSITE_ITEM_ROLES
                .iter()
                .any(|candidate| role.eq_ignore_ascii_case(candidate))
        })
}

fn static_attribute_string<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(value) => Some(value.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => {
            match container.expression.as_expression()?.get_inner_expression() {
                Expression::StringLiteral(value) => Some(value.value.as_str()),
                Expression::TemplateLiteral(template)
                    if template.expressions.is_empty() && template.quasis.len() == 1 =>
                {
                    Some(template.quasis[0].value.raw.as_str())
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn handler_is_focus_forwarding_or_blocking<'a>(
    expression: Option<&'a Expression<'a>>,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(expression) = expression else {
        return false;
    };
    let Some(handler) =
        resolve_handler_function(expression, opening_node, ctx, &mut HashSet::new())
    else {
        return false;
    };
    let mut call_count = 0;
    let mut blocker_count = 0;
    let mut focus_count = 0;
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if !handler.span.contains_inclusive(candidate.span())
            || nearest_enclosing_function_node_id(candidate.id(), ctx) != Some(handler.node_id)
        {
            continue;
        }
        call_count += 1;
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return false;
        };
        let Some(method_name) = member.static_property_name() else {
            return false;
        };
        if EVENT_BLOCKER_METHOD_NAMES.contains(&method_name) {
            if handler.is_conditional {
                return false;
            }
            blocker_count += 1;
            continue;
        }
        if FOCUS_FORWARDING_METHOD_NAMES.contains(&method_name) {
            if handler.blockers_only {
                return false;
            }
            focus_count += 1;
            continue;
        }
        if method_name == "closest" {
            if handler.blockers_only || !closest_call_is_static_event_target(call) {
                return false;
            }
            continue;
        }
        if matches!(method_name, "getElementById" | "querySelector") {
            if handler.blockers_only || !is_global_document_lookup(call, ctx) {
                return false;
            }
            continue;
        }
        return false;
    }
    call_count > 0 && (focus_count > 0 || blocker_count == call_count)
}

fn resolve_handler_function<'a>(
    expression: &'a Expression<'a>,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HashSet<oxc_semantic::SymbolId>,
) -> Option<HandlerFunction> {
    match expression.get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            let branch = if is_global_nullish_expression(&conditional.consequent, ctx) {
                &conditional.alternate
            } else if is_global_nullish_expression(&conditional.alternate, ctx) {
                &conditional.consequent
            } else {
                return None;
            };
            let mut handler = resolve_handler_function(branch, opening_node, ctx, visited_symbols)?;
            handler.is_conditional = true;
            Some(handler)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(HandlerFunction {
                    node_id: declaration.id(),
                    span: function.body.as_ref()?.span,
                    is_conditional: false,
                    blockers_only: false,
                }),
                AstKind::VariableDeclarator(_) => resolve_handler_function(
                    resolve_direct_unreassigned_initializer(identifier, ctx)?,
                    opening_node,
                    ctx,
                    visited_symbols,
                ),
                _ => None,
            }
        }
        Expression::ArrowFunctionExpression(function) => Some(HandlerFunction {
            node_id: function.node_id.get(),
            span: function.body.span(),
            is_conditional: false,
            blockers_only: false,
        }),
        Expression::FunctionExpression(function) => Some(HandlerFunction {
            node_id: function.node_id.get(),
            span: function.body.as_ref()?.span,
            is_conditional: false,
            blockers_only: false,
        }),
        expression => {
            let member = expression.as_member_expression()?;
            if !matches!(
                member.object().get_inner_expression(),
                Expression::ThisExpression(_)
            ) {
                return None;
            }
            let member_name = member.static_property_name()?;
            let class =
                ctx.nodes()
                    .ancestors(opening_node.id())
                    .find_map(|ancestor| match ancestor.kind() {
                        AstKind::Class(class) => Some(class),
                        _ => None,
                    })?;
            class.body.body.iter().find_map(|element| match element {
                ClassElement::MethodDefinition(method)
                    if method.key.static_name().as_deref() == Some(member_name) =>
                {
                    Some(HandlerFunction {
                        node_id: method.value.node_id.get(),
                        span: method.value.body.as_ref()?.span,
                        is_conditional: false,
                        blockers_only: true,
                    })
                }
                ClassElement::PropertyDefinition(property)
                    if property.key.static_name().as_deref() == Some(member_name) =>
                {
                    match property.value.as_ref()?.get_inner_expression() {
                        Expression::ArrowFunctionExpression(function) => Some(HandlerFunction {
                            node_id: function.node_id.get(),
                            span: function.body.span(),
                            is_conditional: false,
                            blockers_only: true,
                        }),
                        Expression::FunctionExpression(function) => Some(HandlerFunction {
                            node_id: function.node_id.get(),
                            span: function.body.as_ref()?.span,
                            is_conditional: false,
                            blockers_only: true,
                        }),
                        _ => None,
                    }
                }
                _ => None,
            })
        }
    }
}

fn is_global_nullish_expression(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) if identifier.name == "undefined" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none(),
        Expression::UnaryExpression(unary) => unary.operator.is_void(),
        _ => false,
    }
}

fn nearest_enclosing_function_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn closest_call_is_static_event_target(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    if call.arguments.len() != 1
        || !matches!(
            call.arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression),
            Some(Expression::StringLiteral(_))
        )
    {
        return false;
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    member
        .object()
        .get_inner_expression()
        .as_member_expression()
        .and_then(|receiver| receiver.static_property_name())
        == Some("target")
}

fn is_global_document_lookup(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if call.arguments.len() != 1 {
        return false;
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    match member.object().get_inner_expression() {
        Expression::Identifier(identifier) if identifier.name == "document" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none(),
        expression => {
            let Some(document_member) = expression.as_member_expression() else {
                return false;
            };
            if document_member.static_property_name() != Some("document") {
                return false;
            }
            let Expression::Identifier(global) = document_member.object().get_inner_expression()
            else {
                return false;
            };
            matches!(global.name.as_str(), "global" | "globalThis" | "window")
                && ctx
                    .scoping()
                    .get_reference(global.reference_id())
                    .symbol_id()
                    .is_none()
        }
    }
}

fn handler_contains_backdrop_comparison<'a>(
    expression: Option<&'a Expression<'a>>,
    _opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(expression) = expression else {
        return false;
    };
    let Some(handler) = resolve_backdrop_handler_function(expression, ctx) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if !handler.span.contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::BinaryExpression(binary) = candidate.kind() else {
            return false;
        };
        if !matches!(
            binary.operator,
            oxc_syntax::operator::BinaryOperator::Equality
                | oxc_syntax::operator::BinaryOperator::StrictEquality
                | oxc_syntax::operator::BinaryOperator::StrictInequality
        ) {
            return false;
        }
        let property_names = [&binary.left, &binary.right].map(|side| {
            side.get_inner_expression()
                .as_member_expression()
                .and_then(|member| member.static_property_name())
        });
        property_names.contains(&Some("target")) && property_names.contains(&Some("currentTarget"))
    })
}

fn resolve_backdrop_handler_function<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<HandlerFunction> {
    let expression = match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            match ctx.symbol_declaration(symbol_id).kind() {
                AstKind::Function(function) => {
                    return Some(HandlerFunction {
                        node_id: function.node_id.get(),
                        span: function.body.as_ref()?.span,
                        is_conditional: false,
                        blockers_only: false,
                    });
                }
                AstKind::VariableDeclarator(declarator) => {
                    declarator.init.as_ref()?.get_inner_expression()
                }
                _ => return None,
            }
        }
        expression => expression,
    };
    match expression {
        Expression::ArrowFunctionExpression(function) => Some(HandlerFunction {
            node_id: function.node_id.get(),
            span: function.body.span(),
            is_conditional: false,
            blockers_only: false,
        }),
        Expression::FunctionExpression(function) => Some(HandlerFunction {
            node_id: function.node_id.get(),
            span: function.body.as_ref()?.span,
            is_conditional: false,
            blockers_only: false,
        }),
        _ => None,
    }
}

fn has_keyboard_activatable_descendant<'a>(
    element: &JSXElement<'a>,
    expected_action: Option<&'a Expression<'a>>,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root_element_node_id = ctx.nodes().parent_node(opening_node.id()).id();
    let expected_action = match expected_action {
        Some(expression) => {
            let Some(action) = single_handler_action(expression, ctx) else {
                return false;
            };
            Some(action)
        }
        None => None,
    };
    for candidate in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(descendant) = candidate.kind() else {
            continue;
        };
        if candidate.id() == opening_node.id()
            || !element.span.contains_inclusive(descendant.span)
            || !is_reachable_descendant(
                candidate.id(),
                root_element_node_id,
                expected_action.is_some(),
                ctx,
            )
            || !is_keyboard_activatable_element(
                descendant,
                expected_action.is_some(),
                candidate,
                ctx,
            )
        {
            continue;
        }
        let Some(expected_action) = expected_action else {
            return true;
        };
        if hidden_between(candidate.id(), root_element_node_id, ctx) {
            continue;
        }
        for action_name in ["onClick", "onPress"] {
            let Some(action) = jsx_attribute(descendant, action_name)
                .and_then(attribute_expression)
                .and_then(|expression| single_handler_action(expression, ctx))
            else {
                continue;
            };
            if normalized_source(action, ctx) == normalized_source(expected_action, ctx) {
                return true;
            }
        }
    }
    false
}

fn single_handler_action<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => None,
        Expression::Identifier(identifier) if identifier.name == "undefined" => None,
        Expression::ConditionalExpression(conditional) => {
            if is_global_nullish_expression(&conditional.consequent, ctx) {
                single_handler_action(&conditional.alternate, ctx)
            } else if is_global_nullish_expression(&conditional.alternate, ctx) {
                single_handler_action(&conditional.consequent, ctx)
            } else {
                None
            }
        }
        Expression::Identifier(identifier) => {
            if let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) {
                return single_handler_action(initializer, ctx);
            }
            Some(expression)
        }
        Expression::ArrowFunctionExpression(function) => {
            if function.is_expression() {
                return function.get_expression();
            }
            let [statement] = function.get_function_body()?.statements.as_slice() else {
                return None;
            };
            match statement {
                oxc_ast::ast::Statement::ExpressionStatement(statement) => {
                    Some(&statement.expression)
                }
                oxc_ast::ast::Statement::ReturnStatement(statement) => statement.argument.as_ref(),
                _ => None,
            }
        }
        Expression::FunctionExpression(function) => {
            let [statement] = function.body.as_ref()?.statements.as_slice() else {
                return None;
            };
            match statement {
                oxc_ast::ast::Statement::ExpressionStatement(statement) => {
                    Some(&statement.expression)
                }
                oxc_ast::ast::Statement::ReturnStatement(statement) => statement.argument.as_ref(),
                _ => None,
            }
        }
        _ => Some(expression),
    }
}

fn is_reachable_descendant(
    node_id: NodeId,
    root_element_node_id: NodeId,
    has_expected_action: bool,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == root_element_node_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::JSXElement(_) | AstKind::JSXFragment(_)
        ) {
            continue;
        }
        if has_expected_action
            && matches!(
                ancestor.kind(),
                AstKind::JSXExpressionContainer(_)
                    | AstKind::LogicalExpression(_)
                    | AstKind::ConditionalExpression(_)
            )
        {
            continue;
        }
        return false;
    }
    false
}

fn hidden_between(node_id: NodeId, root_id: NodeId, ctx: &LintContext<'_>) -> bool {
    for ancestor in
        std::iter::once(ctx.nodes().get_node(node_id)).chain(ctx.nodes().ancestors(node_id))
    {
        if ancestor.id() == root_id {
            return false;
        }
        let opening_element = match ancestor.kind() {
            AstKind::JSXOpeningElement(opening_element) => Some(opening_element),
            AstKind::JSXElement(element) => Some(element.opening_element.as_ref()),
            _ => None,
        };
        if opening_element.is_some_and(|opening_element| {
            is_hidden_from_screen_reader(ctx, opening_element)
                || potentially_truthy_attribute(opening_element, "hidden")
        }) {
            return true;
        }
    }
    false
}

fn is_keyboard_activatable_element<'a>(
    opening_element: &JSXOpeningElement<'a>,
    requires_accessible_name: bool,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let element_name = flattened_jsx_name(&opening_element.name);
    let Some(element_name) = element_name else {
        return false;
    };
    if HTML_TAG.contains(element_name.as_str()) {
        if !NATIVE_KEYBOARD_ACTIVATABLE_TAGS.contains(&element_name.as_str()) {
            return false;
        }
    } else {
        let starts_uppercase = element_name
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase);
        let lowercase_name = element_name.to_ascii_lowercase();
        let matches_component = if requires_accessible_name {
            ["button", "link", "anchor"]
                .iter()
                .any(|suffix| lowercase_name.ends_with(suffix))
        } else {
            ["button", "link", "nav", "anchor"]
                .iter()
                .any(|marker| lowercase_name.contains(marker))
        };
        if !starts_uppercase || !matches_component {
            return false;
        }
    }
    if !requires_accessible_name {
        return true;
    }
    if element_name == "a" && jsx_attribute(opening_element, "href").is_none() {
        return false;
    }
    if ["disabled", "isDisabled", "aria-disabled"]
        .iter()
        .any(|name| potentially_truthy_attribute(opening_element, name))
        || has_negative_static_tab_index(opening_element)
    {
        return false;
    }
    has_accessible_name_evidence(opening_element, opening_node, ctx)
}

fn flattened_jsx_name(name: &JSXElementName<'_>) -> Option<String> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.to_string()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.to_string()),
        JSXElementName::MemberExpression(member) => {
            let receiver = match &member.object {
                JSXMemberExpressionObject::IdentifierReference(identifier) => {
                    identifier.name.to_string()
                }
                JSXMemberExpressionObject::MemberExpression(member) => {
                    flattened_member_name(member)?
                }
                JSXMemberExpressionObject::ThisExpression(_) => "this".to_string(),
            };
            Some(format!("{receiver}.{}", member.property.name))
        }
        _ => None,
    }
}

fn flattened_member_name(member: &oxc_ast::ast::JSXMemberExpression<'_>) -> Option<String> {
    let receiver = match &member.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => identifier.name.to_string(),
        JSXMemberExpressionObject::MemberExpression(member) => flattened_member_name(member)?,
        JSXMemberExpressionObject::ThisExpression(_) => "this".to_string(),
    };
    Some(format!("{receiver}.{}", member.property.name))
}

fn potentially_truthy_attribute(opening_element: &JSXOpeningElement<'_>, name: &str) -> bool {
    let Some(attribute) = jsx_attribute(opening_element, name) else {
        return false;
    };
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(value)) => {
            value.value == "true"
                || (!name.eq_ignore_ascii_case("aria-hidden") && !value.value.is_empty())
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => match container
            .expression
            .as_expression()
            .map(Expression::get_inner_expression)
        {
            Some(Expression::BooleanLiteral(value)) => value.value,
            Some(Expression::NullLiteral(_)) => false,
            Some(Expression::Identifier(identifier)) if identifier.name == "undefined" => false,
            _ => true,
        },
        Some(_) => true,
    }
}

fn has_negative_static_tab_index(opening_element: &JSXOpeningElement<'_>) -> bool {
    let Some(attribute) = jsx_attribute(opening_element, "tabIndex") else {
        return false;
    };
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(value)) => {
            value.value.parse::<f64>().is_ok_and(|value| value < 0.0)
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => matches!(
            container.expression.as_expression().map(Expression::get_inner_expression),
            Some(Expression::NumericLiteral(value)) if value.value < 0.0
        ),
        _ => false,
    }
}

fn has_accessible_name_evidence(
    opening_element: &JSXOpeningElement<'_>,
    opening_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if ["aria-label", "aria-labelledby"]
        .iter()
        .any(|name| jsx_attribute(opening_element, name).is_some_and(attribute_may_be_nonempty))
    {
        return true;
    }
    let parent = ctx.nodes().parent_node(opening_node.id());
    let AstKind::JSXElement(element) = parent.kind() else {
        return false;
    };
    element
        .children
        .iter()
        .any(|child| child_may_provide_accessible_name(child, ctx))
}

fn attribute_may_be_nonempty(attribute: &JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(value)) => !value.value.trim().is_empty(),
        Some(JSXAttributeValue::ExpressionContainer(container)) => match container
            .expression
            .as_expression()
            .map(Expression::get_inner_expression)
        {
            Some(Expression::StringLiteral(value)) => !value.value.trim().is_empty(),
            Some(Expression::NullLiteral(_)) => false,
            Some(Expression::Identifier(identifier)) if identifier.name == "undefined" => false,
            Some(_) => true,
            None => false,
        },
        Some(_) => true,
        None => false,
    }
}

fn child_may_provide_accessible_name(child: &JSXChild<'_>, ctx: &LintContext<'_>) -> bool {
    match child {
        JSXChild::Text(text) => !text.value.trim().is_empty(),
        JSXChild::Element(element) => {
            ["aria-label", "aria-labelledby"].iter().any(|name| {
                jsx_attribute(&element.opening_element, name).is_some_and(attribute_may_be_nonempty)
            }) || element
                .children
                .iter()
                .any(|child| child_may_provide_accessible_name(child, ctx))
        }
        JSXChild::Fragment(fragment) => fragment
            .children
            .iter()
            .any(|child| child_may_provide_accessible_name(child, ctx)),
        JSXChild::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            !is_global_nullish_expression(expression, ctx)
                && !matches!(
                    expression.get_inner_expression(),
                    Expression::BooleanLiteral(_)
                )
        }
        JSXChild::Spread(_) => false,
    }
}

fn normalized_source(span: &Expression<'_>, ctx: &LintContext<'_>) -> String {
    ctx.source_range(span.span())
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}
