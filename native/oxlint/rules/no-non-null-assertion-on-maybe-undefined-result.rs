use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, AssignmentTarget, BindingPattern, Expression,
        MemberExpression, RegExpFlags, SimpleAssignmentTarget,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const FIND_MESSAGE: &str = "`.find(...)` returns `undefined` when nothing matches, so asserting `!` here crashes on the next access when the predicate misses; handle the missing case with optional chaining or a guard.";
const FIND_LAST_MESSAGE: &str = "`.findLast(...)` returns `undefined` when nothing matches, so asserting `!` here crashes on the next access when the predicate misses; handle the missing case with optional chaining or a guard.";
const MATCH_MESSAGE: &str = "`.match(...)` returns `null` when the pattern does not match, so asserting `!` here crashes on the next index or access; check the result before reading it.";
const GET_MESSAGE: &str = "`.get(...)` returns `undefined` when the key is absent, so asserting `!` here crashes on the next access when the key misses; check for the key or handle the missing value.";

#[derive(Debug, Default, Clone)]
pub struct NoNonNullAssertionOnMaybeUndefinedResult;

declare_oxc_lint!(
    /// Disallow non-null assertions on built-in maybe-undefined lookup results.
    NoNonNullAssertionOnMaybeUndefinedResult,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Non-null assertion on a maybe-undefined result.",
);

impl Rule for NoNonNullAssertionOnMaybeUndefinedResult {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let call_node_ids = ctx
            .nodes()
            .iter()
            .filter_map(|candidate| {
                matches!(candidate.kind(), AstKind::CallExpression(_)).then_some(candidate.id())
            })
            .collect::<Vec<_>>();
        for node in ctx.nodes().iter() {
            check_non_null_assertion(node, &call_node_ids, ctx);
        }
    }
}

fn check_non_null_assertion<'a>(
    node: &AstNode<'a>,
    call_node_ids: &[NodeId],
    ctx: &LintContext<'a>,
) {
    let AstKind::TSNonNullExpression(assertion) = node.kind() else {
        return;
    };
    if !assertion_is_member_receiver(node, ctx) {
        return;
    }
    let Expression::CallExpression(call) = assertion.expression.get_inner_expression() else {
        return;
    };
    let Some(callee) = call.callee.get_inner_expression().as_member_expression() else {
        return;
    };
    let Some(method_name) = callee.static_property_name() else {
        return;
    };
    let message = match method_name {
        "find" => FIND_MESSAGE,
        "findLast" => FIND_LAST_MESSAGE,
        "match" => MATCH_MESSAGE,
        "get" => GET_MESSAGE,
        _ => return,
    };

    match method_name {
        "find" | "findLast" => {
            let Some(predicate) = call.arguments.first().and_then(Argument::as_expression) else {
                return;
            };
            if !is_predicate_argument(predicate, ctx)
                || finder_result_is_proven(
                    node,
                    call,
                    callee.object(),
                    predicate,
                    call_node_ids,
                    ctx,
                )
            {
                return;
            }
        }
        "match" => {
            let Some(pattern) = call.arguments.first().and_then(Argument::as_expression) else {
                return;
            };
            if regex_is_always_matching(pattern)
                || match_result_is_proven(node, call, callee.object(), pattern, ctx)
                || non_null_match_proven_by_find_up_until(
                    node,
                    callee.object(),
                    pattern,
                    call_node_ids,
                    ctx,
                )
            {
                return;
            }
        }
        "get" => {
            let Some(key) = call.arguments.first().and_then(Argument::as_expression) else {
                return;
            };
            let Expression::Identifier(receiver) = callee.object().get_inner_expression() else {
                return;
            };
            let Some(symbol_id) = reference_symbol_id(receiver, ctx) else {
                return;
            };
            if !symbol_declares_bare_empty_map(symbol_id, ctx)
                || map_key_is_proven_present(node, receiver, key, call_node_ids, ctx)
            {
                return;
            }
        }
        _ => return,
    }

    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(assertion.span));
}

fn assertion_is_member_receiver(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current = node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::ChainExpression(_) => current = parent,
            AstKind::StaticMemberExpression(member) => {
                return member.object.span() == current.span();
            }
            AstKind::ComputedMemberExpression(member) => {
                return member.object.span() == current.span();
            }
            AstKind::PrivateFieldExpression(member) => {
                return member.object.span() == current.span();
            }
            _ => return false,
        }
    }
}

fn is_predicate_argument<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    if identifier.name == "Boolean" && ctx.is_reference_to_global_variable(identifier) {
        return true;
    }
    non_null_exact_local_function_id(expression, ctx, &mut Vec::new(), true).is_some()
}

fn non_null_exact_local_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
    include_generators: bool,
) -> Option<NodeId> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression()
        && matches!(
            member.static_property_name().as_deref(),
            Some("call" | "apply")
        )
    {
        return non_null_exact_local_function_id(
            member.object(),
            ctx,
            visited_symbols,
            include_generators,
        );
    }
    if let Expression::CallExpression(call) = expression
        && let Some(member) = call.callee.as_member_expression()
        && member.static_property_name().as_deref() == Some("bind")
    {
        return non_null_exact_local_function_id(
            member.object(),
            ctx,
            visited_symbols,
            include_generators,
        );
    }
    match expression {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) if include_generators || !function.generator => {
            Some(function.node_id.get())
        }
        Expression::Identifier(identifier) => {
            let symbol_id = reference_symbol_id(identifier, ctx)?;
            if visited_symbols.contains(&symbol_id) {
                return None;
            }
            visited_symbols.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let function_id = match declaration.kind() {
                AstKind::Function(function)
                    if (include_generators || !function.generator)
                        && !ctx
                            .scoping()
                            .get_resolved_references(symbol_id)
                            .any(oxc_semantic::Reference::is_write) =>
                {
                    Some(declaration.id())
                }
                AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) && declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
                {
                    non_null_exact_local_function_id(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbols,
                        include_generators,
                    )
                }
                _ => None,
            };
            visited_symbols.pop();
            function_id
        }
        _ => None,
    }
}

fn finder_result_is_proven<'a>(
    assertion: &AstNode<'a>,
    call: &oxc_ast::ast::CallExpression<'a>,
    receiver: &Expression<'a>,
    predicate: &Expression<'a>,
    call_node_ids: &[NodeId],
    ctx: &LintContext<'a>,
) -> bool {
    if non_null_find_is_guarded(assertion, call, receiver, predicate, ctx) {
        return true;
    }
    if is_ensure_then_find(assertion, call, receiver, call_node_ids, ctx) {
        return true;
    }
    if non_null_find_is_proven_by_guarded_maximum(assertion, receiver, predicate, ctx) {
        return true;
    }
    exhaustive_const_tuple_lookup(assertion, receiver, predicate, ctx)
}

fn non_null_find_is_proven_by_guarded_maximum<'a>(
    assertion: &AstNode<'a>,
    find_receiver: &Expression<'a>,
    find_predicate: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((find_property, compared_value)) = non_null_find_equality_parts(find_predicate) else {
        return false;
    };
    let Expression::Identifier(maximum_identifier) = compared_value.get_inner_expression() else {
        return false;
    };
    let Some(maximum_symbol_id) = reference_symbol_id(maximum_identifier, ctx) else {
        return false;
    };
    if ctx
        .scoping()
        .get_resolved_references(maximum_symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    let maximum_declaration = ctx.symbol_declaration(maximum_symbol_id);
    let AstKind::VariableDeclarator(maximum_declarator) = maximum_declaration.kind() else {
        return false;
    };
    let maximum_declaration_parent = ctx.nodes().parent_node(maximum_declaration.id());
    if !matches!(maximum_declaration_parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return false;
    }
    let Some(Expression::CallExpression(reduce_call)) = maximum_declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Some(reduce_member) = reduce_call.callee.get_member_expr() else {
        return false;
    };
    if reduce_member.static_property_name().as_deref() != Some("reduce") {
        return false;
    }
    let Expression::CallExpression(filter_call) = reduce_member.object().get_inner_expression()
    else {
        return false;
    };
    let Some(filter_member) = filter_call.callee.get_member_expr() else {
        return false;
    };
    if filter_member.static_property_name().as_deref() != Some("filter")
        || !non_null_expressions_structurally_equal(filter_member.object(), find_receiver, ctx)
    {
        return false;
    }
    let Some(filter_predicate) = filter_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    if !non_null_predicate_is_stable(filter_predicate, ctx) {
        return false;
    }
    let Some(reducer) = reduce_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(initial_value) = reduce_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Expression::NumericLiteral(initial_number) = initial_value.get_inner_expression() else {
        return false;
    };
    let Some(reducer_node_id) = non_null_resolve_function_node(reducer, ctx) else {
        return false;
    };
    let reducer_node = ctx.nodes().get_node(reducer_node_id);
    let Some((accumulator_name, item_name, reducer_body)) =
        non_null_two_parameter_function_parts(reducer_node)
    else {
        return false;
    };
    let Expression::CallExpression(max_call) = reducer_body.get_inner_expression() else {
        return false;
    };
    let Some(max_member) = max_call.callee.get_member_expr() else {
        return false;
    };
    if max_member.static_property_name().as_deref() != Some("max")
        || !matches!(max_member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Math" && ctx.is_reference_to_global_variable(identifier))
        || max_call.arguments.len() != 2
    {
        return false;
    }
    let has_accumulator = max_call.arguments.iter().any(|argument| {
        matches!(argument.as_expression().map(Expression::get_inner_expression), Some(Expression::Identifier(identifier)) if identifier.name == accumulator_name)
    });
    let has_item_property = max_call.arguments.iter().any(|argument| {
        let Some(expression) = argument.as_expression() else {
            return false;
        };
        let Some(member) = expression.get_inner_expression().as_member_expression() else {
            return false;
        };
        matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == item_name)
            && member.static_property_name().as_deref() == Some(find_property.as_str())
    });
    if !has_accumulator || !has_item_property {
        return false;
    }
    let maximum_end = reduce_call.span.end;
    if non_null_receiver_state_may_change(assertion, find_receiver, maximum_end, ctx) {
        return false;
    }
    non_null_maximum_guard_dominates(assertion, maximum_symbol_id, initial_number.value, ctx)
}

fn non_null_receiver_state_may_change(
    assertion: &AstNode<'_>,
    receiver: &Expression<'_>,
    start: u32,
    ctx: &LintContext<'_>,
) -> bool {
    let Some((receiver_root, receiver_path)) = non_null_expression_state_path(receiver) else {
        return true;
    };
    let Some(receiver_symbol_id) = reference_symbol_id(receiver_root, ctx) else {
        return true;
    };
    let Some(owner) = ctx
        .nodes()
        .ancestors(assertion.id())
        .skip(1)
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
    else {
        return true;
    };
    let mut alias_paths = rustc_hash::FxHashMap::default();
    alias_paths.insert(receiver_symbol_id, receiver_root.name.to_string());
    let mut did_add_alias = true;
    while did_add_alias {
        did_add_alias = false;
        for candidate in ctx.nodes().iter() {
            if !non_null_is_in_execution_scope(candidate, owner, ctx) {
                continue;
            }
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                continue;
            };
            let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
                continue;
            };
            let Some(initializer) = declarator.init.as_ref() else {
                continue;
            };
            let Some((initializer_root, initializer_path)) =
                non_null_expression_state_path(initializer)
            else {
                continue;
            };
            let Some(initializer_symbol_id) = reference_symbol_id(initializer_root, ctx) else {
                continue;
            };
            let Some(initializer_base_path) = alias_paths.get(&initializer_symbol_id).cloned()
            else {
                continue;
            };
            let initializer_suffix = initializer_path
                .strip_prefix(initializer_root.name.as_str())
                .unwrap_or("");
            if let std::collections::hash_map::Entry::Vacant(entry) =
                alias_paths.entry(binding.symbol_id())
            {
                entry.insert(format!("{initializer_base_path}{initializer_suffix}"));
                did_add_alias = true;
            }
        }
    }
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start <= start
            || candidate.span().start >= assertion.span().start
            || !non_null_is_in_execution_scope(candidate, owner, ctx)
        {
            return false;
        }
        match candidate.kind() {
            AstKind::CallExpression(_) => true,
            AstKind::AssignmentExpression(assignment) => non_null_state_path_changes_receiver(
                non_null_assignment_target_state_path(&assignment.left, ctx),
                receiver_path.as_str(),
                &alias_paths,
            ),
            AstKind::UpdateExpression(update) => non_null_state_path_changes_receiver(
                non_null_simple_assignment_target_state_path(&update.argument, ctx),
                receiver_path.as_str(),
                &alias_paths,
            ),
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                non_null_state_path_changes_receiver(
                    non_null_expression_symbol_state_path(&unary.argument, ctx),
                    receiver_path.as_str(),
                    &alias_paths,
                )
            }
            _ => false,
        }
    })
}

