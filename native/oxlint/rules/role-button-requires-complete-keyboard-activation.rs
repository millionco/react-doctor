use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, CallExpression, Expression, FormalParameters, JSXElementName, Statement,
        SwitchCase,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{AstNode, context::LintContext, globals::HTML_TAG, rule::Rule};

const ENTER_KEY: u8 = 1;
const SPACE_KEY: u8 = 2;
const KEYBOARD_HANDLER_NAMES: [&str; 3] = ["onKeyDown", "onKeyUp", "onKeyPress"];
const NON_ACTIVATION_METHOD_NAMES: [&str; 9] = [
    "debug",
    "error",
    "info",
    "log",
    "preventDefault",
    "stopImmediatePropagation",
    "stopPropagation",
    "trace",
    "warn",
];

#[derive(Debug, Default, Clone)]
pub struct RoleButtonRequiresCompleteKeyboardActivation;

declare_oxc_lint!(
    /// Requires custom ARIA buttons to support both Enter and Space activation.
    RoleButtonRequiresCompleteKeyboardActivation,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Requires complete keyboard activation for ARIA buttons.",
);

impl Rule for RoleButtonRequiresCompleteKeyboardActivation {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(element_name) = &opening_element.name else {
            return;
        };
        if element_name.name == "button"
            || !HTML_TAG.contains(element_name.name.as_str())
            || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            })
        {
            return;
        }
        let Some(role_attribute) = get_authoritative_jsx_attribute(opening_element, "role", false)
        else {
            return;
        };
        if get_string_literal_attribute_value(role_attribute)
            .is_none_or(|role| !role.eq_ignore_ascii_case("button"))
        {
            return;
        }
        let Some(click_handler) =
            get_authoritative_jsx_attribute(opening_element, "onClick", false)
                .and_then(jsx_attribute_expression)
        else {
            return;
        };
        let Some(click_callee) = direct_click_callee(click_handler) else {
            return;
        };
        let Some(expected_click_callee_key) =
            resolve_expression_key(click_callee, ctx, &mut Vec::new())
        else {
            return;
        };

        let mut activation_keys = 0;
        let mut function_resolution_cache = LocalFunctionResolutionCache::default();
        for handler_name in KEYBOARD_HANDLER_NAMES {
            let Some(keyboard_attribute) =
                get_authoritative_jsx_attribute(opening_element, handler_name, false)
            else {
                continue;
            };
            let Some(handler_expression) = jsx_attribute_expression(keyboard_attribute) else {
                return;
            };
            let Some(handler_node_id) = exact_local_function_id_including_generators(
                handler_expression,
                ctx,
                &mut Vec::new(),
                &mut function_resolution_cache,
            ) else {
                return;
            };
            let Some(handler_activation_keys) = collect_role_button_activation_keys(
                handler_node_id,
                &expected_click_callee_key,
                ctx,
            ) else {
                return;
            };
            if handler_activation_keys == 0 {
                return;
            }
            activation_keys |= handler_activation_keys;
        }
        if activation_keys != ENTER_KEY && activation_keys != SPACE_KEY {
            return;
        }
        let missing_key = if activation_keys == ENTER_KEY {
            "Space"
        } else {
            "Enter"
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This ARIA button handles only one activation key. Add {missing_key} support or use a native button so keyboard users can activate it consistently."
            ))
            .with_label(role_attribute.span),
        );
    }
}

fn direct_click_callee<'a, 'b>(expression: &'b Expression<'a>) -> Option<&'b Expression<'a>> {
    let expression = expression.get_inner_expression();
    if matches!(expression, Expression::Identifier(_))
        || expression.as_member_expression().is_some()
    {
        return Some(expression);
    }
    let action_expression = match expression {
        Expression::ArrowFunctionExpression(function) => {
            if let Some(expression) = function.get_expression() {
                Some(expression)
            } else {
                single_function_body_action(function.get_function_body()?)
            }
        }
        Expression::FunctionExpression(function) => {
            single_function_body_action(function.body.as_ref()?)
        }
        _ => None,
    }?;
    let Expression::CallExpression(call_expression) = action_expression.get_inner_expression()
    else {
        return None;
    };
    Some(&call_expression.callee)
}

