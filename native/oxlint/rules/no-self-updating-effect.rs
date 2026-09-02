use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BindingPattern, Expression, ObjectPropertyKind,
        PropertyKey, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SYMBOLIC_DEPTH_LIMIT: usize = 16;

#[derive(Debug, Default, Clone)]
pub struct NoSelfUpdatingEffect;

declare_oxc_lint!(
    /// Warns when an effect non-settlingly updates state in its own dependency list.
    NoSelfUpdatingEffect,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Effect updates its own dependency.",
);

#[derive(Clone)]
struct SelfUpdatingStateBinding {
    setter_name: String,
    state_name: String,
}

#[derive(Default)]
struct SelfUpdatingCallIndex {
    call_ids_by_ancestor_function: FxHashMap<NodeId, Vec<NodeId>>,
}

impl Rule for NoSelfUpdatingEffect {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut nearest_function_index = None;
        let mut call_index = None;
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.is_declaration()
                        && function.id.as_ref().is_some_and(|identifier| {
                            self_updating_is_component_or_hook_name(identifier.name.as_str())
                        }) =>
                {
                    let Some(body) = &function.body else {
                        continue;
                    };
                    self_updating_check_function_statements(
                        &body.statements,
                        ctx,
                        &mut nearest_function_index,
                        &mut call_index,
                    );
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
                        continue;
                    };
                    if !self_updating_is_component_or_hook_name(binding.name.as_str()) {
                        continue;
                    }
                    let Some(initializer) = &declarator.init else {
                        continue;
                    };
                    let statements = match initializer {
                        Expression::ArrowFunctionExpression(function) => function
                            .body
                            .as_function_body()
                            .map(|body| body.statements.as_slice()),
                        Expression::FunctionExpression(function) => function
                            .body
                            .as_ref()
                            .map(|body| body.statements.as_slice()),
                        _ => None,
                    };
                    if let Some(statements) = statements {
                        self_updating_check_function_statements(
                            statements,
                            ctx,
                            &mut nearest_function_index,
                            &mut call_index,
                        );
                    }
                }
                _ => {}
            }
        }
    }
}

fn self_updating_is_component_or_hook_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
        || crate::utils::is_react_hook_name(name)
}

fn self_updating_build_call_index(ctx: &LintContext<'_>) -> SelfUpdatingCallIndex {
    let mut index = SelfUpdatingCallIndex::default();
    for node in ctx.nodes().iter() {
        if !matches!(node.kind(), AstKind::CallExpression(_)) {
            continue;
        }
        for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
            if matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                index
                    .call_ids_by_ancestor_function
                    .entry(ancestor.id())
                    .or_default()
                    .push(node.id());
            }
        }
    }
    index
}