fn non_null_expression_state_path<'a>(
    expression: &'a Expression<'a>,
) -> Option<(&'a oxc_ast::ast::IdentifierReference<'a>, String)> {
    let mut current = expression.get_inner_expression();
    let mut properties: Vec<String> = Vec::new();
    loop {
        if let Expression::Identifier(identifier) = current {
            properties.reverse();
            let mut path = identifier.name.to_string();
            for property in properties {
                path.push('.');
                path.push_str(&property);
            }
            return Some((identifier, path));
        }
        let member = current.as_member_expression()?;
        properties.push(
            member
                .static_property_name()
                .map_or_else(|| "*".to_string(), str::to_owned),
        );
        current = member.object().get_inner_expression();
    }
}

fn non_null_state_path_changes_receiver(
    target: Option<(SymbolId, String)>,
    receiver_path: &str,
    alias_paths: &rustc_hash::FxHashMap<SymbolId, String>,
) -> bool {
    let Some((target_symbol_id, target_path)) = target else {
        return false;
    };
    let Some(alias_base_path) = alias_paths.get(&target_symbol_id) else {
        return false;
    };
    let target_root_name = target_path
        .split('.')
        .next()
        .unwrap_or(target_path.as_str());
    let target_suffix = target_path.strip_prefix(target_root_name).unwrap_or("");
    let canonical_target_path = format!("{alias_base_path}{target_suffix}");
    canonical_target_path == receiver_path
        || canonical_target_path.starts_with(&format!("{receiver_path}."))
        || receiver_path.starts_with(&format!("{canonical_target_path}."))
}

fn non_null_expression_symbol_state_path(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<(SymbolId, String)> {
    let (root, path) = non_null_expression_state_path(expression)?;
    Some((reference_symbol_id(root, ctx)?, path))
}

fn non_null_member_symbol_state_path(
    member: &MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<(SymbolId, String)> {
    let (root, object_path) = non_null_expression_state_path(member.object())?;
    let property = member
        .static_property_name()
        .map_or_else(|| "*".to_string(), str::to_owned);
    Some((
        reference_symbol_id(root, ctx)?,
        format!("{object_path}.{property}"),
    ))
}

fn non_null_assignment_target_state_path(
    target: &AssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<(SymbolId, String)> {
    if let AssignmentTarget::AssignmentTargetIdentifier(identifier) = target {
        return Some((
            reference_symbol_id(identifier, ctx)?,
            identifier.name.to_string(),
        ));
    }
    non_null_member_symbol_state_path(target.as_member_expression()?, ctx)
}

fn non_null_simple_assignment_target_state_path(
    target: &SimpleAssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<(SymbolId, String)> {
    if let SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) = target {
        return Some((
            reference_symbol_id(identifier, ctx)?,
            identifier.name.to_string(),
        ));
    }
    non_null_member_symbol_state_path(target.as_member_expression()?, ctx)
}

fn non_null_two_parameter_function_parts<'a>(
    function_node: &'a AstNode<'a>,
) -> Option<(&'a str, &'a str, &'a Expression<'a>)> {
    let (parameters, body) = match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) if !function.r#async => {
            (function.params.items.as_slice(), function.get_expression()?)
        }
        AstKind::Function(function) if !function.r#async && !function.generator => {
            let body = function.body.as_ref()?;
            if !body.directives.is_empty() || body.statements.len() != 1 {
                return None;
            }
            let oxc_ast::ast::Statement::ReturnStatement(statement) = &body.statements[0] else {
                return None;
            };
            (
                function.params.items.as_slice(),
                statement.argument.as_ref()?,
            )
        }
        _ => return None,
    };
    let accumulator = parameters.first()?;
    let item = parameters.get(1)?;
    let BindingPattern::BindingIdentifier(accumulator) = &accumulator.pattern else {
        return None;
    };
    let BindingPattern::BindingIdentifier(item) = &item.pattern else {
        return None;
    };
    Some((accumulator.name.as_str(), item.name.as_str(), body))
}

fn non_null_maximum_guard_dominates(
    assertion: &AstNode<'_>,
    maximum_symbol_id: SymbolId,
    initial_value: f64,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child = assertion;
    for ancestor in ctx.nodes().ancestors(assertion.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let test = match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(child.span()) =>
            {
                Some(&statement.test)
            }
            AstKind::ConditionalExpression(conditional)
                if conditional
                    .consequent
                    .span()
                    .contains_inclusive(child.span()) =>
            {
                Some(&conditional.test)
            }
            AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And
                    && logical.right.span().contains_inclusive(child.span()) =>
            {
                Some(&logical.left)
            }
            _ => None,
        };
        if test.is_some_and(|test| {
            let Expression::BinaryExpression(binary) = test.get_inner_expression() else {
                return false;
            };
            [
                (&binary.left, &binary.right, binary.operator),
                (&binary.right, &binary.left, match binary.operator {
                    BinaryOperator::LessThan => BinaryOperator::GreaterThan,
                    BinaryOperator::GreaterThan => BinaryOperator::LessThan,
                    operator => operator,
                }),
            ]
            .into_iter()
            .any(|(candidate_maximum, candidate_initial, operator)| {
                operator == BinaryOperator::GreaterThan
                    && matches!(candidate_maximum.get_inner_expression(), Expression::Identifier(identifier) if reference_symbol_id(identifier, ctx) == Some(maximum_symbol_id))
                    && matches!(candidate_initial.get_inner_expression(), Expression::NumericLiteral(literal) if literal.value == initial_value)
            })
        }) {
            return true;
        }
        child = ancestor;
    }
    false
}

fn is_ensure_then_find<'a>(
    assertion: &AstNode<'a>,
    find_call: &oxc_ast::ast::CallExpression<'a>,
    receiver: &Expression<'a>,
    call_node_ids: &[NodeId],
    ctx: &LintContext<'a>,
) -> bool {
    let Some((lookup_property, lookup_value)) = find_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .and_then(non_null_find_equality_parts)
    else {
        return false;
    };
    let mut child = assertion;
    for ancestor in ctx.nodes().ancestors(assertion.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => block.body.as_slice(),
            AstKind::FunctionBody(body) => body.statements.as_slice(),
            _ => {
                child = ancestor;
                continue;
            }
        };
        for statement in statements {
            if statement.span().start >= child.span().start {
                break;
            }
            let oxc_ast::ast::Statement::IfStatement(statement) = statement else {
                continue;
            };
            if statement.alternate.is_some()
                || !non_null_negative_find_guard(&statement.test, find_call, receiver, ctx)
            {
                continue;
            }
            if call_node_ids.iter().any(|node_id| {
                let candidate = ctx.nodes().get_node(*node_id);
                let AstKind::CallExpression(call) = candidate.kind() else {
                    return false;
                };
                if !statement.consequent.span().contains_inclusive(call.span) {
                    return false;
                }
                let Some(member) = call.callee.get_member_expr() else {
                    return false;
                };
                if member.static_property_name().as_deref() != Some("push")
                    || !non_null_expressions_structurally_equal(member.object(), receiver, ctx)
                {
                    return false;
                }
                let Some(Expression::ObjectExpression(pushed_value)) = call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .map(Expression::get_inner_expression)
                else {
                    return false;
                };
                pushed_value.properties.iter().any(|property| {
                    let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property
                    else {
                        return false;
                    };
                    !property.computed
                        && property.key.static_name().as_deref() == Some(lookup_property.as_str())
                        && non_null_expressions_structurally_equal(
                            &property.value,
                            lookup_value,
                            ctx,
                        )
                })
            }) {
                return true;
            }
        }
        child = ancestor;
    }
    false
}

fn non_null_find_is_guarded<'a>(
    assertion: &AstNode<'a>,
    find_call: &oxc_ast::ast::CallExpression<'a>,
    receiver: &Expression<'a>,
    predicate: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !non_null_predicate_is_stable(predicate, ctx) {
        return false;
    }
    let mut child = assertion;
    for ancestor in ctx.nodes().ancestors(assertion.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        match ancestor.kind() {
            AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And
                    && logical.right.span().contains_inclusive(child.span())
                    && non_null_positive_find_guard(&logical.left, find_call, receiver, ctx) =>
            {
                return true;
            }
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(child.span())
                    && non_null_positive_find_guard(&statement.test, find_call, receiver, ctx) =>
            {
                return true;
            }
            AstKind::IfStatement(statement)
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(child.span()))
                    && non_null_negative_find_guard(&statement.test, find_call, receiver, ctx) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(conditional)
                if conditional
                    .consequent
                    .span()
                    .contains_inclusive(child.span())
                    && non_null_positive_find_guard(
                        &conditional.test,
                        find_call,
                        receiver,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(conditional)
                if conditional
                    .alternate
                    .span()
                    .contains_inclusive(child.span())
                    && non_null_negative_find_guard(
                        &conditional.test,
                        find_call,
                        receiver,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::BlockStatement(block) => {
                for statement in &block.body {
                    if statement.span().start >= child.span().start {
                        break;
                    }
                    let oxc_ast::ast::Statement::IfStatement(statement) = statement else {
                        continue;
                    };
                    if statement.alternate.is_none()
                        && statement_always_exits(&statement.consequent)
                        && non_null_negative_find_guard(&statement.test, find_call, receiver, ctx)
                    {
                        return true;
                    }
                    if statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| statement_always_exits(alternate))
                        && non_null_positive_find_guard(&statement.test, find_call, receiver, ctx)
                    {
                        return true;
                    }
                }
            }
            _ => {}
        }
        child = ancestor;
    }
    false
}