fn single_function_body_action<'a, 'b>(
    body: &'b oxc_ast::ast::FunctionBody<'a>,
) -> Option<&'b Expression<'a>> {
    let [statement] = body.statements.as_slice() else {
        return None;
    };
    match statement {
        Statement::ExpressionStatement(statement) => Some(&statement.expression),
        Statement::ReturnStatement(statement) => statement.argument.as_ref(),
        _ => None,
    }
}

fn collect_role_button_activation_keys(
    handler_node_id: NodeId,
    expected_click_callee_key: &str,
    ctx: &LintContext<'_>,
) -> Option<u8> {
    let handler_node = ctx.nodes().get_node(handler_node_id);
    let parameters = match handler_node.kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return None,
    };
    let event_symbol_id = first_identifier_parameter_symbol(parameters)?;
    let mut activation_keys = 0;
    let mut has_opaque_event_delegation = false;
    let activation_call_spans = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return None;
            };
            if nearest_role_button_function_id(candidate, ctx) != Some(handler_node_id) {
                return None;
            }
            if role_button_call_delegates_event(call_expression, event_symbol_id, ctx)
                && !role_button_call_matches_click_action(
                    call_expression,
                    expected_click_callee_key,
                    ctx,
                )
            {
                has_opaque_event_delegation = true;
            }
            role_button_is_plausible_activation_call(
                call_expression,
                expected_click_callee_key,
                ctx,
            )
            .then_some(candidate.span())
        })
        .collect::<Vec<_>>();
    for candidate in ctx.nodes().iter() {
        if nearest_role_button_function_id(candidate, ctx) != Some(handler_node_id) {
            continue;
        }
        match candidate.kind() {
            AstKind::BinaryExpression(binary_expression) => {
                if let Some(activation_key) =
                    compared_role_button_activation_key(binary_expression, event_symbol_id, ctx)
                    && role_button_equality_controls_activation(
                        candidate,
                        &activation_call_spans,
                        ctx,
                    )
                {
                    activation_keys |= activation_key;
                }
            }
            AstKind::SwitchStatement(switch_statement) => {
                let Some(property_name) = role_button_keyboard_event_property(
                    &switch_statement.discriminant,
                    event_symbol_id,
                    ctx,
                ) else {
                    continue;
                };
                for (case_index, switch_case) in switch_statement.cases.iter().enumerate() {
                    let Some(activation_key) = switch_case
                        .test
                        .as_ref()
                        .and_then(|test| role_button_activation_key(property_name, test))
                    else {
                        continue;
                    };
                    if role_button_switch_path_contains_activation(
                        &switch_statement.cases,
                        case_index,
                        &activation_call_spans,
                    ) {
                        activation_keys |= activation_key;
                    }
                }
            }
            _ => {}
        }
    }
    (!has_opaque_event_delegation).then_some(activation_keys)
}

fn first_identifier_parameter_symbol(parameters: &FormalParameters<'_>) -> Option<SymbolId> {
    let BindingPattern::BindingIdentifier(identifier) = &parameters.items.first()?.pattern else {
        return None;
    };
    Some(identifier.symbol_id())
}

fn compared_role_button_activation_key<'a>(
    binary_expression: &oxc_ast::ast::BinaryExpression<'a>,
    event_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<u8> {
    if !matches!(
        binary_expression.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    ) {
        return None;
    }
    if let Some(property_name) =
        role_button_keyboard_event_property(&binary_expression.left, event_symbol_id, ctx)
    {
        return role_button_activation_key(property_name, &binary_expression.right);
    }
    role_button_keyboard_event_property(&binary_expression.right, event_symbol_id, ctx).and_then(
        |property_name| role_button_activation_key(property_name, &binary_expression.left),
    )
}

