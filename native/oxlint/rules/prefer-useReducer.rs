use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, FunctionBody, FunctionType, MemberExpression,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const RELATED_USE_STATE_THRESHOLD: usize = 5;

#[derive(Debug, Default, Clone)]
pub struct PreferUseReducer;

impl RuleMeta for PreferUseReducer {
    const NAME: &'static str = "prefer-useReducer";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Prefer useReducer for state values updated together.",
    };
}

impl Rule for PreferUseReducer {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration =>
                {
                    let Some(identifier) = &function.id else {
                        continue;
                    };
                    if !prefer_reducer_is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    let Some(body) = &function.body else {
                        continue;
                    };
                    prefer_reducer_check_component(
                        function.node_id.get(),
                        identifier.name.as_str(),
                        body,
                        ctx,
                    );
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !prefer_reducer_is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    match &declarator.init {
                        Some(Expression::ArrowFunctionExpression(function)) => {
                            let Some(body) = function.body.as_function_body() else {
                                continue;
                            };
                            prefer_reducer_check_component(
                                function.node_id.get(),
                                identifier.name.as_str(),
                                body,
                                ctx,
                            );
                        }
                        Some(Expression::FunctionExpression(function)) => {
                            let Some(body) = &function.body else {
                                continue;
                            };
                            prefer_reducer_check_component(
                                function.node_id.get(),
                                identifier.name.as_str(),
                                body,
                                ctx,
                            );
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

fn prefer_reducer_check_component<'a>(
    component_function_id: oxc_semantic::NodeId,
    component_name: &str,
    body: &'a FunctionBody<'a>,
    ctx: &LintContext<'a>,
) {
    let initializers_by_setter = prefer_reducer_state_initializers(&body.statements, ctx);
    if initializers_by_setter.len() < RELATED_USE_STATE_THRESHOLD {
        return;
    }
    let setter_names = initializers_by_setter
        .keys()
        .copied()
        .collect::<FxHashSet<_>>();
    let mut largest_group_size = 0;
    for node in ctx.nodes().iter() {
        let statements = match node.kind() {
            AstKind::FunctionBody(function_body) => function_body.statements.as_slice(),
            AstKind::BlockStatement(block) => block.body.as_slice(),
            _ => continue,
        };
        if !body.span.contains_inclusive(node.span())
            || !prefer_reducer_block_is_in_nested_function(node, component_function_id, ctx)
        {
            continue;
        }
        let group_size = prefer_reducer_co_updated_setter_count(
            statements,
            &setter_names,
            &initializers_by_setter,
        );
        largest_group_size = largest_group_size.max(group_size);
    }
    if largest_group_size < RELATED_USE_STATE_THRESHOLD {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "\"{component_name}\" updates {largest_group_size} separate useState values in one place — state that changes together is easier to keep consistent as a single useReducer action."
        ))
        .with_label(body.span),
    );
}

fn prefer_reducer_state_initializers<'a>(
    statements: &'a [Statement<'a>],
    ctx: &LintContext<'a>,
) -> FxHashMap<&'a str, Option<&'a Argument<'a>>> {
    let mut initializers = FxHashMap::default();
    for statement in statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(_)) =
                pattern.elements.first().and_then(Option::as_ref)
            else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(setter)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                continue;
            };
            if !prefer_reducer_is_setter_name(setter.name.as_str()) {
                continue;
            }
            let Some(Expression::CallExpression(state_call)) = &declarator.init else {
                continue;
            };
            if !is_react_hook_call(state_call, &["useState"], ctx) {
                continue;
            }
            initializers.insert(setter.name.as_str(), state_call.arguments.first());
        }
    }
    initializers
}

fn prefer_reducer_block_is_in_nested_function(
    block: &AstNode<'_>,
    component_function_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(block.id()) {
        if ancestor.id() == component_function_id {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return true;
        }
    }
    false
}

fn prefer_reducer_co_updated_setter_count<'a>(
    statements: &'a [Statement<'a>],
    setter_names: &FxHashSet<&str>,
    initializers_by_setter: &FxHashMap<&str, Option<&'a Argument<'a>>>,
) -> usize {
    let mut group_setter_names = FxHashSet::default();
    let mut has_data_carrying_write = false;
    for statement in statements {
        let Some(call) = prefer_reducer_setter_call(statement, setter_names) else {
            continue;
        };
        let Expression::Identifier(setter) = call.callee.get_inner_expression() else {
            continue;
        };
        let setter_name = setter.name.as_str();
        group_setter_names.insert(setter_name);
        if !prefer_reducer_is_reset_write(
            call.arguments.first(),
            initializers_by_setter.get(setter_name).copied().flatten(),
        ) {
            has_data_carrying_write = true;
        }
    }
    if has_data_carrying_write {
        group_setter_names.len()
    } else {
        0
    }
}