fn non_null_positive_find_guard<'a>(
    test: &Expression<'a>,
    find_call: &oxc_ast::ast::CallExpression<'a>,
    receiver: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let test = test.get_inner_expression();
    if let Expression::LogicalExpression(logical) = test {
        return match logical.operator {
            LogicalOperator::And => {
                non_null_positive_find_guard(&logical.left, find_call, receiver, ctx)
                    || non_null_positive_find_guard(&logical.right, find_call, receiver, ctx)
            }
            LogicalOperator::Or => {
                non_null_positive_find_guard(&logical.left, find_call, receiver, ctx)
                    && non_null_positive_find_guard(&logical.right, find_call, receiver, ctx)
            }
            LogicalOperator::Coalesce => false,
        };
    }
    if let Expression::CallExpression(call) = test {
        return non_null_matching_guard_method(call, find_call, receiver, ctx) == Some("some")
            || non_null_projected_includes_proves_find(call, find_call, receiver, ctx);
    }
    let Expression::BinaryExpression(binary) = test else {
        return false;
    };
    for (candidate, comparison_value) in
        [(&binary.left, &binary.right), (&binary.right, &binary.left)]
    {
        let Expression::CallExpression(call) = candidate.get_inner_expression() else {
            continue;
        };
        match non_null_matching_guard_method(call, find_call, receiver, ctx) {
            Some("some")
                if (matches!(
                    binary.operator,
                    BinaryOperator::Equality | BinaryOperator::StrictEquality
                ) && non_null_boolean_value(comparison_value, true))
                    || (matches!(
                        binary.operator,
                        BinaryOperator::Inequality | BinaryOperator::StrictInequality
                    ) && non_null_boolean_value(comparison_value, false)) =>
            {
                return true;
            }
            Some("findIndex")
                if matches!(
                    binary.operator,
                    BinaryOperator::Inequality | BinaryOperator::StrictInequality
                ) && non_null_negative_one(comparison_value) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn non_null_projected_includes_proves_find<'a>(
    guard_call: &oxc_ast::ast::CallExpression<'a>,
    find_call: &oxc_ast::ast::CallExpression<'a>,
    find_receiver: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(guard_member) = guard_call.callee.get_member_expr() else {
        return false;
    };
    if guard_member.static_property_name().as_deref() != Some("includes") {
        return false;
    }
    let Expression::Identifier(projection_identifier) =
        guard_member.object().get_inner_expression()
    else {
        return false;
    };
    let Some(projection_initializer) =
        resolve_direct_unreassigned_initializer(projection_identifier, ctx)
    else {
        return false;
    };
    let Expression::CallExpression(projection_call) = projection_initializer.get_inner_expression()
    else {
        return false;
    };
    let Some(projection_member) = projection_call.callee.get_member_expr() else {
        return false;
    };
    if projection_member.static_property_name().as_deref() != Some("map")
        || !non_null_expressions_structurally_equal(projection_member.object(), find_receiver, ctx)
    {
        return false;
    }
    let Some(find_predicate) = find_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some((find_property, find_value)) = non_null_find_equality_parts(find_predicate) else {
        return false;
    };
    let Some(included_value) = guard_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    if !non_null_expressions_structurally_equal(included_value, find_value, ctx) {
        return false;
    }
    let Some(projection_callback) = projection_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(projection_function_id) = non_null_resolve_function_node(projection_callback, ctx)
    else {
        return false;
    };
    let projection_function = ctx.nodes().get_node(projection_function_id);
    let Some((projection_parameter, projection_body)) =
        non_null_single_expression_function_parts(projection_function)
    else {
        return false;
    };
    let Some(projection_body_member) = projection_body.get_member_expr() else {
        return false;
    };
    matches!(projection_body_member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == projection_parameter)
        && projection_body_member.static_property_name().as_deref() == Some(find_property.as_str())
}

fn non_null_find_equality_parts<'a>(
    predicate: &'a Expression<'a>,
) -> Option<(String, &'a Expression<'a>)> {
    let (parameter, body) = non_null_callback_parts(predicate)?;
    let Expression::BinaryExpression(binary) = body.get_inner_expression() else {
        return None;
    };
    if binary.operator != BinaryOperator::StrictEquality {
        return None;
    }
    for (candidate_member, compared_value) in
        [(&binary.left, &binary.right), (&binary.right, &binary.left)]
    {
        let Some(member) = candidate_member
            .get_inner_expression()
            .as_member_expression()
        else {
            continue;
        };
        if matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == parameter)
            && let Some(property_name) = non_null_find_property_name(member)
        {
            return Some((property_name, compared_value));
        }
    }
    None
}

fn non_null_find_property_name(member: &MemberExpression<'_>) -> Option<String> {
    if let Some(property_name) = member.static_property_name() {
        return Some(property_name.to_owned());
    }
    let MemberExpression::ComputedMemberExpression(member) = member else {
        return None;
    };
    match member.expression.get_inner_expression() {
        Expression::NumericLiteral(literal) => Some(literal.value.to_string()),
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        _ => None,
    }
}

fn non_null_callback_parts<'a>(
    callback: &'a Expression<'a>,
) -> Option<(&'a str, &'a Expression<'a>)> {
    let (parameters, body) = match callback.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            (function.params.items.as_slice(), function.get_expression()?)
        }
        Expression::FunctionExpression(function) => {
            let body = function.body.as_ref()?;
            if !body.directives.is_empty() || body.statements.len() != 1 {
                return None;
            }
            let oxc_ast::ast::Statement::ReturnStatement(statement) = &body.statements[0] else {
                return None;
            };
            (
                function.params.items.as_slice(),
                statement.argument.as_ref()?,
            )
        }
        _ => return None,
    };
    let BindingPattern::BindingIdentifier(parameter) = &parameters.first()?.pattern else {
        return None;
    };
    Some((parameter.name.as_str(), body))
}

fn non_null_single_expression_function_parts<'a>(
    function_node: &'a AstNode<'a>,
) -> Option<(&'a str, &'a Expression<'a>)> {
    let (parameters, body) = match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) => {
            (function.params.items.as_slice(), function.get_expression()?)
        }
        AstKind::Function(function) => {
            let body = function.body.as_ref()?;
            if !body.directives.is_empty() || body.statements.len() != 1 {
                return None;
            }
            let oxc_ast::ast::Statement::ReturnStatement(statement) = &body.statements[0] else {
                return None;
            };
            (
                function.params.items.as_slice(),
                statement.argument.as_ref()?,
            )
        }
        _ => return None,
    };
    let BindingPattern::BindingIdentifier(parameter) = &parameters.first()?.pattern else {
        return None;
    };
    Some((parameter.name.as_str(), body))
}

fn non_null_negative_find_guard<'a>(
    test: &Expression<'a>,
    find_call: &oxc_ast::ast::CallExpression<'a>,
    receiver: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let test = test.get_inner_expression();
    if let Expression::UnaryExpression(unary) = test
        && unary.operator == UnaryOperator::LogicalNot
    {
        return non_null_positive_find_guard(&unary.argument, find_call, receiver, ctx);
    }
    let Expression::BinaryExpression(binary) = test else {
        return false;
    };
    for (candidate, comparison_value) in
        [(&binary.left, &binary.right), (&binary.right, &binary.left)]
    {
        let Expression::CallExpression(call) = candidate.get_inner_expression() else {
            continue;
        };
        if non_null_matching_guard_method(call, find_call, receiver, ctx) == Some("some")
            && ((matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            ) && non_null_boolean_value(comparison_value, false))
                || (matches!(
                    binary.operator,
                    BinaryOperator::Inequality | BinaryOperator::StrictInequality
                ) && non_null_boolean_value(comparison_value, true)))
        {
            return true;
        }
    }
    false
}

fn non_null_matching_guard_method<'a>(
    candidate: &oxc_ast::ast::CallExpression<'a>,
    find_call: &oxc_ast::ast::CallExpression<'a>,
    receiver: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    let member = candidate.callee.get_member_expr()?;
    let method = match member.static_property_name()? {
        "some" => "some",
        "findIndex" => "findIndex",
        _ => return None,
    };
    let candidate_predicate = candidate.arguments.first()?.as_expression()?;
    let find_predicate = find_call.arguments.first()?.as_expression()?;
    if !non_null_predicate_is_stable(candidate_predicate, ctx) {
        return None;
    }
    (non_null_expressions_structurally_equal(member.object(), receiver, ctx)
        && non_null_expressions_structurally_equal(candidate_predicate, find_predicate, ctx))
    .then_some(method)
}

fn non_null_predicate_is_stable<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        if identifier.name == "Boolean" && ctx.is_reference_to_global_variable(identifier) {
            return true;
        }
    }
    let Some(function_id) =
        non_null_exact_local_function_id(expression, ctx, &mut Vec::new(), true)
    else {
        return false;
    };
    let function_node = ctx.nodes().get_node(function_id);
    let body_span = match function_node.kind() {
        AstKind::Function(function) => function.body.as_ref().map(|body| body.span()),
        AstKind::ArrowFunctionExpression(function) => Some(function.body.span()),
        _ => None,
    };
    body_span.is_some_and(|span| non_null_function_span_is_stable(span, ctx))
}

fn non_null_function_span_is_stable(span: oxc_span::Span, ctx: &LintContext<'_>) -> bool {
    !ctx.nodes().iter().any(|candidate| {
        if !span.contains_inclusive(candidate.span())
            || !matches!(
                candidate.kind(),
                AstKind::CallExpression(_)
                    | AstKind::AssignmentExpression(_)
                    | AstKind::UpdateExpression(_)
            )
        {
            return false;
        }
        if candidate.span() == span {
            return true;
        }
        for ancestor in ctx.nodes().ancestors(candidate.id()).skip(1) {
            if ancestor.span() == span {
                return true;
            }
            if matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                return false;
            }
        }
        false
    })
}

fn non_null_boolean_value(expression: &Expression<'_>, expected: bool) -> bool {
    matches!(expression.get_inner_expression(), Expression::BooleanLiteral(literal) if literal.value == expected)
}

fn non_null_negative_one(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::UnaryNegation && matches!(unary.argument.get_inner_expression(), Expression::NumericLiteral(literal) if literal.value == 1.0))
}

fn non_null_normalized_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .replace("?.", ".")
}

fn non_null_structural_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn non_null_expressions_structurally_equal(
    first: &Expression<'_>,
    second: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::ThisExpression(_), Expression::ThisExpression(_))
        | (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            first.name == second.name
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
            first.raw == second.raw
        }
        (Expression::RegExpLiteral(first), Expression::RegExpLiteral(second)) => {
            first.regex.pattern.text == second.regex.pattern.text
                && first.regex.flags == second.regex.flags
        }
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            first.optional == second.optional
                && non_null_expressions_structurally_equal(&first.callee, &second.callee, ctx)
                && first.arguments.len() == second.arguments.len()
                && first.arguments.iter().zip(&second.arguments).all(
                    |(first_argument, second_argument)| {
                        let (Some(first_argument), Some(second_argument)) = (
                            first_argument.as_expression(),
                            second_argument.as_expression(),
                        ) else {
                            return false;
                        };
                        non_null_expressions_structurally_equal(
                            first_argument,
                            second_argument,
                            ctx,
                        )
                    },
                )
        }
        _ => match (first.as_member_expression(), second.as_member_expression()) {
            (Some(first_member), Some(second_member)) => {
                non_null_member_expressions_structurally_equal(first_member, second_member, ctx)
            }
            _ => {
                non_null_structural_source(ctx.source_range(first.span()))
                    == non_null_structural_source(ctx.source_range(second.span()))
            }
        },
    }
}

fn non_null_member_expressions_structurally_equal(
    first: &MemberExpression<'_>,
    second: &MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if first.optional() != second.optional() {
        return false;
    }
    match (first, second) {
        (
            MemberExpression::StaticMemberExpression(first),
            MemberExpression::StaticMemberExpression(second),
        ) => {
            first.property.name == second.property.name
                && non_null_expressions_structurally_equal(&first.object, &second.object, ctx)
        }
        (
            MemberExpression::ComputedMemberExpression(first),
            MemberExpression::ComputedMemberExpression(second),
        ) => {
            non_null_expressions_structurally_equal(&first.object, &second.object, ctx)
                && non_null_expressions_structurally_equal(
                    &first.expression,
                    &second.expression,
                    ctx,
                )
        }
        (
            MemberExpression::PrivateFieldExpression(first),
            MemberExpression::PrivateFieldExpression(second),
        ) => {
            first.field.name == second.field.name
                && non_null_expressions_structurally_equal(&first.object, &second.object, ctx)
        }
        _ => false,
    }
}

