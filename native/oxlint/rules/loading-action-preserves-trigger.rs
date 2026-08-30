use oxc_ast::{
    ast::{
        BindingPattern, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        JSXChild, JSXElement, JSXExpression, JSXFragment, JSXOpeningElement,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    globals::VALID_ARIA_ROLES,
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "This pending branch replaces the control that started the request with passive content, so the control and its focus disappear while the request is in flight. Keep the control mounted and render its busy state inside it.";
const ACTION_INPUT_TYPES: [&str; 3] = ["button", "image", "submit"];
const NON_SUBMITTING_BUTTON_TYPES: [&str; 2] = ["button", "reset"];
const PASSIVE_INTRINSIC_TAG_NAMES: [&str; 37] = [
    "article",
    "aside",
    "b",
    "blockquote",
    "code",
    "dd",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "i",
    "li",
    "main",
    "mark",
    "ol",
    "output",
    "p",
    "pre",
    "progress",
    "s",
    "section",
    "small",
    "span",
    "strong",
    "time",
    "u",
    "ul",
];
const INTERACTIVE_ROLES: [&str; 24] = [
    "button",
    "checkbox",
    "combobox",
    "gridcell",
    "link",
    "listbox",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "radio",
    "scrollbar",
    "searchbox",
    "slider",
    "spinbutton",
    "switch",
    "tab",
    "textbox",
    "treeitem",
    "columnheader",
    "rowheader",
    "row",
    "grid",
    "treegrid",
];
const NON_INTERACTIVE_ROLES: [&str; 38] = [
    "alert",
    "alertdialog",
    "application",
    "article",
    "banner",
    "cell",
    "complementary",
    "contentinfo",
    "definition",
    "dialog",
    "directory",
    "document",
    "feed",
    "figure",
    "form",
    "group",
    "heading",
    "img",
    "list",
    "listitem",
    "log",
    "main",
    "marquee",
    "math",
    "menu",
    "menubar",
    "navigation",
    "none",
    "note",
    "presentation",
    "progressbar",
    "region",
    "rowgroup",
    "separator",
    "status",
    "table",
    "term",
    "timer",
];
const PASSIVITY_UNKNOWN_ATTRIBUTE_NAMES: [&str; 6] = [
    "accesskey",
    "children",
    "dangerouslysetinnerhtml",
    "draggable",
    "htmlfor",
    "ref",
];

struct PendingStateProof<'a> {
    idle_branch: &'a Expression<'a>,
    pending_branch: &'a Expression<'a>,
    setter_symbol_id: SymbolId,
}

#[derive(Debug, Default, Clone)]
pub struct LoadingActionPreservesTrigger;

declare_oxc_lint!(
    /// Keep a request-triggering control mounted while its action is pending.
    LoadingActionPreservesTrigger,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Keep a loading action's trigger mounted.",
);

impl Rule for LoadingActionPreservesTrigger {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ConditionalExpression(conditional) = node.kind() else {
            return;
        };
        if !loading_action_is_directly_rendered(node, ctx) {
            return;
        }
        let Some(state_proof) = loading_action_pending_state_proof(conditional, node, ctx) else {
            return;
        };
        let Some(action_opening) = loading_action_opening_element(state_proof.idle_branch, ctx)
        else {
            return;
        };
        if loading_action_branch_is_passive(state_proof.pending_branch, ctx) != Some(true) {
            return;
        }
        let action_root = resolve_jsx_element_type_name(action_opening, ctx).to_ascii_lowercase();
        if loading_action_branch_root_identity(state_proof.pending_branch, ctx).as_deref()
            == Some(action_root.as_str())
        {
            return;
        }
        let Some(handler_node) = loading_action_handler(action_opening, ctx) else {
            return;
        };
        if loading_action_handler_transfers_focus_or_navigates(handler_node, ctx)
            || !loading_action_handler_starts_before_fetch(
                handler_node,
                state_proof.setter_symbol_id,
                ctx,
            )
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(conditional.span));
    }
}