fn self_updating_check_function_statements<'a>(
    statements: &[Statement<'a>],
    ctx: &LintContext<'a>,
    nearest_function_index: &mut Option<LocalCallbackNearestFunctionNodeIndex>,
    call_index: &mut Option<SelfUpdatingCallIndex>,
) {
    let state_bindings = self_updating_collect_state_bindings(statements, ctx);
    if state_bindings.is_empty() {
        return;
    }
    let binding_by_setter_name = state_bindings
        .iter()
        .map(|binding| (binding.setter_name.as_str(), binding))
        .collect::<FxHashMap<_, _>>();
    for statement in statements {
        let Some(effect_expression) = self_updating_unwrap_statement_expression(statement) else {
            continue;
        };
        let Expression::CallExpression(effect_call) = effect_expression else {
            continue;
        };
        if !is_react_hook_call(effect_call, &["useEffect", "useLayoutEffect"], ctx)
            || effect_call.arguments.len() < 2
        {
            continue;
        }
        let Some(Expression::ArrayExpression(dependencies)) = effect_call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        let dependency_state_names = dependencies
            .elements
            .iter()
            .filter_map(ArrayExpressionElement::as_expression)
            .filter_map(|expression| match expression {
                Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                _ => None,
            })
            .collect::<FxHashSet<_>>();
        if dependency_state_names.is_empty() {
            continue;
        }
        let Some(callback_expression) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        let callback_id = match callback_expression {
            Expression::ArrowFunctionExpression(function) => function.node_id.get(),
            Expression::FunctionExpression(function) => function.node_id.get(),
            _ => continue,
        };
        let nearest_function_index = nearest_function_index
            .get_or_insert_with(|| build_local_callback_nearest_function_node_index(ctx));
        let callback_statements = self_updating_callback_statements(callback_id, ctx);
        if callback_statements.is_empty() {
            self_updating_check_concise_callback(
                callback_id,
                &binding_by_setter_name,
                &dependency_state_names,
                ctx,
                nearest_function_index,
            );
            continue;
        }
        let first_write_index = callback_statements.iter().position(|statement| {
            self_updating_unconditional_setter_call(statement, &binding_by_setter_name).is_some()
        });
        let guard_cutoff = first_write_index.unwrap_or(callback_statements.len());
        let early_return_tests = callback_statements[..guard_cutoff]
            .iter()
            .filter_map(|statement| self_updating_early_return_test(statement))
            .collect::<Vec<_>>();
        let (top_level_writes, top_level_setter_ids) =
            self_updating_top_level_writes(&callback_statements, &binding_by_setter_name, ctx);
        let call_index = call_index.get_or_insert_with(|| self_updating_build_call_index(ctx));
        if self_updating_every_setter_is_top_level(
            callback_id,
            &binding_by_setter_name,
            &top_level_setter_ids,
            ctx,
            call_index,
        ) && early_return_tests.iter().any(|test| {
            self_updating_guard_proven_after_writes(
                test,
                &top_level_writes,
                ctx,
                0,
                &FxHashSet::default(),
            )
        }) {
            continue;
        }
        let mut reported_state_names = FxHashSet::default();
        for callback_statement in callback_statements {
            let Some((setter_node_id, setter_call, binding)) =
                self_updating_unconditional_setter_call(
                    callback_statement,
                    &binding_by_setter_name,
                )
            else {
                continue;
            };
            if !dependency_state_names.contains(binding.state_name.as_str())
                || reported_state_names.contains(binding.state_name.as_str())
                || !self_updating_is_non_settling_argument(
                    setter_call,
                    binding.state_name.as_str(),
                    ctx,
                    nearest_function_index,
                )
            {
                continue;
            }
            if let Some(argument) = setter_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                && self_updating_write_provably_converges(
                    argument,
                    binding.state_name.as_str(),
                    &early_return_tests,
                    ctx,
                    nearest_function_index,
                )
                && self_updating_every_write_drives_empty(callback_id, binding, ctx, call_index)
            {
                continue;
            }
            if self_updating_is_accepted_converging_updater(
                setter_call,
                binding.state_name.as_str(),
                &early_return_tests,
                ctx,
                nearest_function_index,
            ) {
                continue;
            }
            reported_state_names.insert(binding.state_name.as_str());
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "{}() updates `{}`, which is also in this effect's dependency list. Guard the update or move the derivation out of the effect.",
                    binding.setter_name, binding.state_name,
                ))
                .with_label(ctx.nodes().get_node(setter_node_id).span()),
            );
        }
    }
}

fn self_updating_check_concise_callback(
    callback_id: NodeId,
    binding_by_name: &FxHashMap<&str, &SelfUpdatingStateBinding>,
    dependency_state_names: &FxHashSet<&str>,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) {
    let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(callback_id).kind()
    else {
        return;
    };
    let Some(expression) = function.get_expression() else {
        return;
    };
    let Expression::CallExpression(call) = self_updating_unwrap_discarded_expression(expression)
    else {
        return;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return;
    };
    let Some(binding) = binding_by_name.get(callee.name.as_str()) else {
        return;
    };
    if !dependency_state_names.contains(binding.state_name.as_str())
        || !self_updating_is_non_settling_argument(
            call,
            binding.state_name.as_str(),
            ctx,
            nearest_function_index,
        )
        || self_updating_is_accepted_converging_updater(
            call,
            binding.state_name.as_str(),
            &[],
            ctx,
            nearest_function_index,
        )
    {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "{}() updates `{}`, which is also in this effect's dependency list. Guard the update or move the derivation out of the effect.",
            binding.setter_name, binding.state_name,
        ))
        .with_label(call.span),
    );
}