fn exhaustive_const_tuple_lookup(
    _assertion: &AstNode<'_>,
    receiver: &Expression<'_>,
    predicate: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = reference_symbol_id(identifier, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return false;
    }
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
        || non_null_receiver_has_mutating_call(symbol_id, ctx)
        || non_null_receiver_is_assigned_through_member(symbol_id, ctx)
    {
        return false;
    }
    let Some(Expression::ArrayExpression(array)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if array.elements.is_empty() {
        return false;
    }
    let Some((property_name, compared_value)) = non_null_find_equality_parts(predicate) else {
        return false;
    };
    if property_name != "0" {
        return false;
    }
    let Expression::Identifier(compared_identifier) = compared_value.get_inner_expression() else {
        return false;
    };
    let Some(compared_symbol_id) = reference_symbol_id(compared_identifier, ctx) else {
        return false;
    };
    if ctx
        .scoping()
        .get_resolved_references(compared_symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    let Some(type_source) = non_null_symbol_type_source(compared_symbol_id, ctx) else {
        return false;
    };
    exhaustive_mapping_values_match_type(array, type_source, ctx.source_text())
}

fn exhaustive_mapping_values_match_type(
    array: &oxc_ast::ast::ArrayExpression<'_>,
    type_source: &str,
    source_text: &str,
) -> bool {
    let compact_type = compact_source(type_source);
    let union = if compact_type
        .chars()
        .all(|character| character == '_' || character == '$' || character.is_alphanumeric())
    {
        let compact_source_text = compact_source(source_text);
        let Some(union_start) = compact_source_text.find(&format!("type{compact_type}=")) else {
            return false;
        };
        compact_source_text[union_start + compact_type.len() + 5..]
            .split(';')
            .next()
            .unwrap_or("")
            .to_string()
    } else {
        compact_type
    };
    let expected_values = union
        .split('|')
        .map(non_null_type_literal_value_key)
        .collect::<Option<std::collections::HashSet<_>>>();
    let Some(expected_values) = expected_values.filter(|values| !values.is_empty()) else {
        return false;
    };
    let mut table_values = std::collections::HashSet::new();
    for element in &array.elements {
        let Some(Expression::ArrayExpression(tuple)) = element
            .as_expression()
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        let Some(value) = tuple
            .elements
            .first()
            .and_then(ArrayExpressionElement::as_expression)
        else {
            return false;
        };
        let Some(value_key) = non_null_expression_literal_value_key(value) else {
            return false;
        };
        table_values.insert(value_key);
    }
    table_values == expected_values
}

fn non_null_receiver_has_mutating_call(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let identifier = ctx.nodes().get_node(reference.node_id());
            let member = ctx.nodes().parent_node(identifier.id());
            let member_matches = matches!(member.kind(), AstKind::StaticMemberExpression(expression) if expression.object.span() == identifier.span())
                || matches!(member.kind(), AstKind::ComputedMemberExpression(expression) if expression.object.span() == identifier.span())
                || matches!(member.kind(), AstKind::PrivateFieldExpression(expression) if expression.object.span() == identifier.span());
            if !member_matches {
                return false;
            }
            let call = ctx.nodes().parent_node(member.id());
            let AstKind::CallExpression(call) = call.kind() else {
                return false;
            };
            if call.callee.span() != member.span() {
                return false;
            }
            let Some(member) = call.callee.get_member_expr() else {
                return false;
            };
            matches!(
                member.static_property_name().as_deref(),
                Some(
                    "copyWithin"
                        | "fill"
                        | "pop"
                        | "push"
                        | "reverse"
                        | "shift"
                        | "sort"
                        | "splice"
                        | "unshift"
                )
            )
        })
}

fn non_null_receiver_is_assigned_through_member(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|node| {
        let target = match node.kind() {
            AstKind::AssignmentExpression(assignment) => {
                non_null_assignment_target_state_path(&assignment.left, ctx)
            }
            AstKind::UpdateExpression(update) => {
                non_null_simple_assignment_target_state_path(&update.argument, ctx)
            }
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                non_null_expression_symbol_state_path(&unary.argument, ctx)
            }
            _ => None,
        };
        target.is_some_and(|(target_symbol_id, _)| target_symbol_id == symbol_id)
    })
}

fn non_null_symbol_type_source<'a>(symbol_id: SymbolId, ctx: &LintContext<'a>) -> Option<&'a str> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let type_annotation = match declaration.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id) =>
        {
            declarator.type_annotation.as_ref()
        }
        AstKind::FormalParameter(parameter)
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id) =>
        {
            parameter.type_annotation.as_ref()
        }
        _ => None,
    }?;
    Some(ctx.source_range(type_annotation.type_annotation.span()))
}

fn non_null_type_literal_value_key(value: &str) -> Option<String> {
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        return Some(format!("string:{}", &value[1..value.len() - 1]));
    }
    if matches!(value, "true" | "false") {
        return Some(format!("boolean:{value}"));
    }
    value
        .parse::<f64>()
        .ok()
        .map(|number| format!("number:{number}"))
}

fn non_null_expression_literal_value_key(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(format!("string:{}", literal.value)),
        Expression::BooleanLiteral(literal) => Some(format!("boolean:{}", literal.value)),
        Expression::NumericLiteral(literal) => Some(format!("number:{}", literal.value)),
        _ => None,
    }
}

fn regex_is_always_matching(pattern: &Expression<'_>) -> bool {
    let Expression::RegExpLiteral(regex) = pattern.get_inner_expression() else {
        return false;
    };
    let pattern = regex.regex.pattern.text.as_str();
    let flags = regex.regex.flags;
    let (has_start_anchor, without_start_anchor) = pattern
        .strip_prefix('^')
        .map_or((false, pattern), |remaining| (true, remaining));
    let (has_end_anchor, without_anchors) = without_start_anchor
        .strip_suffix('$')
        .map_or((false, without_start_anchor), |remaining| (true, remaining));
    let Some(atom) = without_anchors.strip_suffix('*') else {
        return false;
    };
    let is_single_atom = atom == "."
        || atom.strip_prefix('\\').is_some_and(|escaped| {
            escaped.len() == 1 && escaped.as_bytes()[0].is_ascii_alphabetic()
        })
        || atom.starts_with('[')
            && atom.ends_with(']')
            && atom[1..atom.len() - 1].find(']').is_none();
    if !is_single_atom {
        return false;
    }
    let must_reach_end_boundary =
        has_end_anchor && (has_start_anchor || flags.contains(RegExpFlags::Y));
    if !must_reach_end_boundary {
        return true;
    }
    matches!(
        atom,
        "[^]" | "[\\s\\S]" | "[\\S\\s]" | "[\\d\\D]" | "[\\D\\d]" | "[\\w\\W]" | "[\\W\\w]"
    ) || atom == "." && (flags.contains(RegExpFlags::S) || flags.contains(RegExpFlags::M))
        || flags.contains(RegExpFlags::M)
            && matches!(atom, "[^\\n]" | "[^\\r]" | "[^\\r\\n]" | "[^\\n\\r]")
}

fn match_result_is_proven(
    assertion: &AstNode<'_>,
    _call: &oxc_ast::ast::CallExpression<'_>,
    receiver: &Expression<'_>,
    pattern: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    non_null_match_is_guarded(assertion, receiver, pattern, ctx)
        || non_null_anchored_character_match_is_guarded(assertion, receiver, pattern, ctx)
}

fn non_null_match_is_guarded(
    assertion: &AstNode<'_>,
    receiver: &Expression<'_>,
    pattern: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child = assertion;
    for ancestor in ctx.nodes().ancestors(assertion.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        match ancestor.kind() {
            AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And
                    && logical.right.span().contains_inclusive(child.span())
                    && non_null_match_test_proves(&logical.left, true, receiver, pattern, ctx) =>
            {
                return true;
            }
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(child.span())
                    && non_null_match_test_proves(
                        &statement.test,
                        true,
                        receiver,
                        pattern,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::IfStatement(statement)
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(child.span()))
                    && non_null_match_test_proves(
                        &statement.test,
                        false,
                        receiver,
                        pattern,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(conditional)
                if conditional
                    .consequent
                    .span()
                    .contains_inclusive(child.span())
                    && non_null_match_test_proves(
                        &conditional.test,
                        true,
                        receiver,
                        pattern,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(conditional)
                if conditional
                    .alternate
                    .span()
                    .contains_inclusive(child.span())
                    && non_null_match_test_proves(
                        &conditional.test,
                        false,
                        receiver,
                        pattern,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::BlockStatement(block) => {
                for statement in &block.body {
                    if statement.span().start >= child.span().start {
                        break;
                    }
                    let oxc_ast::ast::Statement::IfStatement(statement) = statement else {
                        continue;
                    };
                    if statement.alternate.is_none()
                        && statement_always_exits(&statement.consequent)
                        && non_null_match_test_proves(
                            &statement.test,
                            false,
                            receiver,
                            pattern,
                            ctx,
                        )
                    {
                        return true;
                    }
                    if statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| statement_always_exits(alternate))
                        && non_null_match_test_proves(&statement.test, true, receiver, pattern, ctx)
                    {
                        return true;
                    }
                }
            }
            _ => {}
        }
        child = ancestor;
    }
    false
}

fn non_null_match_test_proves(
    test: &Expression<'_>,
    expected_truthy: bool,
    receiver: &Expression<'_>,
    pattern: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let test = test.get_inner_expression();
    if let Expression::UnaryExpression(unary) = test
        && unary.operator == UnaryOperator::LogicalNot
    {
        return non_null_match_test_proves(
            &unary.argument,
            !expected_truthy,
            receiver,
            pattern,
            ctx,
        );
    }
    if let Expression::LogicalExpression(logical) = test {
        let left =
            non_null_match_test_proves(&logical.left, expected_truthy, receiver, pattern, ctx);
        let right =
            non_null_match_test_proves(&logical.right, expected_truthy, receiver, pattern, ctx);
        return match (logical.operator, expected_truthy) {
            (LogicalOperator::And, true) | (LogicalOperator::Or, false) => left || right,
            (LogicalOperator::Or, true) | (LogicalOperator::And, false) => left && right,
            (LogicalOperator::Coalesce, _) => false,
        };
    }
    if let Expression::CallExpression(call) = test {
        return expected_truthy && non_null_call_proves_match(call, receiver, pattern, ctx);
    }
    let Expression::BinaryExpression(binary) = test else {
        return false;
    };
    for (candidate, comparison_value) in
        [(&binary.left, &binary.right), (&binary.right, &binary.left)]
    {
        let Expression::CallExpression(call) = candidate.get_inner_expression() else {
            continue;
        };
        if !non_null_call_proves_match(call, receiver, pattern, ctx) {
            continue;
        }
        let comparison_truth_requires_call = (matches!(
            binary.operator,
            BinaryOperator::Equality | BinaryOperator::StrictEquality
        ) && non_null_boolean_value(comparison_value, true))
            || (matches!(
                binary.operator,
                BinaryOperator::Inequality | BinaryOperator::StrictInequality
            ) && non_null_boolean_value(comparison_value, false));
        let comparison_false_requires_call = (matches!(
            binary.operator,
            BinaryOperator::Equality | BinaryOperator::StrictEquality
        ) && non_null_boolean_value(comparison_value, false))
            || (matches!(
                binary.operator,
                BinaryOperator::Inequality | BinaryOperator::StrictInequality
            ) && non_null_boolean_value(comparison_value, true));
        if (expected_truthy && comparison_truth_requires_call)
            || (!expected_truthy && comparison_false_requires_call)
        {
            return true;
        }
    }
    false
}

fn non_null_call_proves_match(
    call: &oxc_ast::ast::CallExpression<'_>,
    receiver: &Expression<'_>,
    pattern: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_member_expr() else {
        return false;
    };
    match member.static_property_name().as_deref() {
        Some("test") => {
            call.arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| {
                    non_null_expressions_structurally_equal(argument, receiver, ctx)
                })
                && non_null_regex_key(member.object(), ctx) == non_null_regex_key(pattern, ctx)
        }
        Some("match") => {
            non_null_expressions_structurally_equal(member.object(), receiver, ctx)
                && call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| {
                        non_null_regex_key(argument, ctx) == non_null_regex_key(pattern, ctx)
                    })
        }
        _ => false,
    }
}

