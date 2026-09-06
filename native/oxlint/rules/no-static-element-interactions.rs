use std::collections::HashSet;

use oxc_ast::{
    AstKind,
    ast::{
        ChainElement, ClassElement, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue,
        JSXChild, JSXElementName, JSXExpression, JSXMemberExpressionObject, JSXOpeningElement,
        ObjectPropertyKind, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
    utils::{
        has_jsx_prop_ignore_case, is_abstract_role, is_interactive_element, is_interactive_role,
        is_non_interactive_element, is_non_interactive_role, is_presentation_role,
    },
};

const MESSAGE: &str = "Screen reader users can't tell this click handler is interactive because it has no `role`, so add a `role` or use a button or link.";
const DEFAULT_HANDLERS: [&str; 6] = [
    "onclick",
    "onmousedown",
    "onmouseup",
    "onkeypress",
    "onkeydown",
    "onkeyup",
];
const KEYBOARD_HANDLERS: [&str; 3] = ["onkeypress", "onkeydown", "onkeyup"];
const EVENT_BLOCKER_METHODS: [&str; 3] = [
    "stopPropagation",
    "preventDefault",
    "stopImmediatePropagation",
];
const FOCUS_FORWARDING_METHODS: [&str; 2] = ["focus", "select"];
const NATIVE_KEYBOARD_ACTIVATABLE_TAGS: [&str; 6] =
    ["a", "button", "input", "select", "summary", "textarea"];

#[derive(Debug, Default, Clone)]
pub struct NoStaticElementInteractions;

#[derive(Clone, Copy)]
struct HandlerFunction {
    node_id: NodeId,
    is_conditional: bool,
    blockers_only: bool,
}

declare_oxc_lint!(
    /// Require static elements with interaction handlers to expose semantics.
    NoStaticElementInteractions,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require roles on interactive static elements.",
);

impl Rule for NoStaticElementInteractions {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && (!should_use_curated_port_behavior_host(ctx) || !is_non_production_file(ctx))
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let handlers = configured_handlers(ctx);
        let allow_expression_values = allow_expression_values(ctx);
        let mut opening_nodes: Vec<_> = ctx
            .nodes()
            .iter()
            .filter(|node| matches!(node.kind(), AstKind::JSXOpeningElement(_)))
            .collect();
        opening_nodes.sort_unstable_by_key(|node| node.span().start);
        for node in &opening_nodes {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            no_static_element_interactions_check(
                node,
                opening_element,
                &handlers,
                allow_expression_values,
                &opening_nodes,
                ctx,
            );
        }
    }
}

fn configured_handlers<'a>(ctx: &'a LintContext<'_>) -> Vec<String> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("noStaticElementInteractions"))
        .and_then(|settings| settings.get("handlers"))
        .and_then(serde_json::Value::as_array)
        .map(|handlers| {
            handlers
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_ascii_lowercase)
                .collect()
        })
        .unwrap_or_else(|| DEFAULT_HANDLERS.iter().map(ToString::to_string).collect())
}

fn allow_expression_values(ctx: &LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("noStaticElementInteractions"))
        .and_then(|settings| settings.get("allowExpressionValues"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true)
}