fn self_updating_collect_state_bindings<'a>(
    statements: &[Statement<'a>],
    ctx: &LintContext<'a>,
) -> Vec<SelfUpdatingStateBinding> {
    let mut bindings = Vec::new();
    for statement in statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(state)) =
                pattern.elements.first().and_then(Option::as_ref)
            else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(setter)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                continue;
            };
            if !self_updating_is_setter_name(setter.name.as_str()) {
                continue;
            }
            let Some(Expression::CallExpression(call)) = &declarator.init else {
                continue;
            };
            if is_react_hook_call(call, &["useState"], ctx) {
                bindings.push(SelfUpdatingStateBinding {
                    setter_name: setter.name.to_string(),
                    state_name: state.name.to_string(),
                });
            }
        }
    }
    bindings
}

fn self_updating_is_setter_name(name: &str) -> bool {
    name.starts_with("set") && name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase)
}

fn self_updating_unwrap_statement_expression<'node, 'ast>(
    statement: &'node Statement<'ast>,
) -> Option<&'node Expression<'ast>> {
    let Statement::ExpressionStatement(statement) = statement else {
        return None;
    };
    Some(self_updating_unwrap_discarded_expression(
        &statement.expression,
    ))
}

fn self_updating_unwrap_discarded_expression<'node, 'ast>(
    expression: &'node Expression<'ast>,
) -> &'node Expression<'ast> {
    let mut current = expression.get_inner_expression();
    loop {
        match current {
            Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => {
                current = unary.argument.get_inner_expression();
            }
            Expression::SequenceExpression(sequence)
                if sequence.expressions.len() > 1
                    && sequence.expressions[..sequence.expressions.len() - 1]
                        .iter()
                        .all(|expression| {
                            matches!(
                                expression.get_inner_expression(),
                                Expression::NumericLiteral(_)
                                    | Expression::StringLiteral(_)
                                    | Expression::BooleanLiteral(_)
                                    | Expression::NullLiteral(_)
                                    | Expression::BigIntLiteral(_)
                                    | Expression::RegExpLiteral(_)
                            )
                        }) =>
            {
                current = sequence.expressions.last().unwrap().get_inner_expression();
            }
            _ => return current,
        }
    }
}