fn non_null_regex_key(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::RegExpLiteral(regex) => {
            let flags = [
                (RegExpFlags::D, 'd'),
                (RegExpFlags::I, 'i'),
                (RegExpFlags::M, 'm'),
                (RegExpFlags::S, 's'),
                (RegExpFlags::U, 'u'),
                (RegExpFlags::V, 'v'),
            ]
            .into_iter()
            .filter_map(|(flag, character)| regex.regex.flags.contains(flag).then_some(character))
            .collect::<String>();
            Some(format!("regex:{}:{flags}", regex.regex.pattern.text))
        }
        Expression::Identifier(identifier) => reference_symbol_id(identifier, ctx)
            .map(|symbol_id| format!("symbol:{}", symbol_id.index()))
            .or_else(|| Some(format!("global:{}", identifier.name))),
        expression if expression.as_member_expression().is_some() => {
            non_null_regex_member_path(expression).map(|path| format!("path:{path}"))
        }
        _ => None,
    }
}

fn non_null_regex_member_path(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::ThisExpression(_) => Some("this".to_string()),
        Expression::StaticMemberExpression(member) => Some(format!(
            "{}.{}",
            non_null_regex_member_path(&member.object)?,
            member.property.name
        )),
        _ => None,
    }
}

fn non_null_match_proven_by_find_up_until<'a>(
    assertion: &AstNode<'a>,
    match_receiver: &Expression<'a>,
    pattern: &Expression<'a>,
    call_node_ids: &[NodeId],
    ctx: &LintContext<'a>,
) -> bool {
    non_null_direct_find_up_until_match(assertion, match_receiver, pattern, call_node_ids, ctx)
        || non_null_normalized_find_up_until_match(
            assertion,
            match_receiver,
            pattern,
            call_node_ids,
            ctx,
        )
}

fn non_null_direct_find_up_until_match<'a>(
    assertion: &AstNode<'a>,
    match_receiver: &Expression<'a>,
    pattern: &Expression<'a>,
    call_node_ids: &[NodeId],
    ctx: &LintContext<'a>,
) -> bool {
    let Some((result_identifier, result_path, has_optional_access)) =
        non_null_static_receiver_path(match_receiver)
    else {
        return false;
    };
    let Some(result_symbol_id) = reference_symbol_id(result_identifier, ctx) else {
        return false;
    };
    if !has_optional_access && !non_null_is_direct_finder_match_return(assertion, ctx) {
        return false;
    }
    if ctx
        .scoping()
        .get_resolved_references(result_symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    let result_declaration = ctx.symbol_declaration(result_symbol_id);
    let AstKind::VariableDeclarator(result_declarator) = result_declaration.kind() else {
        return false;
    };
    let result_declaration_parent = ctx.nodes().parent_node(result_declaration.id());
    if !matches!(result_declaration_parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return false;
    }
    let Some(initializer) = result_declarator.init.as_ref() else {
        return false;
    };
    let finder_call = match initializer.get_inner_expression() {
        Expression::CallExpression(call) => call,
        Expression::ConditionalExpression(conditional)
            if has_optional_access && non_null_is_nullish(&conditional.alternate, ctx) =>
        {
            let Expression::CallExpression(call) = conditional.consequent.get_inner_expression()
            else {
                return false;
            };
            call
        }
        _ => return false,
    };
    let is_imported_find_up_until = imported_module_api_matches(
        &finder_call.callee,
        "findUpUntil",
        "@cloudscape-design/component-toolkit/dom",
        ctx,
    );
    let is_global_find_up_until = matches!(finder_call.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "findUpUntil" && ctx.is_reference_to_global_variable(identifier));
    if !is_imported_find_up_until && !is_global_find_up_until {
        return false;
    }
    if !has_optional_access
        && !non_null_find_up_until_result_is_guarded(
            assertion,
            result_symbol_id,
            result_path.as_str(),
            ctx,
        )
    {
        return false;
    }
    let Some(predicate) = finder_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(predicate_node_id) = non_null_resolve_function_node(predicate, ctx) else {
        return false;
    };
    let predicate_node = ctx.nodes().get_node(predicate_node_id);
    let Some(predicate_parameter) = non_null_function_parameter_name(predicate_node) else {
        return false;
    };
    let asserted_regex_key = non_null_stable_regex_key(pattern, ctx);
    if asserted_regex_key.is_none() {
        return false;
    }
    let relative_path = result_path
        .strip_prefix(result_identifier.name.as_str())
        .unwrap_or(result_path.as_str());
    let predicate_span = predicate_node.span();
    let predicate_proves_match = call_node_ids.iter().any(|node_id| {
        let candidate = ctx.nodes().get_node(*node_id);
        let AstKind::CallExpression(match_call) = candidate.kind() else {
            return false;
        };
        if !predicate_span.contains_inclusive(match_call.span) {
            return false;
        }
        let Some(member) = match_call.callee.get_member_expr() else {
            return false;
        };
        if member.static_property_name().as_deref() != Some("match") {
            return false;
        }
        let Some(candidate_pattern) = match_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return false;
        };
        let Some((candidate_root, candidate_path, _)) =
            non_null_static_receiver_path(member.object())
        else {
            return false;
        };
        candidate_root.name == predicate_parameter
            && candidate_path
                .strip_prefix(predicate_parameter)
                .is_some_and(|path| path == relative_path)
            && non_null_stable_regex_key(candidate_pattern, ctx) == asserted_regex_key
            && non_null_predicate_match_requires_truth(candidate, predicate_node, ctx)
    });
    predicate_proves_match
}

fn non_null_is_direct_finder_match_return(assertion: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current = assertion;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if matches!(
            parent.kind(),
            AstKind::ParenthesizedExpression(_)
                | AstKind::TSAsExpression(_)
                | AstKind::TSSatisfiesExpression(_)
                | AstKind::TSTypeAssertion(_)
                | AstKind::TSInstantiationExpression(_)
                | AstKind::ChainExpression(_)
        ) {
            current = parent;
            continue;
        }
        if !matches!(
            parent.kind(),
            AstKind::StaticMemberExpression(member) if member.object.span() == current.span()
        ) && !matches!(
            parent.kind(),
            AstKind::ComputedMemberExpression(member) if member.object.span() == current.span()
        ) {
            return false;
        }
        let result_access = parent;
        let consumer = ctx.nodes().parent_node(result_access.id());
        if matches!(consumer.kind(), AstKind::ReturnStatement(statement) if statement.argument.as_ref().is_some_and(|argument| argument.span() == result_access.span()))
        {
            return true;
        }
        let AstKind::LogicalExpression(logical) = consumer.kind() else {
            return false;
        };
        if logical.operator != LogicalOperator::Coalesce
            || logical.left.span() != result_access.span()
        {
            return false;
        }
        let return_statement = ctx.nodes().parent_node(consumer.id());
        return matches!(return_statement.kind(), AstKind::ReturnStatement(statement) if statement.argument.as_ref().is_some_and(|argument| argument.span() == consumer.span()));
    }
}

fn non_null_is_nullish(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::NullLiteral(_)
    ) || matches!(expression.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier))
}

fn non_null_static_receiver_path<'a>(
    expression: &'a Expression<'a>,
) -> Option<(&'a oxc_ast::ast::IdentifierReference<'a>, String, bool)> {
    let mut current = expression.get_inner_expression();
    let mut properties: Vec<String> = Vec::new();
    let mut has_optional_access = false;
    loop {
        if let Expression::Identifier(identifier) = current {
            properties.reverse();
            let mut path = identifier.name.to_string();
            for property in properties {
                path.push('.');
                path.push_str(&property);
            }
            return Some((identifier, path, has_optional_access));
        }
        let member = current.as_member_expression()?;
        has_optional_access |= member.optional();
        properties.push(member.static_property_name()?.to_owned());
        current = member.object().get_inner_expression();
    }
}

fn non_null_find_up_until_result_is_guarded(
    assertion: &AstNode<'_>,
    result_symbol_id: SymbolId,
    result_path: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let declarator = ctx.symbol_declaration(result_symbol_id);
    let declaration = ctx.nodes().parent_node(declarator.id());
    let AstKind::VariableDeclaration(variable_declaration) = declaration.kind() else {
        return false;
    };
    if variable_declaration.declarations.len() != 1 {
        return false;
    }
    let declaration_block = ctx.nodes().parent_node(declaration.id());
    let AstKind::BlockStatement(block) = declaration_block.kind() else {
        return false;
    };
    let Some(declaration_index) = block
        .body
        .iter()
        .position(|statement| statement.span() == declaration.span())
    else {
        return false;
    };
    let Some(oxc_ast::ast::Statement::IfStatement(guard)) = block.body.get(declaration_index + 1)
    else {
        return false;
    };
    let oxc_ast::ast::Statement::BlockStatement(guarded_block) = &guard.consequent else {
        return false;
    };
    if !guarded_block
        .body
        .first()
        .is_some_and(|statement| statement.span().contains_inclusive(assertion.span()))
    {
        return false;
    }
    let Expression::LogicalExpression(logical) = guard.test.get_inner_expression() else {
        return false;
    };
    logical.operator == LogicalOperator::And
        && matches!(logical.left.get_inner_expression(), Expression::Identifier(identifier) if reference_symbol_id(identifier, ctx) == Some(result_symbol_id))
        && non_null_typeof_string_path(&logical.right, result_path, ctx)
}

fn non_null_typeof_string_path(
    expression: &Expression<'_>,
    expected_path: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::BinaryExpression(binary) = expression.get_inner_expression() else {
        return false;
    };
    if binary.operator != BinaryOperator::StrictEquality {
        return false;
    }
    [(&binary.left, &binary.right), (&binary.right, &binary.left)]
        .into_iter()
        .any(|(candidate_typeof, candidate_string)| {
            matches!(candidate_string.get_inner_expression(), Expression::StringLiteral(literal) if literal.value == "string")
                && matches!(candidate_typeof.get_inner_expression(), Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Typeof && non_null_normalized_source(ctx.source_range(unary.argument.span())) == expected_path)
        })
}

fn non_null_resolve_function_node<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    non_null_exact_local_function_id(expression, ctx, &mut Vec::new(), false)
}