#[allow(clippy::too_many_arguments)]
fn no_static_element_interactions_check<'a>(
    node: &AstNode<'a>,
    opening_element: &'a JSXOpeningElement<'a>,
    handlers: &[String],
    allow_expression_values: bool,
    opening_nodes: &[&AstNode<'a>],
    ctx: &LintContext<'a>,
) {
    let mut seen_handlers = HashSet::new();
    let mut active_handlers = Vec::new();
    for item in &opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = item else {
            continue;
        };
        let oxc_ast::ast::JSXAttributeName::Identifier(name) = &attribute.name else {
            continue;
        };
        let handler_name = name.name.to_ascii_lowercase();
        if !handlers
            .iter()
            .any(|configured| configured == &handler_name)
            || !seen_handlers.insert(handler_name.clone())
            || is_null_handler(attribute)
            || (should_use_curated_port_behavior(ctx)
                && KEYBOARD_HANDLERS.contains(&handler_name.as_str())
                && !is_direct_keyboard_target(opening_element, handlers))
        {
            continue;
        }
        active_handlers.push((handler_name, attribute));
    }
    if active_handlers.is_empty() {
        return;
    }
    let non_blockers: Vec<_> = active_handlers
        .iter()
        .filter(|(_, attribute)| !is_pure_event_blocker(attribute, node, ctx))
        .collect();
    if non_blockers.is_empty() {
        return;
    }
    if non_blockers.len() == 1 && non_blockers[0].0 == "onclick" {
        let click_attribute = non_blockers[0].1;
        if handler_is_focus_forwarding(click_attribute, node, ctx)
            || has_equivalent_keyboard_descendant(click_attribute, node, opening_nodes, ctx)
        {
            return;
        }
    }
    let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
    if !HTML_TAG.contains(element_type.as_str())
        || element_type == "svg"
        || is_statically_hidden_from_screen_reader(opening_element, ctx)
        || is_presentation_role(opening_element)
        || is_interactive_element(&element_type, opening_element)
        || is_non_interactive_element(&element_type, opening_element)
        || is_abstract_role(ctx, opening_element)
    {
        return;
    }
    let Some(JSXAttributeItem::Attribute(role_attribute)) =
        has_jsx_prop_ignore_case(opening_element, "role")
    else {
        report(opening_element, ctx);
        return;
    };
    let Some(role_value) = role_attribute.value.as_ref() else {
        report(opening_element, ctx);
        return;
    };
    match role_value {
        JSXAttributeValue::StringLiteral(value) => {
            if !is_recognized_role(value.value.as_str()) {
                report(opening_element, ctx);
            }
        }
        JSXAttributeValue::ExpressionContainer(container) => {
            if !allow_expression_values {
                report(opening_element, ctx);
                return;
            }
            let Some(expression) = container.expression.as_expression() else {
                report(opening_element, ctx);
                return;
            };
            match expression.get_inner_expression() {
                Expression::StringLiteral(value) => {
                    if !is_recognized_role(value.value.as_str()) {
                        report(opening_element, ctx);
                    }
                }
                expression if is_static_role_nullish(expression) => {
                    report(opening_element, ctx);
                }
                Expression::ConditionalExpression(conditional) => {
                    let branches = [&conditional.consequent, &conditional.alternate];
                    if branches
                        .iter()
                        .all(|branch| static_role_branch(branch).is_some())
                        && !branches.iter().any(|branch| {
                            static_role_branch(branch)
                                .flatten()
                                .is_some_and(is_recognized_role)
                        })
                    {
                        report(opening_element, ctx);
                    }
                }
                _ => {}
            }
        }
        _ => report(opening_element, ctx),
    }
}

fn report(opening_element: &JSXOpeningElement<'_>, ctx: &LintContext<'_>) {
    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
}

fn is_null_handler(attribute: &JSXAttribute<'_>) -> bool {
    matches!(
        attribute.value.as_ref(),
        Some(JSXAttributeValue::ExpressionContainer(container))
            if matches!(container.expression, JSXExpression::NullLiteral(_))
    )
}

fn is_direct_keyboard_target(opening_element: &JSXOpeningElement<'_>, handlers: &[String]) -> bool {
    if has_jsx_prop_ignore_case(opening_element, "tabIndex").is_some()
        || has_jsx_prop_ignore_case(opening_element, "contentEditable").is_some()
    {
        return true;
    }
    opening_element.attributes.iter().any(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return false;
        };
        let oxc_ast::ast::JSXAttributeName::Identifier(name) = &attribute.name else {
            return false;
        };
        let name = name.name.to_ascii_lowercase();
        !KEYBOARD_HANDLERS.contains(&name.as_str())
            && handlers.iter().any(|handler| handler == &name)
            && !is_null_handler(attribute)
    })
}

fn is_recognized_role(role: &str) -> bool {
    role.trim()
        .split_whitespace()
        .next()
        .map(str::to_ascii_lowercase)
        .is_some_and(|role| is_interactive_role(&role) || is_non_interactive_role(&role))
}

fn static_role_branch<'a>(expression: &'a Expression<'a>) -> Option<Option<&'a str>> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(value) => Some(Some(value.value.as_str())),
        expression if is_static_role_nullish(expression) => Some(None),
        _ => None,
    }
}

fn is_static_role_nullish(expression: &Expression<'_>) -> bool {
    matches!(expression, Expression::NullLiteral(_))
        || matches!(expression, Expression::UnaryExpression(unary) if unary.operator.is_void())
        || matches!(expression, Expression::Identifier(identifier) if identifier.name == "undefined")
}