fn prefer_reducer_setter_call<'a>(
    statement: &'a Statement<'a>,
    setter_names: &FxHashSet<&str>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    let expression = match statement {
        Statement::ExpressionStatement(statement) => Some(&statement.expression),
        Statement::ReturnStatement(statement) => statement.argument.as_ref(),
        _ => None,
    }?;
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return None;
    };
    setter_names
        .contains(callee.name.as_str())
        .then_some(call.as_ref())
}

fn prefer_reducer_is_reset_write(
    argument: Option<&Argument<'_>>,
    initializer: Option<&Argument<'_>>,
) -> bool {
    match (argument, initializer) {
        (None, None) => true,
        (Some(argument), Some(initializer)) => {
            let (Some(argument), Some(initializer)) =
                (argument.as_expression(), initializer.as_expression())
            else {
                return false;
            };
            prefer_reducer_reset_expressions_equal(argument, initializer)
        }
        _ => false,
    }
}

fn prefer_reducer_reset_expressions_equal(first: &Expression<'_>, second: &Expression<'_>) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::ArrayExpression(first), Expression::ArrayExpression(second)) => {
            first.elements.is_empty() && second.elements.is_empty()
        }
        (Expression::ObjectExpression(first), Expression::ObjectExpression(second)) => {
            first.properties.is_empty() && second.properties.is_empty()
        }
        (Expression::NewExpression(first), Expression::NewExpression(second)) => {
            first.arguments.is_empty()
                && second.arguments.is_empty()
                && prefer_reducer_expressions_equal(&first.callee, &second.callee)
        }
        (Expression::UnaryExpression(first), Expression::UnaryExpression(second)) => {
            first.operator == second.operator
                && prefer_reducer_reset_expressions_equal(&first.argument, &second.argument)
        }
        _ => prefer_reducer_expressions_equal(first, second),
    }
}

fn prefer_reducer_expressions_equal(first: &Expression<'_>, second: &Expression<'_>) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::ThisExpression(_), Expression::ThisExpression(_))
        | (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            first.name == second.name
        }
        (Expression::PrivateFieldExpression(first), Expression::PrivateFieldExpression(second)) => {
            first.field.name == second.field.name
        }
        (Expression::StringLiteral(first), Expression::StringLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BooleanLiteral(first), Expression::BooleanLiteral(second)) => {
            first.value == second.value
        }
        (Expression::NumericLiteral(first), Expression::NumericLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BigIntLiteral(first), Expression::BigIntLiteral(second)) => {
            first.value == second.value
        }
        (Expression::RegExpLiteral(first), Expression::RegExpLiteral(second)) => {
            first.regex.pattern.text == second.regex.pattern.text
                && first.regex.flags == second.regex.flags
        }
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            prefer_reducer_expressions_equal(&first.callee, &second.callee)
                && first.arguments.len() == second.arguments.len()
                && first.arguments.iter().zip(&second.arguments).all(
                    |(first_argument, second_argument)| {
                        let (Some(first_argument), Some(second_argument)) = (
                            first_argument.as_expression(),
                            second_argument.as_expression(),
                        ) else {
                            return false;
                        };
                        prefer_reducer_expressions_equal(first_argument, second_argument)
                    },
                )
        }
        _ => match (first.as_member_expression(), second.as_member_expression()) {
            (Some(first), Some(second)) if first.is_computed() == second.is_computed() => {
                prefer_reducer_expressions_equal(first.object(), second.object())
                    && match (first, second) {
                        (
                            MemberExpression::StaticMemberExpression(first),
                            MemberExpression::StaticMemberExpression(second),
                        ) => first.property.name == second.property.name,
                        (
                            MemberExpression::ComputedMemberExpression(first),
                            MemberExpression::ComputedMemberExpression(second),
                        ) => {
                            prefer_reducer_expressions_equal(&first.expression, &second.expression)
                        }
                        (
                            MemberExpression::PrivateFieldExpression(first),
                            MemberExpression::PrivateFieldExpression(second),
                        ) => first.field.name == second.field.name,
                        _ => false,
                    }
            }
            _ => false,
        },
    }
}

fn prefer_reducer_is_setter_name(name: &str) -> bool {
    name.strip_prefix("set")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}

fn prefer_reducer_is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