fn non_null_function_parameter_name<'a>(function_node: &'a AstNode<'a>) -> Option<&'a str> {
    let parameter = match function_node.kind() {
        AstKind::Function(function) if !function.r#async && !function.generator => {
            function.params.items.first()
        }
        AstKind::ArrowFunctionExpression(function) if !function.r#async => {
            function.params.items.first()
        }
        _ => None,
    }?;
    let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn non_null_predicate_match_requires_truth(
    match_node: &AstNode<'_>,
    predicate_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut is_negated = false;
    let mut child = match_node;
    for ancestor in ctx.nodes().ancestors(match_node.id()).skip(1) {
        if ancestor.id() == predicate_node.id() {
            return matches!(predicate_node.kind(), AstKind::ArrowFunctionExpression(function) if function.get_expression().is_some_and(|body| body.span().contains_inclusive(child.span())))
                && !is_negated;
        }
        match ancestor.kind() {
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
                is_negated = !is_negated;
            }
            AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And
                    && logical.right.span().contains_inclusive(child.span()) => {}
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::ChainExpression(_) => {}
            AstKind::ReturnStatement(statement)
                if statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span().contains_inclusive(child.span())) =>
            {
                let body = ctx.nodes().parent_node(ancestor.id());
                return matches!(body.kind(), AstKind::FunctionBody(function_body) if function_body.directives.is_empty() && function_body.statements.len() == 1)
                    && ctx.nodes().parent_node(body.id()).id() == predicate_node.id()
                    && !is_negated;
            }
            _ => return false,
        }
        child = ancestor;
    }
    false
}

fn non_null_stable_regex_key(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::RegExpLiteral(regex)
            if !regex.regex.flags.contains(RegExpFlags::G)
                && !regex.regex.flags.contains(RegExpFlags::Y) =>
        {
            non_null_regex_key(expression, ctx)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = reference_symbol_id(identifier, ctx)?;
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write())
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            {
                return None;
            }
            let initializer = declarator.init.as_ref()?;
            let Expression::RegExpLiteral(regex) = initializer.get_inner_expression() else {
                return None;
            };
            if regex.regex.flags.contains(RegExpFlags::G)
                || regex.regex.flags.contains(RegExpFlags::Y)
            {
                return None;
            }
            non_null_regex_key(initializer, ctx)
        }
        _ => None,
    }
}

fn non_null_normalized_find_up_until_match<'a>(
    assertion: &AstNode<'a>,
    match_receiver: &Expression<'a>,
    pattern: &Expression<'a>,
    call_node_ids: &[NodeId],
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(normalized_identifier) = match_receiver.get_inner_expression()
    else {
        return false;
    };
    let Some(normalized_symbol_id) = reference_symbol_id(normalized_identifier, ctx) else {
        return false;
    };
    if ctx
        .scoping()
        .get_resolved_references(normalized_symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    let normalized_declaration = ctx.symbol_declaration(normalized_symbol_id);
    let AstKind::VariableDeclarator(normalized_declarator) = normalized_declaration.kind() else {
        return false;
    };
    let normalized_declaration_parent = ctx.nodes().parent_node(normalized_declaration.id());
    if !matches!(normalized_declaration_parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return false;
    }
    let Some(normalized_initializer) = normalized_declarator.init.as_ref() else {
        return false;
    };
    let Some(result_identifier) = non_null_normalized_class_name_root(normalized_initializer, ctx)
    else {
        return false;
    };
    let Some(result_symbol_id) = reference_symbol_id(result_identifier, ctx) else {
        return false;
    };
    if ctx
        .scoping()
        .get_resolved_references(result_symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    let result_declaration = ctx.symbol_declaration(result_symbol_id);
    let AstKind::VariableDeclarator(result_declarator) = result_declaration.kind() else {
        return false;
    };
    let result_declaration_parent = ctx.nodes().parent_node(result_declaration.id());
    if !matches!(result_declaration_parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return false;
    }
    let Some(Expression::CallExpression(finder_call)) = result_declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !imported_module_api_matches(
        &finder_call.callee,
        "findUpUntil",
        "@cloudscape-design/component-toolkit/dom",
        ctx,
    ) || !non_null_result_presence_dominates(assertion, result_symbol_id, ctx)
    {
        return false;
    }
    let Some(predicate) = finder_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(predicate_node_id) = non_null_resolve_function_node(predicate, ctx) else {
        return false;
    };
    let predicate_node = ctx.nodes().get_node(predicate_node_id);
    let Some(predicate_parameter) = non_null_function_parameter_name(predicate_node) else {
        return false;
    };
    let asserted_regex_key = non_null_stable_regex_key(pattern, ctx);
    if asserted_regex_key.is_none() {
        return false;
    }
    let predicate_span = predicate_node.span();
    call_node_ids.iter().any(|node_id| {
        let candidate = ctx.nodes().get_node(*node_id);
        let AstKind::CallExpression(match_call) = candidate.kind() else {
            return false;
        };
        if !predicate_span.contains_inclusive(match_call.span) {
            return false;
        }
        let Some(match_member) = match_call.callee.get_member_expr() else {
            return false;
        };
        if match_member.static_property_name().as_deref() != Some("match") {
            return false;
        }
        let Expression::Identifier(predicate_normalized_identifier) =
            match_member.object().get_inner_expression()
        else {
            return false;
        };
        let Some(predicate_normalized_symbol_id) =
            reference_symbol_id(predicate_normalized_identifier, ctx)
        else {
            return false;
        };
        if ctx
            .scoping()
            .get_resolved_references(predicate_normalized_symbol_id)
            .any(|reference| reference.is_write())
        {
            return false;
        }
        let predicate_normalized_declaration =
            ctx.symbol_declaration(predicate_normalized_symbol_id);
        let AstKind::VariableDeclarator(predicate_normalized_declarator) =
            predicate_normalized_declaration.kind()
        else {
            return false;
        };
        let predicate_normalized_parent =
            ctx.nodes().parent_node(predicate_normalized_declaration.id());
        if !matches!(predicate_normalized_parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()) {
            return false;
        }
        let Some(predicate_normalized_initializer) =
            predicate_normalized_declarator.init.as_ref()
        else {
            return false;
        };
        let Some(predicate_root) =
            non_null_normalized_class_name_root(predicate_normalized_initializer, ctx)
        else {
            return false;
        };
        let Some(candidate_pattern) = match_call.arguments.first().and_then(Argument::as_expression)
        else {
            return false;
        };
        predicate_root.name == predicate_parameter
            && non_null_stable_regex_key(candidate_pattern, ctx) == asserted_regex_key
            && (non_null_predicate_match_requires_truth(candidate, predicate_node, ctx)
                || non_null_predicate_returns_normalized_match(candidate, predicate_node, ctx))
    })
}

fn non_null_predicate_returns_normalized_match(
    match_node: &AstNode<'_>,
    predicate_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let body: Option<&oxc_ast::ast::FunctionBody<'_>> = match predicate_node.kind() {
        AstKind::Function(function) => function.body.as_ref().map(AsRef::as_ref),
        AstKind::ArrowFunctionExpression(function) => function.body.as_function_body(),
        _ => None,
    };
    let Some(body) = body else {
        return false;
    };
    if body.statements.len() != 2
        || !matches!(
            body.statements.first(),
            Some(oxc_ast::ast::Statement::VariableDeclaration(_))
        )
    {
        return false;
    }
    let Some(oxc_ast::ast::Statement::ReturnStatement(return_statement)) = body.statements.get(1)
    else {
        return false;
    };
    let Some(return_argument) = return_statement.argument.as_ref() else {
        return false;
    };
    let mut negation_count = 0;
    let mut child = match_node;
    for ancestor in ctx.nodes().ancestors(match_node.id()).skip(1) {
        if ancestor.span() == return_statement.span {
            return return_argument.span() == child.span() && negation_count % 2 == 0;
        }
        match ancestor.kind() {
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
                negation_count += 1;
            }
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::ChainExpression(_) => {}
            _ => return false,
        }
        child = ancestor;
    }
    false
}

fn non_null_normalized_class_name_root<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    let Expression::ConditionalExpression(conditional) = expression.get_inner_expression() else {
        return None;
    };
    let consequent_member = conditional
        .consequent
        .get_inner_expression()
        .as_member_expression()?;
    if consequent_member.static_property_name().as_deref() != Some("className") {
        return None;
    }
    let Expression::Identifier(root) = consequent_member.object().get_inner_expression() else {
        return None;
    };
    let expected_path = format!("{}.className", root.name);
    if !non_null_typeof_string_path(&conditional.test, expected_path.as_str(), ctx) {
        return None;
    }
    let Expression::LogicalExpression(fallback) = conditional.alternate.get_inner_expression()
    else {
        return None;
    };
    if fallback.operator != LogicalOperator::Coalesce
        || !matches!(fallback.right.get_inner_expression(), Expression::StringLiteral(literal) if literal.value.is_empty())
    {
        return None;
    }
    let Expression::CallExpression(attribute_call) = fallback.left.get_inner_expression() else {
        return None;
    };
    let attribute_member = attribute_call.callee.get_member_expr()?;
    if attribute_member.static_property_name().as_deref() != Some("getAttribute")
        || !matches!(attribute_member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == root.name)
        || !matches!(attribute_call.arguments.first().and_then(Argument::as_expression).map(Expression::get_inner_expression), Some(Expression::StringLiteral(literal)) if literal.value == "class")
    {
        return None;
    }
    Some(root)
}

fn non_null_result_presence_dominates(
    assertion: &AstNode<'_>,
    result_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child = assertion;
    for ancestor in ctx.nodes().ancestors(assertion.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let test = match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(child.span()) =>
            {
                Some(&statement.test)
            }
            AstKind::ConditionalExpression(conditional)
                if conditional
                    .consequent
                    .span()
                    .contains_inclusive(child.span()) =>
            {
                Some(&conditional.test)
            }
            AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And
                    && logical.right.span().contains_inclusive(child.span()) =>
            {
                Some(&logical.left)
            }
            _ => None,
        };
        if test.is_some_and(|test| {
            matches!(test.get_inner_expression(), Expression::Identifier(identifier) if reference_symbol_id(identifier, ctx) == Some(result_symbol_id))
        }) {
            return true;
        }
        child = ancestor;
    }
    false
}

fn non_null_anchored_character_match_is_guarded(
    assertion: &AstNode<'_>,
    receiver: &Expression<'_>,
    pattern: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::RegExpLiteral(regex) = pattern.get_inner_expression() else {
        return false;
    };
    let Some(required_character) = non_null_single_required_literal(&regex.regex.pattern.text)
    else {
        return false;
    };
    if !non_null_is_direct_character_match_statement(assertion, ctx) {
        return false;
    }
    let Expression::CallExpression(slice_call) = receiver.get_inner_expression() else {
        return false;
    };
    let Some(slice_member) = slice_call.callee.get_member_expr() else {
        return false;
    };
    if slice_member.static_property_name().as_deref() != Some("slice")
        || slice_call.arguments.len() != 1
    {
        return false;
    }
    let slice_receiver = slice_member.object().get_inner_expression();
    let Some(slice_start) = slice_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !matches!(slice_receiver, Expression::Identifier(_))
        || !matches!(slice_start, Expression::Identifier(_)) && !slice_start.is_literal()
    {
        return false;
    }

    let mut child = assertion;
    for ancestor in ctx.nodes().ancestors(assertion.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement.consequent.span() == child.span()
                    && non_null_is_first_statement_on_branch(
                        assertion,
                        &statement.consequent,
                        ctx,
                    )
                    && non_null_matching_character_index_guard(
                        &statement.test,
                        slice_receiver,
                        slice_start,
                        required_character,
                        BinaryOperator::StrictEquality,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::BlockStatement(block) => {
                let Some(child_index) = block
                    .body
                    .iter()
                    .position(|statement| statement.span() == child.span())
                else {
                    child = ancestor;
                    continue;
                };
                let Some(oxc_ast::ast::Statement::IfStatement(guard)) = child_index
                    .checked_sub(1)
                    .and_then(|index| block.body.get(index))
                else {
                    child = ancestor;
                    continue;
                };
                if guard.alternate.is_none()
                    && statement_always_exits(&guard.consequent)
                    && non_null_matching_character_index_guard(
                        &guard.test,
                        slice_receiver,
                        slice_start,
                        required_character,
                        BinaryOperator::StrictInequality,
                        ctx,
                    )
                {
                    return true;
                }
            }
            _ => {}
        }
        child = ancestor;
    }
    false
}