fn is_static_nullish_expression(expression: &Expression<'_>, _ctx: &LintContext<'_>) -> bool {
    matches!(expression, Expression::NullLiteral(_))
        || matches!(expression, Expression::UnaryExpression(unary) if unary.operator.is_void())
        || matches!(expression, Expression::Identifier(identifier) if identifier.name == "undefined")
}

fn is_global_nullish_expression(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(expression, Expression::NullLiteral(_))
        || matches!(expression, Expression::UnaryExpression(unary) if unary.operator.is_void())
        || matches!(
            expression,
            Expression::Identifier(identifier)
                if identifier.name == "undefined"
                    && ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none()
        )
}

fn attribute_expression<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a Expression<'a>> {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref() else {
        return None;
    };
    container.expression.as_expression()
}

fn handler_is_focus_forwarding<'a>(
    attribute: &'a JSXAttribute<'a>,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(expression) = attribute_expression(attribute) else {
        return false;
    };
    let Some(handler) =
        resolve_handler_function(expression, opening_node, ctx, &mut HashSet::new())
    else {
        return false;
    };
    if handler.blockers_only {
        return false;
    }
    let handler_node = ctx.nodes().get_node(handler.node_id);
    match handler_node.kind() {
        AstKind::ArrowFunctionExpression(function) => function.get_expression().map_or_else(
            || {
                function.body.as_function_body().is_some_and(|body| {
                    focus_forwarding_statements_are_allowed(
                        &body.statements,
                        ctx,
                        !handler.is_conditional,
                    )
                })
            },
            |expression| is_allowed_focus_forwarding_call(expression, !handler.is_conditional),
        ),
        AstKind::Function(function) => function.body.as_ref().is_some_and(|body| {
            focus_forwarding_statements_are_allowed(&body.statements, ctx, !handler.is_conditional)
        }),
        _ => false,
    }
}

fn focus_forwarding_statements_are_allowed(
    statements: &[Statement<'_>],
    ctx: &LintContext<'_>,
    allow_event_blocker: bool,
) -> bool {
    if statements.is_empty() {
        return false;
    }
    let first_action_index = usize::from(is_event_target_closest_return_guard(&statements[0]));
    if first_action_index > 0 && statements.len() != 3 {
        return false;
    }
    if let Some(variable_name) = statements
        .get(first_action_index)
        .and_then(|statement| dom_lookup_variable_name(statement, ctx))
    {
        return statements.len() == first_action_index + 2
            && statements
                .get(first_action_index + 1)
                .is_some_and(|statement| is_focus_call_on_variable(statement, variable_name));
    }
    if first_action_index > 0 {
        return false;
    }
    statements.iter().all(|statement| {
        let Statement::ExpressionStatement(statement) = statement else {
            return false;
        };
        is_allowed_focus_forwarding_call(&statement.expression, allow_event_blocker)
    })
}

fn is_allowed_focus_forwarding_call(
    expression: &Expression<'_>,
    allow_event_blocker: bool,
) -> bool {
    let Some(call) = unwrapped_call_expression(expression) else {
        return false;
    };
    call.callee
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member| {
            !member.is_computed()
                && member.static_property_name().is_some_and(|method_name| {
                    FOCUS_FORWARDING_METHODS.contains(&method_name)
                        || (allow_event_blocker && EVENT_BLOCKER_METHODS.contains(&method_name))
                })
        })
}

fn dom_lookup_variable_name<'a>(
    statement: &'a Statement<'a>,
    ctx: &LintContext<'_>,
) -> Option<&'a str> {
    let Statement::VariableDeclaration(declaration) = statement else {
        return None;
    };
    if !declaration.kind.is_const() || declaration.declarations.len() != 1 {
        return None;
    }
    let declarator = &declaration.declarations[0];
    let variable_name = declarator.id.get_binding_identifier()?.name.as_str();
    let Expression::CallExpression(call) = declarator.init.as_ref()?.get_inner_expression() else {
        return None;
    };
    if !is_document_lookup(call, ctx) || !call_argument_is_static_selector(call) {
        return None;
    }
    Some(variable_name)
}

fn call_argument_is_static_selector(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    call.arguments.len() == 1
        && call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_some_and(is_static_selector_expression)
}

fn is_static_selector_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(_) | Expression::StringLiteral(_) => true,
        Expression::TemplateLiteral(template) => template
            .expressions
            .iter()
            .all(is_static_selector_expression),
        _ => false,
    }
}