fn role_button_keyboard_event_property<'a, 'b>(
    expression: &'b Expression<'a>,
    event_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'b str> {
    let member_expression = expression.get_inner_expression().as_member_expression()?;
    let property_name = member_expression.static_property_name()?;
    if !matches!(property_name, "key" | "code") {
        return None;
    }
    let Expression::Identifier(identifier) = member_expression.object().get_inner_expression()
    else {
        return None;
    };
    (ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        == Some(event_symbol_id))
    .then_some(property_name)
}

fn role_button_activation_key(property_name: &str, expression: &Expression<'_>) -> Option<u8> {
    let Expression::StringLiteral(literal) = expression.get_inner_expression() else {
        return None;
    };
    match (property_name, literal.value.as_str()) {
        (_, "Enter") | ("code", "NumpadEnter") => Some(ENTER_KEY),
        ("key", " " | "Spacebar") | ("code", "Space") => Some(SPACE_KEY),
        _ => None,
    }
}

fn role_button_call_delegates_event<'a>(
    call_expression: &CallExpression<'a>,
    event_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    call_expression.arguments.iter().any(|argument| {
        let Some(expression) = argument.as_expression() else {
            return false;
        };
        match expression.get_inner_expression() {
            Expression::Identifier(identifier) => {
                ctx.scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    == Some(event_symbol_id)
            }
            expression => {
                role_button_keyboard_event_property(expression, event_symbol_id, ctx).is_some()
            }
        }
    })
}

fn role_button_call_matches_click_action(
    call_expression: &CallExpression<'_>,
    expected_click_callee_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    resolve_expression_key(&call_expression.callee, ctx, &mut Vec::new())
        .is_some_and(|callee_key| callee_key == expected_click_callee_key)
}

fn role_button_is_plausible_activation_call(
    call_expression: &CallExpression<'_>,
    expected_click_callee_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    if call_expression
        .callee
        .as_member_expression()
        .and_then(|member_expression| member_expression.static_property_name())
        .is_some_and(|method_name| NON_ACTIVATION_METHOD_NAMES.contains(&method_name))
    {
        return false;
    }
    role_button_call_matches_click_action(call_expression, expected_click_callee_key, ctx)
}

fn role_button_contains_activation_call(root_span: Span, activation_call_spans: &[Span]) -> bool {
    activation_call_spans
        .iter()
        .any(|call_span| root_span.contains_inclusive(*call_span))
}

fn role_button_equality_controls_activation<'a>(
    comparison_node: &AstNode<'a>,
    activation_call_spans: &[Span],
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = transparent_expression_root(comparison_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::UnaryExpression(unary_expression)
                if unary_expression.operator == UnaryOperator::LogicalNot =>
            {
                return false;
            }
            AstKind::LogicalExpression(logical_expression) => {
                if logical_expression.operator == LogicalOperator::And
                    && logical_expression.left.span() == current.span()
                    && role_button_contains_activation_call(
                        logical_expression.right.span(),
                        activation_call_spans,
                    )
                {
                    return true;
                }
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::IfStatement(if_statement) if if_statement.test.span() == current.span() => {
                return role_button_contains_activation_call(
                    if_statement.consequent.span(),
                    activation_call_spans,
                );
            }
            AstKind::ConditionalExpression(conditional_expression)
                if conditional_expression.test.span() == current.span() =>
            {
                return role_button_contains_activation_call(
                    conditional_expression.consequent.span(),
                    activation_call_spans,
                );
            }
            _ => return false,
        }
    }
}

fn role_button_switch_path_contains_activation(
    switch_cases: &[SwitchCase<'_>],
    start_index: usize,
    activation_call_spans: &[Span],
) -> bool {
    for switch_case in &switch_cases[start_index..] {
        for statement in &switch_case.consequent {
            if role_button_contains_activation_call(statement.span(), activation_call_spans) {
                return true;
            }
            if matches!(
                statement,
                Statement::BreakStatement(_)
                    | Statement::ContinueStatement(_)
                    | Statement::ReturnStatement(_)
                    | Statement::ThrowStatement(_)
            ) {
                return false;
            }
        }
    }
    false
}

fn nearest_role_button_function_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