fn non_null_single_required_literal(pattern: &str) -> Option<&str> {
    let literal = pattern.strip_prefix('^')?.strip_suffix('+')?;
    let mut characters = literal.chars();
    let character = characters.next()?;
    if characters.next().is_some() || "\\.^$*+?()[]{}|".contains(character) {
        return None;
    }
    Some(literal)
}

fn non_null_is_direct_character_match_statement(
    assertion: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let result_access = ctx.nodes().parent_node(assertion.id());
    let is_result_access = matches!(result_access.kind(), AstKind::StaticMemberExpression(member) if member.object.span() == assertion.span())
        || matches!(result_access.kind(), AstKind::ComputedMemberExpression(member) if member.object.span() == assertion.span())
        || matches!(result_access.kind(), AstKind::PrivateFieldExpression(member) if member.object.span() == assertion.span());
    if !is_result_access {
        return false;
    }
    let consumer = ctx.nodes().parent_node(result_access.id());
    if matches!(consumer.kind(), AstKind::ReturnStatement(statement) if statement.argument.as_ref().is_some_and(|argument| argument.span() == result_access.span()))
    {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = consumer.kind() else {
        return false;
    };
    if !declarator
        .init
        .as_ref()
        .is_some_and(|initializer| initializer.span() == result_access.span())
    {
        return false;
    }
    matches!(
        ctx.nodes().parent_node(consumer.id()).kind(),
        AstKind::VariableDeclaration(declaration) if declaration.declarations.len() == 1
    )
}

fn non_null_is_first_statement_on_branch(
    assertion: &AstNode<'_>,
    branch: &oxc_ast::ast::Statement<'_>,
    _ctx: &LintContext<'_>,
) -> bool {
    let oxc_ast::ast::Statement::BlockStatement(block) = branch else {
        return branch.span().contains_inclusive(assertion.span());
    };
    block
        .body
        .first()
        .is_some_and(|statement| statement.span().contains_inclusive(assertion.span()))
}

fn non_null_matching_character_index_guard(
    test: &Expression<'_>,
    slice_receiver: &Expression<'_>,
    slice_start: &Expression<'_>,
    required_character: &str,
    expected_operator: BinaryOperator,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::BinaryExpression(binary) = test.get_inner_expression() else {
        return false;
    };
    if binary.operator != expected_operator {
        return false;
    }
    [(&binary.left, &binary.right), (&binary.right, &binary.left)]
        .into_iter()
        .any(|(candidate_index, candidate_character)| {
            let Some(index_member) = candidate_index
                .get_inner_expression()
                .as_member_expression()
            else {
                return false;
            };
            let MemberExpression::ComputedMemberExpression(index_member) = index_member else {
                return false;
            };
            non_null_expressions_structurally_equal(
                &index_member.object,
                slice_receiver,
                ctx,
            ) && non_null_expressions_structurally_equal(
                &index_member.expression,
                slice_start,
                ctx,
            ) && matches!(candidate_character.get_inner_expression(), Expression::StringLiteral(literal) if literal.value == required_character)
        })
}

fn symbol_declares_bare_empty_map(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
        return false;
    };
    if binding.symbol_id() != symbol_id {
        return false;
    }
    let Some(Expression::NewExpression(construction)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !construction.arguments.is_empty() {
        return false;
    }
    let Expression::Identifier(map_identifier) = construction.callee.get_inner_expression() else {
        return false;
    };
    matches!(map_identifier.name.as_str(), "Map" | "WeakMap")
        && ctx.is_reference_to_global_variable(map_identifier)
}

fn map_key_is_proven_present<'a>(
    assertion: &AstNode<'a>,
    receiver: &oxc_ast::ast::IdentifierReference<'a>,
    key: &Expression<'a>,
    call_node_ids: &[NodeId],
    ctx: &LintContext<'a>,
) -> bool {
    let Some(receiver_symbol_id) = reference_symbol_id(receiver, ctx) else {
        return false;
    };
    if non_null_map_has_guard_dominates(assertion, receiver_symbol_id, key, ctx) {
        return true;
    }
    let Some(scope_node_id) = non_null_outermost_scope(assertion, ctx) else {
        return false;
    };
    let scope = ctx.nodes().get_node(scope_node_id);
    for candidate in call_node_ids
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
    {
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if !non_null_is_unconditionally_before(candidate, assertion, scope, ctx) {
            continue;
        }
        let member = call.callee.get_member_expr();
        if member
            .and_then(|member| member.static_property_name())
            .is_some_and(|method| matches!(method, "get" | "find" | "match"))
        {
            continue;
        }
        if call.arguments.iter().any(|argument| {
            argument.as_expression().is_some_and(|argument| {
                non_null_map_receiver_matches(argument, receiver_symbol_id, ctx)
            })
        }) {
            return true;
        }
        let Some(member) = member else {
            continue;
        };
        if !non_null_map_receiver_matches(member.object(), receiver_symbol_id, ctx) {
            continue;
        }
        let Some(method) = member.static_property_name() else {
            continue;
        };
        if matches!(method, "keys" | "entries" | "forEach") {
            return true;
        }
        if method != "set"
            || !call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|candidate_key| non_null_map_keys_equal(candidate_key, key, ctx))
        {
            continue;
        }
        if non_null_identifier_key_written_between(
            key,
            call.span.start,
            assertion.span().start,
            ctx,
        ) || non_null_map_entry_invalidated_between(
            receiver_symbol_id,
            key,
            call.span.start,
            assertion.span().start,
            scope,
            true,
            call_node_ids,
            ctx,
        ) {
            continue;
        }
        return true;
    }
    non_null_ensure_then_map_get(assertion, receiver_symbol_id, key, call_node_ids, ctx)
}

fn non_null_map_has_guard_dominates(
    assertion: &AstNode<'_>,
    receiver_symbol_id: SymbolId,
    key: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child = assertion;
    for ancestor in ctx.nodes().ancestors(assertion.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let proof = match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(child.span()) =>
            {
                non_null_map_test_proves_has(&statement.test, true, receiver_symbol_id, key, ctx)
            }
            AstKind::IfStatement(statement)
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(child.span())) =>
            {
                non_null_map_test_proves_has(&statement.test, false, receiver_symbol_id, key, ctx)
            }
            AstKind::ConditionalExpression(conditional)
                if conditional
                    .consequent
                    .span()
                    .contains_inclusive(child.span()) =>
            {
                non_null_map_test_proves_has(&conditional.test, true, receiver_symbol_id, key, ctx)
            }
            AstKind::ConditionalExpression(conditional)
                if conditional
                    .alternate
                    .span()
                    .contains_inclusive(child.span()) =>
            {
                non_null_map_test_proves_has(&conditional.test, false, receiver_symbol_id, key, ctx)
            }
            AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And
                    && logical.right.span().contains_inclusive(child.span()) =>
            {
                non_null_map_test_proves_has(&logical.left, true, receiver_symbol_id, key, ctx)
            }
            AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::Or
                    && logical.right.span().contains_inclusive(child.span()) =>
            {
                non_null_map_test_proves_has(&logical.left, false, receiver_symbol_id, key, ctx)
            }
            AstKind::WhileStatement(statement) if statement.body.span() == child.span() => {
                non_null_map_test_proves_has(&statement.test, true, receiver_symbol_id, key, ctx)
            }
            AstKind::ForStatement(statement) if statement.body.span() == child.span() => {
                statement.test.as_ref().is_some_and(|test| {
                    non_null_map_test_proves_has(test, true, receiver_symbol_id, key, ctx)
                })
            }
            AstKind::BlockStatement(block) => block.body.iter().any(|statement| {
                non_null_map_earlier_exit_guard_proves(
                    statement,
                    child,
                    receiver_symbol_id,
                    key,
                    ctx,
                )
            }),
            AstKind::Program(program) => program.body.iter().any(|statement| {
                non_null_map_earlier_exit_guard_proves(
                    statement,
                    child,
                    receiver_symbol_id,
                    key,
                    ctx,
                )
            }),
            _ => false,
        };
        if proof {
            return true;
        }
        child = ancestor;
    }
    false
}

fn non_null_map_earlier_exit_guard_proves(
    candidate: &oxc_ast::ast::Statement<'_>,
    child: &AstNode<'_>,
    receiver_symbol_id: SymbolId,
    key: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if candidate.span().start >= child.span().start {
        return false;
    }
    let oxc_ast::ast::Statement::IfStatement(statement) = candidate else {
        return false;
    };
    (statement.alternate.is_none()
        && statement_always_exits(&statement.consequent)
        && non_null_map_test_proves_has(&statement.test, false, receiver_symbol_id, key, ctx))
        || (statement
            .alternate
            .as_ref()
            .is_some_and(|alternate| statement_always_exits(alternate))
            && non_null_map_test_proves_has(&statement.test, true, receiver_symbol_id, key, ctx))
}

fn non_null_map_test_proves_has(
    test: &Expression<'_>,
    expected_truthy: bool,
    receiver_symbol_id: SymbolId,
    key: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let test = test.get_inner_expression();
    if let Expression::UnaryExpression(unary) = test
        && unary.operator == UnaryOperator::LogicalNot
    {
        if expected_truthy {
            return false;
        }
        return non_null_map_test_proves_has(&unary.argument, true, receiver_symbol_id, key, ctx);
    }
    if let Expression::LogicalExpression(logical) = test {
        if !expected_truthy {
            return logical.operator == LogicalOperator::Or
                && (non_null_map_test_proves_has(
                    &logical.left,
                    false,
                    receiver_symbol_id,
                    key,
                    ctx,
                ) || non_null_map_test_proves_has(
                    &logical.right,
                    false,
                    receiver_symbol_id,
                    key,
                    ctx,
                ));
        }
        let left = non_null_map_test_proves_has(&logical.left, true, receiver_symbol_id, key, ctx);
        let right =
            non_null_map_test_proves_has(&logical.right, true, receiver_symbol_id, key, ctx);
        return match logical.operator {
            LogicalOperator::And => left || right,
            LogicalOperator::Or => left && right,
            LogicalOperator::Coalesce => false,
        };
    }
    if let Expression::CallExpression(call) = test {
        return expected_truthy
            && non_null_map_call_matches(call, "has", receiver_symbol_id, key, ctx);
    }
    if !expected_truthy {
        return false;
    }
    let Expression::BinaryExpression(binary) = test else {
        return false;
    };
    for (candidate, comparison_value) in
        [(&binary.left, &binary.right), (&binary.right, &binary.left)]
    {
        let Expression::CallExpression(call) = candidate.get_inner_expression() else {
            continue;
        };
        if !non_null_map_call_matches(call, "has", receiver_symbol_id, key, ctx) {
            continue;
        }
        let truth_requires_has = (matches!(
            binary.operator,
            BinaryOperator::Equality | BinaryOperator::StrictEquality
        ) && non_null_boolean_value(comparison_value, true))
            || (matches!(
                binary.operator,
                BinaryOperator::Inequality | BinaryOperator::StrictInequality
            ) && non_null_boolean_value(comparison_value, false));
        if truth_requires_has {
            return true;
        }
    }
    false
}

fn non_null_map_call_matches(
    call: &oxc_ast::ast::CallExpression<'_>,
    expected_method: &str,
    receiver_symbol_id: SymbolId,
    key: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_member_expr() else {
        return false;
    };
    member.static_property_name().as_deref() == Some(expected_method)
        && non_null_map_receiver_matches(member.object(), receiver_symbol_id, ctx)
        && call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|candidate_key| non_null_map_keys_equal(candidate_key, key, ctx))
}

