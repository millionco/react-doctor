use oxc_ast::{
    AstKind,
    ast::{ArrayExpressionElement, BindingPattern, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::BinaryOperator;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DEFERRED_EXECUTION_CALLEE_NAMES: [&str; 19] = [
    "setTimeout",
    "setInterval",
    "setImmediate",
    "debounce",
    "throttle",
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "then",
    "catch",
    "finally",
    "subscribe",
    "addEventListener",
    "addListener",
    "on",
    "once",
    "useEffect",
    "useLayoutEffect",
    "useInsertionEffect",
];
const EFFECT_HOOK_CALLEE_NAMES: [&str; 3] = ["useEffect", "useLayoutEffect", "useInsertionEffect"];

#[derive(Debug, Default, Clone)]
pub struct RerenderFunctionalSetstate;

declare_oxc_lint!(
    /// Warns when a useState setter reads a stale state value.
    RerenderFunctionalSetstate,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when a useState setter reads a stale state value.",
);

impl Rule for RerenderFunctionalSetstate {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(setter_call) = node.kind() else {
            return;
        };
        let Expression::Identifier(setter_identifier) = &setter_call.callee else {
            return;
        };
        let setter_name = setter_identifier.name.as_str();
        let Some(state_name) = derive_state_variable_name(setter_name) else {
            return;
        };
        if !is_use_state_setter(setter_identifier, ctx) {
            return;
        }
        let Some(argument) = setter_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let can_arithmetic_go_stale = || {
            is_inside_deferred_callback(node, ctx)
                || has_multiple_setter_calls_in_enclosing_function(
                    node,
                    setter_name,
                    state_name.as_str(),
                    ctx,
                )
        };

        if let Expression::BinaryExpression(binary_expression) = argument
            && is_state_arithmetic_operator(binary_expression.operator)
            && can_arithmetic_go_stale()
        {
            let state_identifier = [
                binary_expression.left.get_identifier_reference(),
                binary_expression.right.get_identifier_reference(),
            ]
            .into_iter()
            .flatten()
            .find(|identifier| identifier.name.as_str() == state_name.as_str());
            if let Some(state_identifier) = state_identifier {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "You can lose this update because {setter_name}({} {} ...) reads a stale value.",
                        state_identifier.name,
                        binary_expression.operator.as_str(),
                    ))
                    .with_label(setter_call.span),
                );
                return;
            }
        }

        if let Expression::UpdateExpression(update_expression) = argument
            && update_expression.argument.get_identifier_name() == Some(state_name.as_str())
            && can_arithmetic_go_stale()
        {
            let operator = update_expression.operator.as_str();
            let display = if update_expression.prefix {
                format!("{operator}{state_name}")
            } else {
                format!("{state_name}{operator}")
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "You can lose this update because {setter_name}({display}) reads a stale value & ++ grabs the wrong one."
                ))
                .with_label(setter_call.span),
            );
            return;
        }

        if !is_inside_deferred_callback(node, ctx) {
            return;
        }
        if let Expression::ArrayExpression(array_expression) = argument
            && array_expression.elements.iter().any(|element| {
                matches!(
                    element,
                    ArrayExpressionElement::SpreadElement(spread_element)
                        if spread_element.argument.get_identifier_reference().is_some_and(
                            |identifier| identifier.name.as_str() == state_name.as_str()
                        )
                )
            })
        {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "You can lose this update because {setter_name}([...{state_name}, ...]) reads a stale value."
                ))
                .with_label(setter_call.span),
            );
            return;
        }
        if let Expression::ObjectExpression(object_expression) = argument
            && object_expression.properties.iter().any(|property| {
                matches!(
                    property,
                    ObjectPropertyKind::SpreadProperty(spread_property)
                        if spread_property.argument.get_identifier_reference().is_some_and(
                            |identifier| identifier.name.as_str() == state_name.as_str()
                        )
                )
            })
        {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "You can lose this update because {setter_name}({{ ...{state_name}, ... }}) reads a stale value."
                ))
                .with_label(setter_call.span),
            );
        }
    }
}

fn derive_state_variable_name(setter_name: &str) -> Option<String> {
    let state_suffix = setter_name.strip_prefix("set")?;
    let mut suffix_characters = state_suffix.chars();
    let first_character = suffix_characters.next()?;
    Some(
        first_character
            .to_lowercase()
            .chain(suffix_characters)
            .collect(),
    )
}