fn is_focus_call_on_variable(statement: &Statement<'_>, variable_name: &str) -> bool {
    let Statement::ExpressionStatement(statement) = statement else {
        return false;
    };
    let Some(call) = unwrapped_call_expression(&statement.expression) else {
        return false;
    };
    if !call.arguments.is_empty() {
        return false;
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    member.static_property_name() == Some("focus")
        && matches!(
            member.object().get_inner_expression(),
            Expression::Identifier(identifier) if identifier.name == variable_name
        )
}

fn is_event_target_closest_return_guard(statement: &Statement<'_>) -> bool {
    let Statement::IfStatement(if_statement) = statement else {
        return false;
    };
    if if_statement.alternate.is_some() || !is_empty_return_statement(&if_statement.consequent) {
        return false;
    }
    let Some(call) = unwrapped_call_expression(&if_statement.test) else {
        return false;
    };
    if !call_argument_is_string_literal(call) {
        return false;
    }
    let Some(closest_member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if closest_member.static_property_name() != Some("closest") {
        return false;
    }
    let Some(target_member) = closest_member
        .object()
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    target_member.static_property_name() == Some("target")
        && matches!(
            target_member.object().get_inner_expression(),
            Expression::Identifier(_)
        )
}

fn call_argument_is_string_literal(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    call.arguments.len() == 1
        && matches!(
            call.arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression),
            Some(Expression::StringLiteral(_))
        )
}

fn is_empty_return_statement(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ReturnStatement(statement) => statement.argument.is_none(),
        Statement::BlockStatement(block) => matches!(
            block.body.as_slice(),
            [Statement::ReturnStatement(statement)] if statement.argument.is_none()
        ),
        _ => false,
    }
}