fn loading_action_is_directly_rendered<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::ReturnStatement(statement) => statement
            .argument
            .as_ref()
            .is_some_and(|argument| argument.span() == expression_root.span()),
        AstKind::ArrowFunctionExpression(function) => function
            .get_expression()
            .is_some_and(|expression| expression.span() == expression_root.span()),
        AstKind::JSXExpressionContainer(container) => {
            container
                .expression
                .as_expression()
                .is_some_and(|expression| expression.span() == expression_root.span())
                && matches!(
                    ctx.nodes().parent_node(parent.id()).kind(),
                    AstKind::JSXElement(_) | AstKind::JSXFragment(_)
                )
        }
        _ => false,
    }
}

fn loading_action_pending_state_proof<'a>(
    conditional: &'a oxc_ast::ast::ConditionalExpression<'a>,
    conditional_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<PendingStateProof<'a>> {
    let (state_reference, is_negated) = match conditional.test.get_inner_expression() {
        Expression::Identifier(identifier) => (identifier, false),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            let Expression::Identifier(identifier) = unary.argument.get_inner_expression() else {
                return None;
            };
            (identifier, true)
        }
        _ => return None,
    };
    let state_symbol_id = ctx
        .scoping()
        .get_reference(state_reference.reference_id())
        .symbol_id()?;
    let mut state_references = ctx.scoping().get_resolved_references(state_symbol_id);
    if state_references.next()?.node_id() != state_reference.node_id()
        || state_references.next().is_some()
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(state_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return None;
    }
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    if pattern.elements.len() != 2 || pattern.rest.is_some() {
        return None;
    }
    let state_binding = pattern
        .elements
        .first()
        .and_then(Option::as_ref)
        .and_then(BindingPattern::get_binding_identifier)?;
    let setter_binding = pattern
        .elements
        .get(1)
        .and_then(Option::as_ref)
        .and_then(BindingPattern::get_binding_identifier)?;
    if state_binding.symbol_id() != state_symbol_id {
        return None;
    }
    let Expression::CallExpression(initializer) = declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    if initializer.arguments.len() != 1
        || !is_react_api_call(initializer, "useState", ctx)
        || !matches!(
            initializer.arguments[0]
                .as_expression()
                .map(Expression::get_inner_expression),
            Some(Expression::BooleanLiteral(initial)) if !initial.value
        )
    {
        return None;
    }
    let state_function = crate::ast_util::get_enclosing_function(declaration, ctx)?;
    let conditional_function = crate::ast_util::get_enclosing_function(conditional_node, ctx)?;
    if state_function.id() != conditional_function.id() {
        return None;
    }
    Some(PendingStateProof {
        idle_branch: if is_negated {
            &conditional.consequent
        } else {
            &conditional.alternate
        },
        pending_branch: if is_negated {
            &conditional.alternate
        } else {
            &conditional.consequent
        },
        setter_symbol_id: setter_binding.symbol_id(),
    })
}

fn loading_action_opening_element<'a>(
    branch: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a JSXOpeningElement<'a>> {
    let Expression::JSXElement(element) = branch.get_inner_expression() else {
        return None;
    };
    let opening = &element.opening_element;
    if !is_proven_intrinsic_jsx_element(opening, ctx) || has_any_jsx_spread_attribute(opening) {
        return None;
    }
    let tag_name = resolve_jsx_element_type_name(opening, ctx).to_ascii_lowercase();
    if tag_name == "button" {
        return Some(opening);
    }
    if tag_name != "input" {
        return None;
    }
    loading_action_static_attribute_string(opening, "type")
        .is_some_and(|input_type| {
            ACTION_INPUT_TYPES.contains(&input_type.to_ascii_lowercase().as_str())
        })
        .then_some(opening)
}