fn is_use_state_setter<'a>(
    setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(setter_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(array_pattern) = &declarator.id else {
        return false;
    };
    let Some(setter_binding) = array_pattern.elements.get(1).and_then(Option::as_ref) else {
        return false;
    };
    if setter_binding
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(Expression::CallExpression(hook_call)) = declarator.init.as_ref() else {
        return false;
    };
    callee_name(&hook_call.callee) == Some("useState")
}

fn is_state_arithmetic_operator(operator: BinaryOperator) -> bool {
    matches!(
        operator,
        BinaryOperator::Addition
            | BinaryOperator::Subtraction
            | BinaryOperator::Multiplication
            | BinaryOperator::Division
            | BinaryOperator::Remainder
            | BinaryOperator::Exponential
    )
}

fn is_inside_deferred_callback<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        let parent = ctx.nodes().parent_node(ancestor.id());
        let AstKind::CallExpression(parent_call) = parent.kind() else {
            continue;
        };
        let Some(parent_callee_name) = callee_name(&parent_call.callee) else {
            continue;
        };
        if DEFERRED_EXECUTION_CALLEE_NAMES.contains(&parent_callee_name) {
            if !is_mount_only_effect_call(parent_call, parent_callee_name) {
                return true;
            }
        }
    }
    false
}

fn is_mount_only_effect_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    callee_name: &str,
) -> bool {
    if !EFFECT_HOOK_CALLEE_NAMES.contains(&callee_name) {
        return false;
    }
    matches!(
        call_expression
            .arguments
            .get(1)
            .and_then(oxc_ast::ast::Argument::as_expression),
        Some(Expression::ArrayExpression(array_expression)) if array_expression.elements.is_empty()
    )
}

fn has_multiple_setter_calls_in_enclosing_function<'a>(
    setter_call_node: &AstNode<'a>,
    setter_name: &str,
    state_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(enclosing_function) = ctx
        .nodes()
        .ancestors(setter_call_node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
    else {
        return false;
    };
    let enclosing_function_id = enclosing_function.id();
    let enclosing_function_span = enclosing_function.span();
    ctx.nodes()
        .iter()
        .filter(|candidate| enclosing_function_span.contains_inclusive(candidate.span()))
        .filter(|candidate| candidate.id() != setter_call_node.id())
        .any(|candidate| {
            let has_same_enclosing_function = ctx
                .nodes()
                .ancestors(candidate.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                })
                .is_some_and(|candidate_function| candidate_function.id() == enclosing_function_id);
            if !has_same_enclosing_function {
                return false;
            }
            matches!(
                candidate.kind(),
                AstKind::CallExpression(call_expression)
                    if matches!(
                        &call_expression.callee,
                        Expression::Identifier(identifier) if identifier.name == setter_name
                    ) && setter_argument_reads_state(call_expression, state_name)
            )
        })
}

fn setter_argument_reads_state(
    setter_call: &oxc_ast::ast::CallExpression<'_>,
    state_name: &str,
) -> bool {
    let Some(argument) = setter_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    if argument
        .get_identifier_reference()
        .is_some_and(|identifier| identifier.name.as_str() == state_name)
    {
        return true;
    }
    match argument {
        Expression::BinaryExpression(binary_expression) => [
            binary_expression.left.get_identifier_reference(),
            binary_expression.right.get_identifier_reference(),
        ]
        .into_iter()
        .flatten()
        .any(|identifier| identifier.name.as_str() == state_name),
        Expression::UpdateExpression(update_expression) => {
            update_expression.argument.get_identifier_name() == Some(state_name)
        }
        Expression::ArrayExpression(array_expression) => {
            array_expression.elements.iter().any(|element| {
                matches!(
                    element,
                    ArrayExpressionElement::SpreadElement(spread_element)
                        if spread_element.argument.get_identifier_reference().is_some_and(
                            |identifier| identifier.name.as_str() == state_name
                        )
                )
            })
        }
        Expression::ObjectExpression(object_expression) => {
            object_expression.properties.iter().any(|property| {
                matches!(
                    property,
                    ObjectPropertyKind::SpreadProperty(spread_property)
                        if spread_property.argument.get_identifier_reference().is_some_and(
                            |identifier| identifier.name.as_str() == state_name
                        )
                )
            })
        }
        _ => false,
    }
}

fn callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(oxc_ast::ast::MemberExpression::static_property_name),
    }
}