fn self_updating_callback_statements<'node, 'ast>(
    callback_id: NodeId,
    ctx: &'node LintContext<'ast>,
) -> Vec<&'node Statement<'ast>> {
    match ctx.nodes().get_node(callback_id).kind() {
        AstKind::Function(function) => function
            .body
            .as_ref()
            .map(|body| {
                body.statements
                    .iter()
                    .filter(|statement| !self_updating_is_noop_statement(statement))
                    .collect()
            })
            .unwrap_or_default(),
        AstKind::ArrowFunctionExpression(function) => {
            if let Some(body) = function.body.as_function_body() {
                body.statements
                    .iter()
                    .filter(|statement| !self_updating_is_noop_statement(statement))
                    .collect()
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

fn self_updating_is_noop_statement(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::EmptyStatement(_) => true,
        Statement::ExpressionStatement(statement) => {
            match statement.expression.get_inner_expression() {
                Expression::NumericLiteral(_)
                | Expression::StringLiteral(_)
                | Expression::BooleanLiteral(_)
                | Expression::NullLiteral(_)
                | Expression::BigIntLiteral(_)
                | Expression::RegExpLiteral(_) => true,
                Expression::Identifier(identifier) => identifier.name == "undefined",
                Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => {
                    matches!(
                        unary.argument.get_inner_expression(),
                        Expression::NumericLiteral(_)
                            | Expression::StringLiteral(_)
                            | Expression::BooleanLiteral(_)
                            | Expression::NullLiteral(_)
                            | Expression::BigIntLiteral(_)
                            | Expression::RegExpLiteral(_)
                    )
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn self_updating_unconditional_setter_call<'statement, 'ast, 'binding>(
    statement: &'statement Statement<'ast>,
    binding_by_name: &FxHashMap<&str, &'binding SelfUpdatingStateBinding>,
) -> Option<(
    NodeId,
    &'statement oxc_ast::ast::CallExpression<'ast>,
    &'binding SelfUpdatingStateBinding,
)> {
    let expression = self_updating_unwrap_statement_expression(statement)?;
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let binding = *binding_by_name.get(callee.name.as_str())?;
    Some((call.node_id.get(), call, binding))
}

fn self_updating_early_return_test<'node, 'ast>(
    statement: &'node Statement<'ast>,
) -> Option<&'node Expression<'ast>> {
    let Statement::IfStatement(statement) = statement else {
        return None;
    };
    let exits = match &statement.consequent {
        Statement::ReturnStatement(_) => true,
        Statement::BlockStatement(block) => block
            .body
            .iter()
            .any(|statement| matches!(statement, Statement::ReturnStatement(_))),
        _ => false,
    };
    exits.then_some(&statement.test)
}

fn self_updating_is_non_settling_argument(
    call: &oxc_ast::ast::CallExpression<'_>,
    state_name: &str,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> bool {
    let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    let argument = argument.get_inner_expression();
    if matches!(argument, Expression::Identifier(identifier) if identifier.name == state_name) {
        return false;
    }
    if matches!(
        argument,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) || self_updating_constructs_fresh_reference(argument)
    {
        return true;
    }
    self_updating_expression_reads_name(argument, state_name, ctx, nearest_function_index)
}

fn self_updating_constructs_fresh_reference(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::ArrayExpression(_)
            | Expression::ObjectExpression(_)
            | Expression::NewExpression(_)
            | Expression::RegExpLiteral(_)
    )
}

fn self_updating_expression_reads_name(
    expression: &Expression<'_>,
    name: &str,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> bool {
    if matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }
    let expression_span = expression.span();
    let Some(function_id) = local_callback_nearest_function_id(expression.node_id(), ctx) else {
        return false;
    };
    nearest_function_index
        .node_ids(function_id)
        .iter()
        .any(|node_id| {
            let node = ctx.nodes().get_node(*node_id);
            let AstKind::IdentifierReference(identifier) = node.kind() else {
                return false;
            };
            identifier.name == name && expression_span.contains_inclusive(identifier.span)
        })
}

fn self_updating_numeric_literal(expression: &Expression<'_>) -> Option<f64> {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(literal) => Some(literal.value),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::UnaryNegation => {
            match unary.argument.get_inner_expression() {
                Expression::NumericLiteral(literal) => Some(-literal.value),
                _ => None,
            }
        }
        _ => None,
    }
}

fn self_updating_is_state_length(
    expression: &Expression<'_>,
    state_name: &str,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> bool {
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    member.static_property_name().as_deref() == Some("length")
        && self_updating_expression_reads_name(
            member.object(),
            state_name,
            ctx,
            nearest_function_index,
        )
}

fn self_updating_numeric_comparison(operator: BinaryOperator, left: f64, right: f64) -> bool {
    match operator {
        BinaryOperator::LessThan => left < right,
        BinaryOperator::LessEqualThan => left <= right,
        BinaryOperator::GreaterThan => left > right,
        BinaryOperator::GreaterEqualThan => left >= right,
        BinaryOperator::Equality | BinaryOperator::StrictEquality => left == right,
        BinaryOperator::Inequality | BinaryOperator::StrictInequality => left != right,
        _ => false,
    }
}

fn self_updating_guard_exits_empty(
    expression: &Expression<'_>,
    state_name: &str,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> bool {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            self_updating_is_state_length(&unary.argument, state_name, ctx, nearest_function_index)
        }
        Expression::LogicalExpression(logical) => {
            let left = self_updating_guard_exits_empty(
                &logical.left,
                state_name,
                ctx,
                nearest_function_index,
            );
            let right = self_updating_guard_exits_empty(
                &logical.right,
                state_name,
                ctx,
                nearest_function_index,
            );
            match logical.operator {
                LogicalOperator::Or => left || right,
                LogicalOperator::And => left && right,
                _ => false,
            }
        }
        Expression::BinaryExpression(binary) => {
            let left_length = self_updating_is_state_length(
                &binary.left,
                state_name,
                ctx,
                nearest_function_index,
            );
            let right_length = self_updating_is_state_length(
                &binary.right,
                state_name,
                ctx,
                nearest_function_index,
            );
            if left_length || right_length {
                let Some(other) = self_updating_numeric_literal(if left_length {
                    &binary.right
                } else {
                    &binary.left
                }) else {
                    return false;
                };
                return if left_length {
                    self_updating_numeric_comparison(binary.operator, 0.0, other)
                } else {
                    self_updating_numeric_comparison(binary.operator, other, 0.0)
                };
            }
            matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            ) && ((self_updating_expression_reads_name(
                &binary.left,
                state_name,
                ctx,
                nearest_function_index,
            ) && self_updating_is_nullish(&binary.right))
                || (self_updating_expression_reads_name(
                    &binary.right,
                    state_name,
                    ctx,
                    nearest_function_index,
                ) && self_updating_is_nullish(&binary.left)))
        }
        _ => false,
    }
}

fn self_updating_is_nullish(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        _ => false,
    }
}

fn self_updating_is_empty_value(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array) => array.elements.is_empty(),
        Expression::ObjectExpression(object) => object.properties.is_empty(),
        Expression::NullLiteral(_) => true,
        Expression::StringLiteral(literal) => literal.value.is_empty(),
        Expression::NumericLiteral(literal) => literal.value == 0.0,
        Expression::BooleanLiteral(literal) => !literal.value,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        _ => false,
    }
}

fn self_updating_function_parts<'node, 'ast>(
    function_id: NodeId,
    ctx: &'node LintContext<'ast>,
) -> Option<(
    &'node [oxc_ast::ast::FormalParameter<'ast>],
    Option<&'node Expression<'ast>>,
)> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::ArrowFunctionExpression(function) => {
            Some((&function.params.items, function.get_expression()))
        }
        AstKind::Function(function) => Some((&function.params.items, None)),
        _ => None,
    }
}