fn non_null_map_receiver_matches(
    candidate: &Expression<'_>,
    receiver_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(candidate.get_inner_expression(), Expression::Identifier(identifier) if reference_symbol_id(identifier, ctx) == Some(receiver_symbol_id))
}

fn non_null_map_keys_equal(
    first: &Expression<'_>,
    second: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    non_null_expressions_structurally_equal(first, second, ctx)
}

fn non_null_outermost_scope<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> Option<NodeId> {
    let mut outermost_function = None;
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            outermost_function = Some(ancestor.id());
        }
        if matches!(ancestor.kind(), AstKind::Program(_)) {
            return outermost_function.or(Some(ancestor.id()));
        }
    }
    outermost_function
}

fn non_null_is_unconditionally_before(
    candidate: &AstNode<'_>,
    assertion: &AstNode<'_>,
    scope: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if candidate.span().start >= assertion.span().start {
        return false;
    }
    non_null_is_unconditional_in_scope(candidate, scope, ctx)
}

fn non_null_is_unconditional_in_scope(
    candidate: &AstNode<'_>,
    scope: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()).skip(1) {
        if ancestor.id() == scope.id() {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_)
                | AstKind::ArrowFunctionExpression(_)
                | AstKind::IfStatement(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
                | AstKind::SwitchCase(_)
                | AstKind::TryStatement(_)
        ) {
            return false;
        }
    }
    false
}

fn non_null_symbol_written_between(
    symbol_id: SymbolId,
    start: u32,
    end: u32,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let offset = ctx.nodes().get_node(reference.node_id()).span().start;
            offset > start && offset < end
        })
}

fn non_null_key_written_between(
    key: &Expression<'_>,
    start: u32,
    end: u32,
    ctx: &LintContext<'_>,
) -> bool {
    let root = non_null_expression_root_identifier(key);
    let Some(symbol_id) = root.and_then(|root| reference_symbol_id(root, ctx)) else {
        return false;
    };
    non_null_symbol_written_between(symbol_id, start, end, ctx)
}

fn non_null_identifier_key_written_between(
    key: &Expression<'_>,
    start: u32,
    end: u32,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = key.get_inner_expression() else {
        return false;
    };
    reference_symbol_id(identifier, ctx)
        .is_some_and(|symbol_id| non_null_symbol_written_between(symbol_id, start, end, ctx))
}

fn non_null_expression_root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    let mut current = expression.get_inner_expression();
    loop {
        if let Expression::Identifier(identifier) = current {
            return Some(identifier);
        }
        current = current
            .as_member_expression()?
            .object()
            .get_inner_expression();
    }
}

fn non_null_map_entry_invalidated_between(
    receiver_symbol_id: SymbolId,
    key: &Expression<'_>,
    start: u32,
    end: u32,
    scope: &AstNode<'_>,
    require_unconditional: bool,
    call_node_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    call_node_ids.iter().any(|node_id| {
        let candidate = ctx.nodes().get_node(*node_id);
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if call.span.start <= start || call.span.start >= end {
            return false;
        }
        if require_unconditional && !non_null_is_unconditional_in_scope(candidate, scope, ctx) {
            return false;
        }
        let Some(member) = call.callee.get_member_expr() else {
            return false;
        };
        if !non_null_map_receiver_matches(member.object(), receiver_symbol_id, ctx) {
            return false;
        }
        match member.static_property_name().as_deref() {
            Some("clear") => true,
            Some("delete") => call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|deleted_key| non_null_map_keys_equal(deleted_key, key, ctx)),
            _ => false,
        }
    })
}

fn non_null_ensure_then_map_get(
    assertion: &AstNode<'_>,
    receiver_symbol_id: SymbolId,
    key: &Expression<'_>,
    call_node_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    if !matches!(
        key.get_inner_expression(),
        Expression::Identifier(_)
            | Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
    ) && key.get_inner_expression().as_member_expression().is_none()
    {
        return false;
    }
    if let Some(root) = non_null_expression_root_identifier(key)
        && key.get_inner_expression().as_member_expression().is_some()
    {
        let Some(root_symbol_id) = reference_symbol_id(root, ctx) else {
            return false;
        };
        let root_declaration = ctx.symbol_declaration(root_symbol_id);
        let AstKind::VariableDeclarator(_) = root_declaration.kind() else {
            return false;
        };
        let declaration_parent = ctx.nodes().parent_node(root_declaration.id());
        if !matches!(declaration_parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
        {
            return false;
        }
    }
    let mut child = assertion;
    for ancestor in ctx.nodes().ancestors(assertion.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => block.body.as_slice(),
            AstKind::FunctionBody(body) => body.statements.as_slice(),
            _ => {
                child = ancestor;
                continue;
            }
        };
        for statement in statements {
            if statement.span().start >= child.span().start {
                break;
            }
            let oxc_ast::ast::Statement::IfStatement(statement) = statement else {
                continue;
            };
            if statement.alternate.is_some()
                || !non_null_map_test_contains_false_has(
                    &statement.test,
                    receiver_symbol_id,
                    key,
                    ctx,
                )
            {
                continue;
            }
            let population = call_node_ids.iter().find_map(|node_id| {
                let candidate = ctx.nodes().get_node(*node_id);
                let AstKind::CallExpression(call) = candidate.kind() else {
                    return None;
                };
                (statement.consequent.span().contains_inclusive(call.span)
                    && non_null_map_call_matches(call, "set", receiver_symbol_id, key, ctx)
                    && call
                        .arguments
                        .get(1)
                        .and_then(Argument::as_expression)
                        .is_some_and(non_null_map_value_is_non_nullish)
                    && non_null_is_unconditional_in_scope(
                        candidate,
                        ctx.nodes().get_node(statement.consequent.node_id()),
                        ctx,
                    ))
                .then_some(candidate)
            });
            let Some(population) = population else {
                continue;
            };
            if non_null_symbol_written_between(
                receiver_symbol_id,
                population.span().start,
                assertion.span().start,
                ctx,
            ) || non_null_key_may_change_after_population(
                key,
                population.span().start,
                assertion.span().start,
                ancestor,
                ctx,
            ) || non_null_map_entry_invalidated_between(
                receiver_symbol_id,
                key,
                population.span().start,
                assertion.span().start,
                ancestor,
                false,
                call_node_ids,
                ctx,
            ) {
                continue;
            }
            return true;
        }
        child = ancestor;
    }
    false
}

fn non_null_map_test_contains_false_has(
    test: &Expression<'_>,
    receiver_symbol_id: SymbolId,
    key: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let test = test.get_inner_expression();
    if let Expression::LogicalExpression(logical) = test
        && logical.operator == LogicalOperator::Or
    {
        return non_null_map_test_contains_false_has(&logical.left, receiver_symbol_id, key, ctx)
            || non_null_map_test_contains_false_has(&logical.right, receiver_symbol_id, key, ctx);
    }
    if let Expression::UnaryExpression(unary) = test
        && unary.operator == UnaryOperator::LogicalNot
    {
        let Expression::CallExpression(call) = unary.argument.get_inner_expression() else {
            return false;
        };
        return non_null_map_call_matches(call, "has", receiver_symbol_id, key, ctx);
    }
    let Expression::BinaryExpression(binary) = test else {
        return false;
    };
    for (candidate_guard, candidate_boolean) in
        [(&binary.left, &binary.right), (&binary.right, &binary.left)]
    {
        let Expression::CallExpression(call) = candidate_guard.get_inner_expression() else {
            continue;
        };
        if !non_null_map_call_matches(call, "has", receiver_symbol_id, key, ctx) {
            continue;
        }
        if (matches!(
            binary.operator,
            BinaryOperator::Equality | BinaryOperator::StrictEquality
        ) && non_null_boolean_value(candidate_boolean, false))
            || (matches!(
                binary.operator,
                BinaryOperator::Inequality | BinaryOperator::StrictInequality
            ) && non_null_boolean_value(candidate_boolean, true))
        {
            return true;
        }
    }
    false
}

fn non_null_map_value_is_non_nullish(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => false,
        Expression::Identifier(identifier) if identifier.name == "undefined" => false,
        Expression::ConditionalExpression(conditional) => {
            non_null_map_value_is_non_nullish(&conditional.consequent)
                && non_null_map_value_is_non_nullish(&conditional.alternate)
        }
        expression => {
            expression.is_literal()
                || matches!(
                    expression,
                    Expression::ObjectExpression(_)
                        | Expression::ArrayExpression(_)
                        | Expression::ArrowFunctionExpression(_)
                        | Expression::FunctionExpression(_)
                        | Expression::ClassExpression(_)
                        | Expression::NewExpression(_)
                        | Expression::TemplateLiteral(_)
                )
        }
    }
}

fn non_null_key_may_change_after_population(
    key: &Expression<'_>,
    start: u32,
    end: u32,
    scope: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some((root_identifier, key_path)) = non_null_expression_state_path(key) else {
        return false;
    };
    let Some(root_symbol_id) = reference_symbol_id(root_identifier, ctx) else {
        return false;
    };
    if matches!(key.get_inner_expression(), Expression::Identifier(_)) {
        return non_null_symbol_written_between(root_symbol_id, start, end, ctx);
    }
    let mut alias_paths = rustc_hash::FxHashMap::default();
    alias_paths.insert(root_symbol_id, root_identifier.name.to_string());
    let mut did_add_alias = true;
    while did_add_alias {
        did_add_alias = false;
        for candidate in ctx.nodes().iter() {
            if candidate.span().start >= end
                || !non_null_is_in_execution_scope(candidate, scope, ctx)
            {
                continue;
            }
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                continue;
            };
            let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
                continue;
            };
            let Some(initializer) = declarator.init.as_ref() else {
                continue;
            };
            let Some((initializer_root, initializer_path)) =
                non_null_expression_state_path(initializer)
            else {
                continue;
            };
            let Some(initializer_symbol_id) = reference_symbol_id(initializer_root, ctx) else {
                continue;
            };
            let Some(initializer_base_path) = alias_paths.get(&initializer_symbol_id).cloned()
            else {
                continue;
            };
            let initializer_suffix = initializer_path
                .strip_prefix(initializer_root.name.as_str())
                .unwrap_or("");
            if let std::collections::hash_map::Entry::Vacant(entry) =
                alias_paths.entry(binding.symbol_id())
            {
                entry.insert(format!("{initializer_base_path}{initializer_suffix}"));
                did_add_alias = true;
            }
        }
    }
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start <= start
            || candidate.span().start >= end
            || !non_null_is_in_execution_scope(candidate, scope, ctx)
        {
            return false;
        }
        if let AstKind::CallExpression(call) = candidate.kind()
            && call.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|argument| {
                    non_null_state_path_changes_receiver(
                        non_null_expression_symbol_state_path(argument, ctx),
                        key_path.as_str(),
                        &alias_paths,
                    )
                })
            })
        {
            return true;
        }
        let target = match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                non_null_assignment_target_state_path(&assignment.left, ctx)
            }
            AstKind::UpdateExpression(update) => {
                non_null_simple_assignment_target_state_path(&update.argument, ctx)
            }
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                non_null_expression_symbol_state_path(&unary.argument, ctx)
            }
            _ => None,
        };
        non_null_state_path_changes_receiver(target, key_path.as_str(), &alias_paths)
    })
}

fn non_null_is_in_execution_scope(
    candidate: &AstNode<'_>,
    scope: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()).skip(1) {
        if ancestor.id() == scope.id() {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}

fn reference_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn compact_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}