fn loading_action_static_attribute_string<'a>(
    opening: &'a JSXOpeningElement<'a>,
    attribute_name: &str,
) -> Option<&'a str> {
    let attribute = get_authoritative_jsx_attribute(opening, attribute_name, false)?;
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(literal) => Some(literal.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => {
            match container.expression.as_expression()?.get_inner_expression() {
                Expression::StringLiteral(literal) => Some(literal.value.as_str()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn loading_action_branch_is_passive<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::NumericLiteral(_) => Some(true),
        Expression::JSXElement(element) => loading_action_element_is_passive(element, ctx),
        Expression::JSXFragment(fragment) => loading_action_fragment_is_passive(fragment, ctx),
        _ => None,
    }
}

fn loading_action_fragment_is_passive<'a>(
    fragment: &JSXFragment<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    for child in &fragment.children {
        let child_proof = loading_action_child_is_passive(child, ctx);
        if child_proof != Some(true) {
            return child_proof;
        }
    }
    Some(true)
}

fn loading_action_child_is_passive<'a>(
    child: &JSXChild<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    match child {
        JSXChild::Text(_) => Some(true),
        JSXChild::Spread(_) => None,
        JSXChild::Element(element) => loading_action_element_is_passive(element, ctx),
        JSXChild::Fragment(fragment) => loading_action_fragment_is_passive(fragment, ctx),
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::EmptyExpression(_)
            | JSXExpression::NullLiteral(_)
            | JSXExpression::BooleanLiteral(_)
            | JSXExpression::StringLiteral(_)
            | JSXExpression::NumericLiteral(_) => Some(true),
            expression => expression
                .as_expression()
                .and_then(|expression| loading_action_branch_is_passive(expression, ctx)),
        },
    }
}

fn loading_action_element_is_passive<'a>(
    element: &JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let opening = &element.opening_element;
    if !is_proven_intrinsic_jsx_element(opening, ctx) || has_any_jsx_spread_attribute(opening) {
        return None;
    }
    let tag_name = resolve_jsx_element_type_name(opening, ctx).to_ascii_lowercase();
    if loading_action_intrinsic_is_interactive(opening, &tag_name) {
        return Some(false);
    }
    if !PASSIVE_INTRINSIC_TAG_NAMES.contains(&tag_name.as_str()) {
        return None;
    }
    let role = loading_action_static_role(opening)?;
    if role
        .as_ref()
        .is_some_and(|role| INTERACTIVE_ROLES.contains(&role.as_str()))
    {
        return Some(false);
    }
    if role.as_ref().is_some_and(|role| {
        !NON_INTERACTIVE_ROLES.contains(&role.as_str())
            && !matches!(role.as_str(), "none" | "presentation")
    }) {
        return None;
    }
    for attribute in &opening.attributes {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            return None;
        };
        let normalized_name = name.name.to_ascii_lowercase();
        if PASSIVITY_UNKNOWN_ATTRIBUTE_NAMES.contains(&normalized_name.as_str()) {
            return None;
        }
        if name.name.starts_with("on")
            && name
                .name
                .as_bytes()
                .get(2)
                .is_some_and(u8::is_ascii_uppercase)
            && !loading_action_attribute_is_static_null(attribute)
        {
            return Some(false);
        }
        if matches!(
            normalized_name.as_str(),
            "tabindex" | "contenteditable" | "autofocus"
        ) {
            return Some(false);
        }
    }
    for child in &element.children {
        let child_proof = loading_action_child_is_passive(child, ctx);
        if child_proof != Some(true) {
            return child_proof;
        }
    }
    Some(true)
}

fn loading_action_attribute_is_static_null(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    matches!(
        attribute.value.as_ref(),
        Some(JSXAttributeValue::ExpressionContainer(container))
            if matches!(container.expression.as_expression().map(Expression::get_inner_expression), Some(Expression::NullLiteral(_)))
    )
}

fn loading_action_static_role<'a>(opening: &'a JSXOpeningElement<'a>) -> Option<Option<String>> {
    if get_authoritative_jsx_attribute(opening, "role", false).is_none() {
        return Some(None);
    }
    let role = loading_action_static_attribute_string(opening, "role")?;
    role.split_ascii_whitespace()
        .map(|role| role.to_ascii_lowercase())
        .find(|role| VALID_ARIA_ROLES.contains(role.as_str()))
        .map(Some)
}

fn loading_action_intrinsic_is_interactive(
    opening: &JSXOpeningElement<'_>,
    tag_name: &str,
) -> bool {
    match tag_name {
        "button" | "select" | "textarea" => true,
        "a" | "area" => get_authoritative_jsx_attribute(opening, "href", false).is_some(),
        "input" => loading_action_static_attribute_string(opening, "type")
            .is_none_or(|input_type| !input_type.eq_ignore_ascii_case("hidden")),
        "audio" | "video" => get_authoritative_jsx_attribute(opening, "controls", false).is_some(),
        _ => false,
    }
}