fn self_updating_function_return_expression<'node, 'ast>(
    function_id: NodeId,
    ctx: &'node LintContext<'ast>,
) -> Option<&'node Expression<'ast>> {
    if let Some((_, Some(expression))) = self_updating_function_parts(function_id, ctx) {
        return Some(expression.get_inner_expression());
    }
    let statements = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.body.as_ref()?.statements,
        AstKind::ArrowFunctionExpression(function) => &function.body.as_function_body()?.statements,
        _ => return None,
    };
    statements.iter().find_map(|statement| match statement {
        Statement::ReturnStatement(statement) => statement
            .argument
            .as_ref()
            .map(Expression::get_inner_expression),
        _ => None,
    })
}

fn self_updating_function_parameter_name<'node, 'ast>(
    function_id: NodeId,
    ctx: &'node LintContext<'ast>,
) -> Option<&'node str> {
    let (parameters, _) = self_updating_function_parts(function_id, ctx)?;
    match &parameters.first()?.pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn self_updating_function_expression_id(expression: &Expression<'_>) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn self_updating_is_length_reducing_updater(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function_id) = self_updating_function_expression_id(expression) else {
        return false;
    };
    let Some(parameter_name) = self_updating_function_parameter_name(function_id, ctx) else {
        return false;
    };
    let Some(Expression::CallExpression(call)) =
        self_updating_function_return_expression(function_id, ctx)
    else {
        return false;
    };
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == parameter_name)
        && member.static_property_name().as_deref() == Some("slice")
        && call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(self_updating_numeric_literal)
            .is_some_and(|value| value >= 1.0)
}