fn unwrapped_call_expression<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => Some(call),
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::CallExpression(call) => Some(call),
            ChainElement::TSNonNullExpression(non_null) => {
                unwrapped_call_expression(&non_null.expression)
            }
            _ => None,
        },
        _ => None,
    }
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
                AstKind::Function(_) => Some(HandlerFunction {
                    node_id: declaration.id(),
                    is_conditional: false,
                    blockers_only: false,
                }),
                AstKind::VariableDeclarator(declarator) => resolve_handler_function(
                    declarator.init.as_ref()?,
                    opening_node,
                    ctx,
                    visited_symbols,
                ),
                _ => None,
            }
        }
        Expression::ArrowFunctionExpression(function) => Some(HandlerFunction {
            node_id: function.node_id.get(),
            is_conditional: false,
            blockers_only: false,
        }),
        Expression::FunctionExpression(function) => Some(HandlerFunction {
            node_id: function.node_id.get(),
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
            let class = ctx
                .nodes()
                .ancestors(opening_node.id())
                .find_map(|ancestor| {
                    let AstKind::Class(class) = ancestor.kind() else {
                        return None;
                    };
                    Some(class)
                })?;
            class.body.body.iter().find_map(|element| match element {
                ClassElement::MethodDefinition(method)
                    if method.key.static_name().as_deref() == Some(member_name) =>
                {
                    Some(HandlerFunction {
                        node_id: method.value.node_id.get(),
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
                            is_conditional: false,
                            blockers_only: true,
                        }),
                        Expression::FunctionExpression(function) => Some(HandlerFunction {
                            node_id: function.node_id.get(),
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

fn is_document_lookup(call: &oxc_ast::ast::CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    if call.arguments.len() != 1 {
        return false;
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    matches!(
        member.object().get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == "document"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn is_pure_event_blocker<'a>(
    attribute: &'a JSXAttribute<'a>,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    attribute_expression(attribute)
        .is_some_and(|expression| expression_is_pure_blocker(expression, opening_node, ctx))
}

fn expression_is_pure_blocker<'a>(
    expression: &'a Expression<'a>,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => function.get_expression().map_or_else(
            || {
                function
                    .body
                    .as_function_body()
                    .is_some_and(|body| statements_are_pure_blockers(&body.statements))
            },
            is_blocker_call,
        ),
        Expression::FunctionExpression(function) => function
            .body
            .as_ref()
            .is_some_and(|body| statements_are_pure_blockers(&body.statements)),
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            let Some(property_name) = member.static_property_name() else {
                return false;
            };
            if matches!(
                member.object().get_inner_expression(),
                Expression::ThisExpression(_)
            ) {
                return ctx.nodes().ancestors(opening_node.id()).any(|ancestor| {
                    let AstKind::Class(class) = ancestor.kind() else {
                        return false;
                    };
                    class.body.body.iter().any(|element| match element {
                        ClassElement::MethodDefinition(method)
                            if method.key.static_name().as_deref() == Some(property_name) =>
                        {
                            method
                                .value
                                .body
                                .as_ref()
                                .is_some_and(|body| statements_are_pure_blockers(&body.statements))
                        }
                        ClassElement::PropertyDefinition(property)
                            if property.key.static_name().as_deref() == Some(property_name) =>
                        {
                            property.value.as_ref().is_some_and(|value| {
                                expression_is_pure_blocker(value, opening_node, ctx)
                            })
                        }
                        _ => false,
                    })
                });
            }
            let Expression::Identifier(object) = member.object().get_inner_expression() else {
                return false;
            };
            let Some(Expression::ObjectExpression(object)) =
                local_identifier_initializer(object, ctx).map(Expression::get_inner_expression)
            else {
                return false;
            };
            object.properties.iter().any(|property| {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return false;
                };
                property.key.static_name().as_deref() == Some(property_name)
                    && expression_is_pure_blocker(&property.value, opening_node, ctx)
            })
        }
    }
}

fn local_identifier_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    declarator.init.as_ref()
}

fn statements_are_pure_blockers(statements: &[Statement<'_>]) -> bool {
    !statements.is_empty()
        && statements.iter().all(|statement| {
            let Statement::ExpressionStatement(statement) = statement else {
                return false;
            };
            is_blocker_call(&statement.expression)
        })
}

fn is_blocker_call(expression: &Expression<'_>) -> bool {
    let Some(call) = unwrapped_call_expression(expression) else {
        return false;
    };
    call.callee
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member| {
            !member.is_computed()
                && member
                    .static_property_name()
                    .is_some_and(|method| EVENT_BLOCKER_METHODS.contains(&method))
        })
}

fn has_equivalent_keyboard_descendant<'a>(
    click_attribute: &'a JSXAttribute<'a>,
    opening_node: &AstNode<'a>,
    opening_nodes: &[&AstNode<'a>],
    ctx: &LintContext<'a>,
) -> bool {
    let Some(expected_action) = attribute_expression(click_attribute)
        .and_then(|expression| single_handler_action(expression, ctx))
    else {
        return false;
    };
    let parent = ctx.nodes().parent_node(opening_node.id());
    let AstKind::JSXElement(element) = parent.kind() else {
        return false;
    };
    let first_descendant = opening_nodes
        .partition_point(|candidate| candidate.span().start < element.opening_element.span.end);
    for candidate in &opening_nodes[first_descendant..] {
        let AstKind::JSXOpeningElement(descendant) = candidate.kind() else {
            continue;
        };
        if descendant.span.start >= element.span.end {
            break;
        }
        if !element.span.contains_inclusive(descendant.span)
            || !is_reachable_descendant(candidate.id(), parent.id(), ctx)
            || hidden_between(candidate.id(), parent.id(), ctx)
            || !is_keyboard_activatable(descendant, candidate, ctx)
        {
            continue;
        }
        for handler_name in ["onClick", "onPress"] {
            let Some(descendant_action) = has_jsx_prop_ignore_case(descendant, handler_name)
                .and_then(JSXAttributeItem::as_attribute)
                .and_then(attribute_expression)
                .and_then(|expression| single_handler_action(expression, ctx))
            else {
                continue;
            };
            if normalized_source(descendant_action, ctx) == normalized_source(expected_action, ctx)
            {
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
        expression if is_statically_nullish_handler(expression, ctx) => None,
        Expression::ConditionalExpression(conditional) => {
            if is_statically_nullish_handler(&conditional.consequent, ctx) {
                single_handler_action(&conditional.alternate, ctx)
            } else if is_statically_nullish_handler(&conditional.alternate, ctx) {
                single_handler_action(&conditional.consequent, ctx)
            } else {
                None
            }
        }
        Expression::Identifier(identifier) => local_identifier_initializer(identifier, ctx)
            .map_or(Some(expression), |initializer| {
                single_handler_action(initializer, ctx)
            }),
        Expression::ArrowFunctionExpression(function) => {
            if function.is_expression() {
                return function.get_expression();
            }
            single_statement_action(&function.body.as_function_body()?.statements)
        }
        Expression::FunctionExpression(function) => {
            single_statement_action(&function.body.as_ref()?.statements)
        }
        _ => Some(expression),
    }
}

fn is_statically_nullish_handler<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let expression = expression.get_inner_expression();
    if is_static_nullish_expression(expression, ctx) {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    local_identifier_initializer(identifier, ctx).is_some_and(|initializer| {
        is_static_nullish_expression(initializer.get_inner_expression(), ctx)
    })
}

fn single_statement_action<'a>(statements: &'a [Statement<'a>]) -> Option<&'a Expression<'a>> {
    let [statement] = statements else {
        return None;
    };
    match statement {
        Statement::ExpressionStatement(statement) => Some(&statement.expression),
        Statement::ReturnStatement(statement) => statement.argument.as_ref(),
        _ => None,
    }
}

fn is_reachable_descendant(node_id: NodeId, root_id: NodeId, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == root_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::JSXElement(_)
                | AstKind::JSXFragment(_)
                | AstKind::JSXExpressionContainer(_)
                | AstKind::LogicalExpression(_)
                | AstKind::ConditionalExpression(_)
        ) {
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
            is_statically_hidden_from_screen_reader(opening_element, ctx)
                || potentially_truthy_attribute(opening_element, "hidden")
        }) {
            return true;
        }
    }
    false
}

fn is_keyboard_activatable<'a>(
    opening_element: &JSXOpeningElement<'a>,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(element_name) = flattened_jsx_name(&opening_element.name) else {
        return false;
    };
    if HTML_TAG.contains(element_name.as_str()) {
        if !NATIVE_KEYBOARD_ACTIVATABLE_TAGS.contains(&element_name.as_str()) {
            return false;
        }
    } else {
        let lowercase_name = element_name.to_ascii_lowercase();
        if !element_name
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
            || !["button", "link", "anchor"]
                .iter()
                .any(|suffix| lowercase_name.ends_with(suffix))
        {
            return false;
        }
    }
    if element_name == "a" && has_jsx_prop_ignore_case(opening_element, "href").is_none() {
        return false;
    }
    if ["disabled", "isDisabled", "aria-disabled"]
        .iter()
        .any(|name| potentially_truthy_attribute(opening_element, name))
        || has_negative_tab_index(opening_element)
    {
        return false;
    }
    has_accessible_name(opening_element, opening_node, ctx)
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
    let Some(JSXAttributeItem::Attribute(attribute)) =
        has_jsx_prop_ignore_case(opening_element, name)
    else {
        return false;
    };
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(value)) => value.value == "true",
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

fn has_negative_tab_index(opening_element: &JSXOpeningElement<'_>) -> bool {
    let Some(JSXAttributeItem::Attribute(attribute)) =
        has_jsx_prop_ignore_case(opening_element, "tabIndex")
    else {
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

fn has_accessible_name(
    opening_element: &JSXOpeningElement<'_>,
    opening_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if ["aria-label", "aria-labelledby"].iter().any(|name| {
        has_jsx_prop_ignore_case(opening_element, name)
            .and_then(JSXAttributeItem::as_attribute)
            .is_some_and(attribute_may_be_nonempty)
    }) {
        return true;
    }
    let parent = ctx.nodes().parent_node(opening_node.id());
    let AstKind::JSXElement(element) = parent.kind() else {
        return false;
    };
    element
        .children
        .iter()
        .any(|child| child_may_name(child, ctx))
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

fn child_may_name(child: &JSXChild<'_>, ctx: &LintContext<'_>) -> bool {
    match child {
        JSXChild::Text(text) => !text.value.trim().is_empty(),
        JSXChild::Element(element) => {
            ["aria-label", "aria-labelledby"].iter().any(|name| {
                has_jsx_prop_ignore_case(&element.opening_element, name)
                    .and_then(JSXAttributeItem::as_attribute)
                    .is_some_and(attribute_may_be_nonempty)
            }) || element
                .children
                .iter()
                .any(|child| child_may_name(child, ctx))
        }
        JSXChild::Fragment(fragment) => fragment
            .children
            .iter()
            .any(|child| child_may_name(child, ctx)),
        JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| {
                !is_static_nullish_expression(expression.get_inner_expression(), ctx)
                    && !matches!(
                        expression.get_inner_expression(),
                        Expression::BooleanLiteral(_)
                    )
            }),
        JSXChild::Spread(_) => false,
    }
}

fn normalized_source(expression: &Expression<'_>, ctx: &LintContext<'_>) -> String {
    ctx.source_range(expression.span())
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}