fn loading_action_branch_root_identity<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::JSXFragment(_) => Some("#fragment".to_string()),
        Expression::JSXElement(element)
            if is_proven_intrinsic_jsx_element(&element.opening_element, ctx) =>
        {
            Some(resolve_jsx_element_type_name(&element.opening_element, ctx).to_ascii_lowercase())
        }
        _ => None,
    }
}

fn loading_action_handler<'a, 'b>(
    opening: &'b JSXOpeningElement<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    if loading_action_static_disabled_state(opening, "disabled") != Some(false)
        || loading_action_static_disabled_state(opening, "aria-disabled") != Some(false)
        || loading_action_may_submit_form(opening, ctx)
    {
        return None;
    }
    let attribute = get_authoritative_jsx_attribute(opening, "onClick", true)?;
    let expression = jsx_attribute_expression(attribute)?.get_inner_expression();
    match expression {
        Expression::ArrowFunctionExpression(function) => {
            Some(ctx.nodes().get_node(function.node_id.get()))
        }
        Expression::FunctionExpression(function) => {
            Some(ctx.nodes().get_node(function.node_id.get()))
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let mut references = ctx.scoping().get_resolved_references(symbol_id);
            if references.next()?.node_id() != identifier.node_id() || references.next().is_some() {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(ctx.nodes().get_node(function.node_id.get())),
                AstKind::VariableDeclarator(declarator) => {
                    if !matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) {
                        return None;
                    }
                    match declarator.init.as_ref()?.get_inner_expression() {
                        Expression::ArrowFunctionExpression(function) => {
                            Some(ctx.nodes().get_node(function.node_id.get()))
                        }
                        Expression::FunctionExpression(function) => {
                            Some(ctx.nodes().get_node(function.node_id.get()))
                        }
                        _ => None,
                    }
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn loading_action_static_disabled_state(
    opening: &JSXOpeningElement<'_>,
    attribute_name: &str,
) -> Option<bool> {
    let Some(attribute) = get_authoritative_jsx_attribute(opening, attribute_name, false) else {
        return Some(false);
    };
    let Some(value) = &attribute.value else {
        return Some(true);
    };
    let expression = match value {
        JSXAttributeValue::StringLiteral(literal) => {
            if attribute_name == "disabled" {
                return Some(true);
            }
            return match literal.value.to_ascii_lowercase().as_str() {
                "false" => Some(false),
                "true" => Some(true),
                _ => None,
            };
        }
        JSXAttributeValue::ExpressionContainer(container) => {
            container.expression.as_expression()?.get_inner_expression()
        }
        _ => return None,
    };
    match expression {
        Expression::NullLiteral(_) => Some(false),
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::StringLiteral(_) if attribute_name == "disabled" => Some(true),
        Expression::StringLiteral(literal) => match literal.value.to_ascii_lowercase().as_str() {
            "false" => Some(false),
            "true" => Some(true),
            _ => None,
        },
        Expression::NumericLiteral(literal) if attribute_name == "disabled" => {
            Some(literal.value != 0.0)
        }
        _ => None,
    }
}

fn loading_action_may_submit_form<'a>(
    opening: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let tag_name = resolve_jsx_element_type_name(opening, ctx).to_ascii_lowercase();
    let action_type = loading_action_static_attribute_string(opening, "type")
        .map(|value| value.to_ascii_lowercase());
    let is_submit_capable = if tag_name == "button" {
        !action_type
            .as_deref()
            .is_some_and(|action_type| NON_SUBMITTING_BUTTON_TYPES.contains(&action_type))
    } else {
        tag_name == "input"
            && action_type
                .as_deref()
                .is_some_and(|action_type| matches!(action_type, "image" | "submit"))
    };
    if !is_submit_capable {
        return false;
    }
    if get_authoritative_jsx_attribute(opening, "form", false).is_some() {
        return true;
    }
    for ancestor in ctx.nodes().ancestors(opening.node_id.get()) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        if !is_proven_intrinsic_jsx_element(&element.opening_element, ctx) {
            return true;
        }
        if resolve_jsx_element_type_name(&element.opening_element, ctx).eq_ignore_ascii_case("form")
        {
            return true;
        }
    }
    false
}

fn loading_action_handler_transfers_focus_or_navigates(
    handler: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !handler.span().contains_inclusive(candidate.span())
            || crate::ast_util::get_enclosing_function(candidate, ctx)
                .is_none_or(|function| function.id() != handler.id())
        {
            return false;
        }
        match candidate.kind() {
            AstKind::CallExpression(call) => match call.callee.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    matches!(identifier.name.as_str(), "navigate" | "redirect")
                        || identifier.name.eq_ignore_ascii_case("setFocus")
                }
                expression => expression.as_member_expression().is_some_and(|member| {
                    matches!(
                        member.static_property_name(),
                        Some(
                            "blur"
                                | "focus"
                                | "assign"
                                | "back"
                                | "forward"
                                | "go"
                                | "open"
                                | "push"
                                | "reload"
                                | "replace"
                                | "requestSubmit"
                                | "submit"
                                | "navigate"
                        )
                    )
                }),
            },
            AstKind::AssignmentExpression(assignment) => assignment
                .left
                .as_member_expression()
                .and_then(|member| member.static_property_name())
                .is_some_and(|property| matches!(property, "href" | "location")),
            _ => false,
        }
    })
}