fn self_updating_write_provably_converges(
    argument: &Expression<'_>,
    state_name: &str,
    early_return_tests: &[&Expression<'_>],
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> bool {
    (self_updating_is_empty_value(argument)
        || self_updating_is_length_reducing_updater(argument, ctx))
        && early_return_tests.iter().any(|test| {
            self_updating_guard_exits_empty(test, state_name, ctx, nearest_function_index)
        })
}

fn self_updating_collect_return_expressions<'node, 'ast>(
    function_id: NodeId,
    ctx: &'node LintContext<'ast>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> Vec<&'node Expression<'ast>> {
    if let Some((_, Some(expression))) = self_updating_function_parts(function_id, ctx) {
        return vec![expression.get_inner_expression()];
    }
    nearest_function_index
        .node_ids(function_id)
        .iter()
        .filter_map(|node_id| match ctx.nodes().get_node(*node_id).kind() {
            AstKind::ReturnStatement(statement) => statement
                .argument
                .as_ref()
                .map(Expression::get_inner_expression),
            _ => None,
        })
        .collect()
}

fn self_updating_expression_can_be_parameter(
    expression: &Expression<'_>,
    parameter_name: &str,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == parameter_name,
        Expression::ConditionalExpression(conditional) => {
            self_updating_expression_can_be_parameter(&conditional.consequent, parameter_name)
                || self_updating_expression_can_be_parameter(&conditional.alternate, parameter_name)
        }
        _ => false,
    }
}

fn self_updating_guard_bounds_state(
    expression: &Expression<'_>,
    state_name: &str,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> bool {
    match expression.get_inner_expression() {
        Expression::LogicalExpression(logical) => {
            self_updating_guard_bounds_state(&logical.left, state_name, ctx, nearest_function_index)
                || self_updating_guard_bounds_state(
                    &logical.right,
                    state_name,
                    ctx,
                    nearest_function_index,
                )
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::LessThan
                    | BinaryOperator::LessEqualThan
                    | BinaryOperator::GreaterThan
                    | BinaryOperator::GreaterEqualThan
            ) =>
        {
            self_updating_expression_reads_name(
                &binary.left,
                state_name,
                ctx,
                nearest_function_index,
            ) || self_updating_expression_reads_name(
                &binary.right,
                state_name,
                ctx,
                nearest_function_index,
            )
        }
        _ => false,
    }
}

fn self_updating_is_accepted_converging_updater(
    call: &oxc_ast::ast::CallExpression<'_>,
    state_name: &str,
    early_return_tests: &[&Expression<'_>],
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> bool {
    let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    let Some(function_id) = self_updating_function_expression_id(argument) else {
        return false;
    };
    let Some(parameter_name) = self_updating_function_parameter_name(function_id, ctx) else {
        return false;
    };
    let returns =
        self_updating_collect_return_expressions(function_id, ctx, nearest_function_index);
    if returns.iter().any(|returned| {
        matches!(returned, Expression::CallExpression(call)
            if call.callee.as_member_expression().is_some_and(|member|
                member.static_property_name().as_deref() == Some("map")
                    && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == parameter_name)))
            || self_updating_expression_can_be_parameter(returned, parameter_name)
    }) {
        return true;
    }
    let Some(Expression::BinaryExpression(binary)) =
        self_updating_function_return_expression(function_id, ctx)
    else {
        return false;
    };
    let increments = matches!(
        binary.operator,
        BinaryOperator::Addition | BinaryOperator::Subtraction
    ) && ((matches!(binary.left.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == parameter_name)
        && self_updating_numeric_literal(&binary.right).is_some())
        || (matches!(binary.right.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == parameter_name)
            && self_updating_numeric_literal(&binary.left).is_some()));
    increments
        && early_return_tests.iter().any(|test| {
            self_updating_guard_bounds_state(test, state_name, ctx, nearest_function_index)
        })
}

fn self_updating_every_write_drives_empty(
    callback_id: NodeId,
    binding: &SelfUpdatingStateBinding,
    ctx: &LintContext<'_>,
    call_index: &SelfUpdatingCallIndex,
) -> bool {
    call_index
        .call_ids_by_ancestor_function
        .get(&callback_id)
        .into_iter()
        .flatten()
        .all(|call_id| {
            let AstKind::CallExpression(call) = ctx.nodes().get_node(*call_id).kind() else {
                return true;
            };
            let Expression::Identifier(callee) = &call.callee else {
                return true;
            };
            if callee.name.as_str() != binding.setter_name {
                return true;
            }
            call.arguments
                .first()
                .and_then(Argument::as_expression)
                .is_none_or(|argument| {
                    self_updating_is_empty_value(argument)
                        || self_updating_is_length_reducing_updater(argument, ctx)
                })
        })
}

fn self_updating_every_setter_is_top_level(
    callback_id: NodeId,
    binding_by_name: &FxHashMap<&str, &SelfUpdatingStateBinding>,
    top_level_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
    call_index: &SelfUpdatingCallIndex,
) -> bool {
    call_index
        .call_ids_by_ancestor_function
        .get(&callback_id)
        .into_iter()
        .flatten()
        .all(|call_id| {
            let node = ctx.nodes().get_node(*call_id);
            let AstKind::CallExpression(call) = node.kind() else {
                return true;
            };
            let Expression::Identifier(callee) = &call.callee else {
                return true;
            };
            if !binding_by_name.contains_key(callee.name.as_str()) {
                return true;
            }
            top_level_ids.contains(&node.id())
        })
}

fn self_updating_top_level_writes<'node, 'ast, 'binding>(
    statements: &[&'node Statement<'ast>],
    binding_by_name: &FxHashMap<&str, &'binding SelfUpdatingStateBinding>,
    ctx: &'node LintContext<'ast>,
) -> (
    FxHashMap<String, &'node Expression<'ast>>,
    FxHashSet<NodeId>,
) {
    let mut writes = FxHashMap::default();
    let mut call_ids = FxHashSet::default();
    for statement in statements {
        let Some((call_id, call, binding)) =
            self_updating_unconditional_setter_call(statement, binding_by_name)
        else {
            continue;
        };
        call_ids.insert(call_id);
        let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
            continue;
        };
        let new_value = self_updating_function_expression_id(argument)
            .and_then(|function_id| self_updating_function_return_expression(function_id, ctx))
            .unwrap_or_else(|| argument.get_inner_expression());
        writes.insert(binding.state_name.clone(), new_value);
    }
    (writes, call_ids)
}

fn self_updating_resolve_value<'node, 'ast>(
    expression: &'node Expression<'ast>,
    writes: &FxHashMap<String, &'node Expression<'ast>>,
    ctx: &'node LintContext<'ast>,
    depth: usize,
    seen: &FxHashSet<String>,
) -> Option<&'node Expression<'ast>> {
    if depth > SYMBOLIC_DEPTH_LIMIT {
        return None;
    }
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => {
            if seen.contains(identifier.name.as_str()) {
                return None;
            }
            let mut next_seen = seen.clone();
            next_seen.insert(identifier.name.to_string());
            if let Some(written) = writes.get(identifier.name.as_str()) {
                return self_updating_resolve_value(written, writes, ctx, depth + 1, &next_seen);
            }
            if let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) {
                return self_updating_resolve_value(
                    initializer,
                    writes,
                    ctx,
                    depth + 1,
                    &next_seen,
                );
            }
            Some(expression)
        }
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_) => Some(expression),
        expression => {
            let member = expression.as_member_expression()?;
            let property_name = member.static_property_name()?;
            let Expression::ObjectExpression(object) =
                self_updating_resolve_value(member.object(), writes, ctx, depth + 1, seen)?
            else {
                return None;
            };
            for property in object.properties.iter().rev() {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return None;
                };
                if property.computed {
                    return None;
                }
                let name_matches = match &property.key {
                    PropertyKey::StaticIdentifier(identifier) => {
                        identifier.name.as_str() == property_name
                    }
                    PropertyKey::StringLiteral(literal) => literal.value.as_str() == property_name,
                    _ => false,
                };
                if name_matches {
                    return self_updating_resolve_value(
                        &property.value,
                        writes,
                        ctx,
                        depth + 1,
                        seen,
                    );
                }
            }
            None
        }
    }
}

fn self_updating_resolve_number<'node, 'ast>(
    expression: &'node Expression<'ast>,
    writes: &FxHashMap<String, &'node Expression<'ast>>,
    ctx: &'node LintContext<'ast>,
    depth: usize,
    seen: &FxHashSet<String>,
) -> Option<f64> {
    if let Some(Expression::NumericLiteral(literal)) =
        self_updating_resolve_value(expression, writes, ctx, depth, seen)
    {
        return Some(literal.value);
    }
    let member = expression.get_inner_expression().as_member_expression()?;
    if member.static_property_name().as_deref() != Some("length") {
        return None;
    }
    let Expression::ArrayExpression(array) =
        self_updating_resolve_value(member.object(), writes, ctx, depth, seen)?
    else {
        return None;
    };
    (!array
        .elements
        .iter()
        .any(|element| matches!(element, ArrayExpressionElement::SpreadElement(_))))
    .then_some(array.elements.len() as f64)
}

fn self_updating_values_equal<'node, 'ast>(
    left: &'node Expression<'ast>,
    right: &'node Expression<'ast>,
    writes: &FxHashMap<String, &'node Expression<'ast>>,
    ctx: &'node LintContext<'ast>,
    depth: usize,
    seen: &FxHashSet<String>,
) -> bool {
    if let (Some(left), Some(right)) = (
        self_updating_resolve_number(left, writes, ctx, depth, seen),
        self_updating_resolve_number(right, writes, ctx, depth, seen),
    ) {
        return left == right;
    }
    let Some(left) = self_updating_resolve_value(left, writes, ctx, depth, seen) else {
        return false;
    };
    let Some(right) = self_updating_resolve_value(right, writes, ctx, depth, seen) else {
        return false;
    };
    match (left, right) {
        (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::BooleanLiteral(left), Expression::BooleanLiteral(right)) => {
            left.value == right.value
        }
        (Expression::NumericLiteral(left), Expression::NumericLiteral(right)) => {
            left.value == right.value
        }
        (Expression::StringLiteral(left), Expression::StringLiteral(right)) => {
            left.value == right.value
        }
        (Expression::Identifier(left), Expression::Identifier(right)) => left.name == right.name,
        (Expression::Identifier(identifier), Expression::NullLiteral(_))
        | (Expression::NullLiteral(_), Expression::Identifier(identifier)) => {
            identifier.name == "undefined"
        }
        _ => false,
    }
}