fn loading_action_handler_starts_before_fetch(
    handler: &AstNode<'_>,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if !matches!(
        handler.kind(),
        AstKind::Function(function) if function.r#async
    ) && !matches!(
        handler.kind(),
        AstKind::ArrowFunctionExpression(function) if function.r#async
    ) {
        return false;
    }
    let mut setter_calls = Vec::new();
    for reference in ctx.scoping().get_resolved_references(setter_symbol_id) {
        if reference.is_write() {
            return false;
        }
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let reference_root = transparent_expression_root(reference_node, ctx);
        let parent = ctx.nodes().parent_node(reference_root.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        if call.callee.span() != reference_root.span()
            || call.arguments.len() != 1
            || crate::ast_util::get_enclosing_function(parent, ctx)
                .is_none_or(|function| function.id() != handler.id())
        {
            return false;
        }
        let Some(Expression::BooleanLiteral(value)) = call
            .arguments
            .first()
            .and_then(|argument| argument.as_expression())
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        setter_calls.push((parent, value.value));
    }
    let mut truthy_calls = setter_calls.iter().filter(|(_, value)| *value);
    let Some((truthy_call, _)) = truthy_calls.next() else {
        return false;
    };
    if truthy_calls.next().is_some()
        || !matches!(
            ctx.nodes().parent_node(truthy_call.id()).kind(),
            AstKind::ExpressionStatement(_)
        )
    {
        return false;
    }
    ctx.nodes().iter().any(|candidate| {
        if !handler.span().contains_inclusive(candidate.span())
            || candidate.span().start <= truthy_call.span().start
            || crate::ast_util::get_enclosing_function(candidate, ctx)
                .is_none_or(|function| function.id() != handler.id())
        {
            return false;
        }
        let AstKind::AwaitExpression(suspension) = candidate.kind() else {
            return false;
        };
        let Expression::CallExpression(fetch_call) = suspension.argument.get_inner_expression()
        else {
            return false;
        };
        let Expression::Identifier(fetch) = fetch_call.callee.get_inner_expression() else {
            return false;
        };
        if fetch.name != "fetch"
            || !ctx.is_reference_to_global_variable(fetch)
            || !is_node_reachable_within_function(candidate, handler, ctx)
            || ctx.nodes().cfg_id(truthy_call.id()) != ctx.nodes().cfg_id(candidate.id())
        {
            return false;
        }
        setter_calls
            .iter()
            .filter(|(setter_call, _)| {
                setter_call.span().start < candidate.span().start
                    && nodes_can_co_execute(setter_call, candidate, ctx)
            })
            .max_by_key(|(setter_call, _)| setter_call.span().start)
            .is_some_and(|(setter_call, _)| setter_call.id() == truthy_call.id())
    })
}