fn self_updating_provably_falsy<'node, 'ast>(
    expression: &'node Expression<'ast>,
    writes: &FxHashMap<String, &'node Expression<'ast>>,
    ctx: &'node LintContext<'ast>,
    depth: usize,
    seen: &FxHashSet<String>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression
        && !seen.contains(identifier.name.as_str())
        && let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx)
    {
        let mut next_seen = seen.clone();
        next_seen.insert(identifier.name.to_string());
        return self_updating_provably_falsy(initializer, writes, ctx, depth + 1, &next_seen);
    }
    if let Expression::LogicalExpression(logical) = expression {
        let left = self_updating_provably_falsy(&logical.left, writes, ctx, depth + 1, seen);
        let right = self_updating_provably_falsy(&logical.right, writes, ctx, depth + 1, seen);
        match logical.operator {
            LogicalOperator::And if left || right => return true,
            LogicalOperator::Or if left && right => return true,
            _ => {}
        }
    }
    if let Expression::BinaryExpression(binary) = expression
        && matches!(
            binary.operator,
            BinaryOperator::Inequality | BinaryOperator::StrictInequality
        )
        && self_updating_values_equal(&binary.left, &binary.right, writes, ctx, depth + 1, seen)
    {
        return true;
    }
    if let Some(value) = self_updating_resolve_value(expression, writes, ctx, depth, seen) {
        match value {
            Expression::NullLiteral(_) => return true,
            Expression::BooleanLiteral(literal) if !literal.value => return true,
            Expression::NumericLiteral(literal) if literal.value == 0.0 => return true,
            Expression::StringLiteral(literal) if literal.value.is_empty() => return true,
            _ => {}
        }
    }
    self_updating_resolve_number(expression, writes, ctx, depth, seen) == Some(0.0)
}

fn self_updating_guard_proven_after_writes<'node, 'ast>(
    expression: &'node Expression<'ast>,
    writes: &FxHashMap<String, &'node Expression<'ast>>,
    ctx: &'node LintContext<'ast>,
    depth: usize,
    seen: &FxHashSet<String>,
) -> bool {
    if depth > SYMBOLIC_DEPTH_LIMIT {
        return false;
    }
    match expression.get_inner_expression() {
        Expression::LogicalExpression(logical) => {
            let left = self_updating_guard_proven_after_writes(
                &logical.left,
                writes,
                ctx,
                depth + 1,
                seen,
            );
            let right = self_updating_guard_proven_after_writes(
                &logical.right,
                writes,
                ctx,
                depth + 1,
                seen,
            );
            match logical.operator {
                LogicalOperator::And => left && right,
                LogicalOperator::Or => left || right,
                _ => false,
            }
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            self_updating_provably_falsy(&unary.argument, writes, ctx, depth + 1, seen)
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            ) =>
        {
            self_updating_values_equal(&binary.left, &binary.right, writes, ctx, depth + 1, seen)
        }
        Expression::BinaryExpression(binary) => match (
            self_updating_resolve_number(&binary.left, writes, ctx, depth + 1, seen),
            self_updating_resolve_number(&binary.right, writes, ctx, depth + 1, seen),
        ) {
            (Some(left), Some(right)) => {
                self_updating_numeric_comparison(binary.operator, left, right)
            }
            _ => false,
        },
        expression => self_updating_resolve_value(expression, writes, ctx, depth + 1, seen)
            .is_some_and(|value| match value {
                Expression::ArrayExpression(_) | Expression::ObjectExpression(_) => true,
                Expression::BooleanLiteral(literal) => literal.value,
                Expression::NumericLiteral(literal) => literal.value != 0.0,
                Expression::StringLiteral(literal) => !literal.value.is_empty(),
                _ => false,
            }),
    }
}
