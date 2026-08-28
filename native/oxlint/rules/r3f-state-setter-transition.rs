use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{AstNode, context::LintContext};

const R3F_STATE_REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];

#[derive(Clone, Copy)]
struct R3fStateSetterBinding {
    state_symbol_id: Option<SymbolId>,
}

#[derive(Clone, Copy)]
struct R3fNumericRefBoundary {
    operator: BinaryOperator,
    ref_symbol_id: SymbolId,
    threshold: f64,
}

#[derive(Default)]
struct R3fStateTransitionCache {
    setter_bindings: rustc_hash::FxHashMap<NodeId, Option<R3fStateSetterBinding>>,
    setter_counts: rustc_hash::FxHashMap<(NodeId, SymbolId), bool>,
    setter_tuple_writes: rustc_hash::FxHashMap<SymbolId, bool>,
}

fn r3f_resolve_state_setter_binding_inner<'a>(
    expression: &Expression<'a>,
    reference_node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    setter_tuple_write_cache: &mut rustc_hash::FxHashMap<SymbolId, bool>,
) -> Option<R3fStateSetterBinding> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        let is_setter_index = matches!(
            member_expression,
            oxc_ast::ast::MemberExpression::ComputedMemberExpression(member)
                if matches!(
                    member.expression.get_inner_expression(),
                    Expression::NumericLiteral(literal) if literal.value == 1.0
                )
        );
        if !is_setter_index {
            return None;
        }
        let tuple_expression = member_expression.object().get_inner_expression();
        if let Expression::Identifier(identifier) = tuple_expression
            && (has_possible_static_property_write_before(
                identifier,
                "1",
                reference_node,
                analysis,
                ctx,
            ) || r3f_state_has_possible_setter_tuple_write(
                identifier,
                setter_tuple_write_cache,
                ctx,
            ))
        {
            return None;
        }
        return r3f_is_state_hook_tuple(
            tuple_expression,
            reference_node,
            analysis,
            ctx,
            visited_symbol_ids,
        )
        .then_some(R3fStateSetterBinding {
            state_symbol_id: None,
        });
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
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
    if let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = &declarator.id
        && matches!(
            pattern.elements.get(1).and_then(Option::as_ref),
            Some(oxc_ast::ast::BindingPattern::BindingIdentifier(binding))
                if binding.symbol_id() == symbol_id
        )
        && let Some(Expression::CallExpression(hook_call)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        && r3f_state_react_api_call(hook_call, &["useState", "useReducer"], analysis, ctx)
    {
        let state_symbol_id = pattern
            .elements
            .first()
            .and_then(Option::as_ref)
            .and_then(|pattern| match pattern {
                oxc_ast::ast::BindingPattern::BindingIdentifier(binding) => Some(binding),
                _ => None,
            })
            .filter(|_| r3f_state_react_api_call(hook_call, &["useState"], analysis, ctx))
            .map(|binding| binding.symbol_id());
        return Some(R3fStateSetterBinding { state_symbol_id });
    }
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    r3f_resolve_state_setter_binding_inner(
        declarator.init.as_ref()?,
        reference_node,
        analysis,
        ctx,
        visited_symbol_ids,
        setter_tuple_write_cache,
    )
}

fn r3f_is_state_hook_tuple<'a>(
    expression: &Expression<'a>,
    reference_node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call_expression) => {
            r3f_state_react_api_call(call_expression, &["useState", "useReducer"], analysis, ctx)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) && declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    r3f_is_state_hook_tuple(
                        initializer,
                        reference_node,
                        analysis,
                        ctx,
                        visited_symbol_ids,
                    )
                })
        }
        _ => false,
    }
}

fn r3f_state_react_api_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_names: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    if r3f_state_callee_uses_global_react(&call_expression.callee, ctx) {
        return false;
    }
    api_names.iter().any(|api_name| {
        is_react_api_call(call_expression, api_name, ctx)
            || module_api_reference_matches(
                &call_expression.callee,
                api_name,
                &R3F_STATE_REACT_RUNTIME_MODULES,
                analysis,
                ctx,
            )
            || type_import_module_api_reference_matches(
                &call_expression.callee,
                api_name,
                &R3F_STATE_REACT_RUNTIME_MODULES,
                analysis,
                ctx,
            )
    })
}

fn r3f_state_callee_uses_global_react(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return r3f_state_is_global_react_identifier(member_expression.object(), ctx);
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        matches!(
            &property.value,
            oxc_ast::ast::BindingPattern::BindingIdentifier(binding)
                if binding.symbol_id() == symbol_id
        )
    }) && declarator
        .init
        .as_ref()
        .is_some_and(|initializer| r3f_state_is_global_react_identifier(initializer, ctx))
}

fn r3f_state_is_global_react_identifier(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == "React"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn r3f_state_has_possible_setter_tuple_write<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    setter_tuple_write_cache: &mut rustc_hash::FxHashMap<SymbolId, bool>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    if let Some(&cached_result) = setter_tuple_write_cache.get(&root_symbol_id) {
        return cached_result;
    }
    let has_possible_write = potential_alias_symbol_ids(root_symbol_id, ctx)
        .into_iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .any(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            static_property_write_member(identifier_node, ctx).is_some_and(|member_node| {
                resolved_static_member_property_name(member_node, ctx)
                    .is_none_or(|written_property_name| written_property_name == "1")
            })
        });
    setter_tuple_write_cache.insert(root_symbol_id, has_possible_write);
    has_possible_write
}

fn r3f_is_guarded_state_transition<'a>(
    setter_node: &AstNode<'a>,
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    transition_cache: &mut R3fStateTransitionCache,
    ctx: &LintContext<'a>,
) -> bool {
    let AstKind::CallExpression(setter_call) = setter_node.kind() else {
        return false;
    };
    let mut current_child_id = setter_node.id();
    for current_ancestor in ctx.nodes().ancestors(setter_node.id()) {
        if current_ancestor.id() == callback_id {
            break;
        }
        let current_child = ctx.nodes().get_node(current_child_id);
        match current_ancestor.kind() {
            AstKind::CatchClause(_) => return true,
            AstKind::IfStatement(statement) => {
                let did_test_pass = if statement.consequent.span() == current_child.span() {
                    Some(true)
                } else if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span() == current_child.span())
                {
                    Some(false)
                } else {
                    None
                };
                if did_test_pass.is_some_and(|did_test_pass| {
                    r3f_branch_guarantees_value_change(
                        &statement.test,
                        did_test_pass,
                        ctx,
                        &mut Vec::new(),
                    ) || r3f_branch_has_boolean_latch_transition(
                        current_child,
                        setter_node,
                        callback_id,
                        &statement.test,
                        did_test_pass,
                        analysis,
                        node_index,
                        transition_cache,
                        ctx,
                    ) || r3f_branch_has_ref_latch_transition(
                        current_child,
                        setter_node,
                        &statement.test,
                        did_test_pass,
                        analysis,
                        node_index,
                        ctx,
                    ) || r3f_branch_has_numeric_ref_reset(
                        current_child,
                        setter_node,
                        &statement.test,
                        did_test_pass,
                        analysis,
                        node_index,
                        ctx,
                    ) || r3f_is_bounded_boolean_state_transition(
                        setter_node,
                        setter_call,
                        analysis,
                        node_index,
                        transition_cache,
                        ctx,
                    )
                }) {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                let did_test_pass = if expression.consequent.span() == current_child.span() {
                    Some(true)
                } else if expression.alternate.span() == current_child.span() {
                    Some(false)
                } else {
                    None
                };
                if did_test_pass.is_some_and(|did_test_pass| {
                    r3f_branch_guarantees_value_change(
                        &expression.test,
                        did_test_pass,
                        ctx,
                        &mut Vec::new(),
                    ) || r3f_branch_has_boolean_latch_transition(
                        current_child,
                        setter_node,
                        callback_id,
                        &expression.test,
                        did_test_pass,
                        analysis,
                        node_index,
                        transition_cache,
                        ctx,
                    ) || r3f_branch_has_ref_latch_transition(
                        current_child,
                        setter_node,
                        &expression.test,
                        did_test_pass,
                        analysis,
                        node_index,
                        ctx,
                    )
                }) {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span() == current_child.span()
                    && matches!(
                        expression.operator,
                        LogicalOperator::And | LogicalOperator::Or
                    ) =>
            {
                let did_test_pass = expression.operator == LogicalOperator::And;
                if r3f_branch_guarantees_value_change(
                    &expression.left,
                    did_test_pass,
                    ctx,
                    &mut Vec::new(),
                ) || r3f_branch_has_boolean_latch_transition(
                    current_child,
                    setter_node,
                    callback_id,
                    &expression.left,
                    did_test_pass,
                    analysis,
                    node_index,
                    transition_cache,
                    ctx,
                ) || r3f_branch_has_ref_latch_transition(
                    current_child,
                    setter_node,
                    &expression.left,
                    did_test_pass,
                    analysis,
                    node_index,
                    ctx,
                ) {
                    return true;
                }
            }
            _ => {}
        }
        current_child_id = current_ancestor.id();
    }
    false
}

fn r3f_branch_guarantees_value_change<'a>(
    expression: &Expression<'a>,
    did_test_pass: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::BinaryExpression(binary_expression)
            if matches!(
                binary_expression.operator,
                BinaryOperator::Inequality
                    | BinaryOperator::StrictInequality
                    | BinaryOperator::Equality
                    | BinaryOperator::StrictEquality
            ) && !r3f_is_primitive_comparison_boundary(&binary_expression.left)
                && !r3f_is_primitive_comparison_boundary(&binary_expression.right) =>
        {
            did_test_pass
                == matches!(
                    binary_expression.operator,
                    BinaryOperator::Inequality | BinaryOperator::StrictInequality
                )
        }
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::LogicalNot =>
        {
            r3f_branch_guarantees_value_change(
                &unary_expression.argument,
                !did_test_pass,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::LogicalExpression(logical_expression) => {
            let left_guarantees = r3f_branch_guarantees_value_change(
                &logical_expression.left,
                did_test_pass,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            let right_guarantees = r3f_branch_guarantees_value_change(
                &logical_expression.right,
                did_test_pass,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            let requires_every_operand =
                (logical_expression.operator == LogicalOperator::And) != did_test_pass;
            if requires_every_operand {
                left_guarantees && right_guarantees
            } else {
                left_guarantees || right_guarantees
            }
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) && declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    r3f_branch_guarantees_value_change(
                        initializer,
                        did_test_pass,
                        ctx,
                        visited_symbol_ids,
                    )
                })
        }
        _ => false,
    }
}

fn r3f_is_primitive_comparison_boundary(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_) => true,
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::Void =>
        {
            true
        }
        Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "undefined" | "NaN" | "Infinity") =>
        {
            true
        }
        _ => false,
    }
}

fn r3f_branch_guarantees_boolean_state(
    expression: &Expression<'_>,
    did_test_pass: bool,
    state_symbol_id: SymbolId,
    expected_value: bool,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                == Some(state_symbol_id)
                && did_test_pass == expected_value
        }
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::LogicalNot =>
        {
            r3f_branch_guarantees_boolean_state(
                &unary_expression.argument,
                !did_test_pass,
                state_symbol_id,
                expected_value,
                ctx,
            )
        }
        Expression::LogicalExpression(logical_expression) => {
            let left_guarantees = r3f_branch_guarantees_boolean_state(
                &logical_expression.left,
                did_test_pass,
                state_symbol_id,
                expected_value,
                ctx,
            );
            let right_guarantees = r3f_branch_guarantees_boolean_state(
                &logical_expression.right,
                did_test_pass,
                state_symbol_id,
                expected_value,
                ctx,
            );
            let requires_every_operand =
                (logical_expression.operator == LogicalOperator::And) != did_test_pass;
            if requires_every_operand {
                left_guarantees && right_guarantees
            } else {
                left_guarantees || right_guarantees
            }
        }
        _ => false,
    }
}

fn r3f_branch_has_boolean_latch_transition<'a>(
    branch: &AstNode<'a>,
    setter_node: &AstNode<'a>,
    callback_id: NodeId,
    test: &Expression<'a>,
    did_test_pass: bool,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    transition_cache: &mut R3fStateTransitionCache,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(setter_function_id) = local_callback_nearest_function_id(setter_node.id(), ctx) else {
        return false;
    };
    for &candidate_id in node_index.node_ids(setter_function_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        if !r3f_state_node_is_within(candidate, branch, ctx) {
            continue;
        }
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        let Some(state_symbol_id) = r3f_state_cached_setter_binding(
            candidate,
            call_expression,
            analysis,
            transition_cache,
            ctx,
        )
        .and_then(|binding| binding.state_symbol_id) else {
            continue;
        };
        let Some(Expression::BooleanLiteral(next_state)) = call_expression
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .map(Expression::get_inner_expression)
        else {
            continue;
        };
        if r3f_branch_guarantees_boolean_state(
            test,
            did_test_pass,
            state_symbol_id,
            !next_state.value,
            ctx,
        ) && !r3f_callback_calls_state_setter_more_than_once(
            callback_id,
            state_symbol_id,
            analysis,
            node_index,
            transition_cache,
            ctx,
        ) && r3f_latch_transition_guaranteed_for_setter(candidate, setter_node, branch, ctx)
        {
            return true;
        }
    }
    false
}

fn r3f_callback_calls_state_setter_more_than_once(
    callback_id: NodeId,
    state_symbol_id: SymbolId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    transition_cache: &mut R3fStateTransitionCache,
    ctx: &LintContext<'_>,
) -> bool {
    if let Some(&cached_result) = transition_cache
        .setter_counts
        .get(&(callback_id, state_symbol_id))
    {
        return cached_result;
    }
    let mut setter_call_count = 0;
    for &candidate_id in node_index.node_ids(callback_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        if r3f_state_cached_setter_binding(
            candidate,
            call_expression,
            analysis,
            transition_cache,
            ctx,
        )
        .and_then(|binding| binding.state_symbol_id)
            == Some(state_symbol_id)
        {
            setter_call_count += 1;
            if setter_call_count > 1 {
                transition_cache
                    .setter_counts
                    .insert((callback_id, state_symbol_id), true);
                return true;
            }
        }
    }
    transition_cache
        .setter_counts
        .insert((callback_id, state_symbol_id), false);
    false
}

fn r3f_state_cached_setter_binding<'a>(
    candidate: &AstNode<'a>,
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    transition_cache: &mut R3fStateTransitionCache,
    ctx: &LintContext<'a>,
) -> Option<R3fStateSetterBinding> {
    if let Some(&cached_binding) = transition_cache.setter_bindings.get(&candidate.id()) {
        return cached_binding;
    }
    let binding = r3f_resolve_state_setter_binding_inner(
        &call_expression.callee,
        candidate,
        analysis,
        ctx,
        &mut Vec::new(),
        &mut transition_cache.setter_tuple_writes,
    );
    transition_cache
        .setter_bindings
        .insert(candidate.id(), binding);
    binding
}

fn r3f_latch_transition_guaranteed_for_setter(
    latch_node: &AstNode<'_>,
    setter_node: &AstNode<'_>,
    branch: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if latch_node.id() == branch.id() {
        return true;
    }
    let mut current_child_id = latch_node.id();
    for current_ancestor in ctx.nodes().ancestors(latch_node.id()) {
        if current_ancestor.id() == branch.id() {
            return true;
        }
        let current_child = ctx.nodes().get_node(current_child_id);
        let is_conditional_region = match current_ancestor.kind() {
            AstKind::IfStatement(statement) => statement.test.span() != current_child.span(),
            AstKind::ConditionalExpression(expression) => {
                expression.consequent.span() == current_child.span()
                    || expression.alternate.span() == current_child.span()
            }
            AstKind::LogicalExpression(expression) => {
                expression.right.span() == current_child.span()
            }
            AstKind::AssignmentPattern(pattern) => pattern.right.span() == current_child.span(),
            AstKind::SwitchCase(_) => true,
            _ => false,
        };
        if is_conditional_region && !r3f_state_node_is_within(setter_node, current_child, ctx) {
            return false;
        }
        current_child_id = current_ancestor.id();
    }
    false
}

fn r3f_state_node_is_within(
    candidate: &AstNode<'_>,
    boundary: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    candidate.id() == boundary.id()
        || ctx
            .nodes()
            .ancestors(candidate.id())
            .any(|ancestor| ancestor.id() == boundary.id())
}

fn r3f_state_current_ref_symbol_id<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let member_expression = expression.get_inner_expression().as_member_expression()?;
    r3f_state_current_ref_member_symbol_id(member_expression, analysis, ctx)
}

fn r3f_state_current_ref_member_symbol_id<'a>(
    member_expression: &oxc_ast::ast::MemberExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if member_expression.static_property_name() != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = member_expression.object().get_inner_expression()
    else {
        return None;
    };
    let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let Expression::CallExpression(call_expression) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)?
    else {
        return None;
    };
    r3f_state_react_api_call(call_expression, &["useRef", "createRef"], analysis, ctx)
        .then_some(symbol_id)
}

fn r3f_branch_guarantees_ref_boolean<'a>(
    expression: &Expression<'a>,
    did_test_pass: bool,
    ref_symbol_id: SymbolId,
    expected_value: bool,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    if r3f_state_current_ref_symbol_id(expression, analysis, ctx) == Some(ref_symbol_id) {
        return did_test_pass == expected_value;
    }
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::LogicalNot =>
        {
            r3f_branch_guarantees_ref_boolean(
                &unary_expression.argument,
                !did_test_pass,
                ref_symbol_id,
                expected_value,
                analysis,
                ctx,
            )
        }
        Expression::LogicalExpression(logical_expression) => {
            let left_guarantees = r3f_branch_guarantees_ref_boolean(
                &logical_expression.left,
                did_test_pass,
                ref_symbol_id,
                expected_value,
                analysis,
                ctx,
            );
            let right_guarantees = r3f_branch_guarantees_ref_boolean(
                &logical_expression.right,
                did_test_pass,
                ref_symbol_id,
                expected_value,
                analysis,
                ctx,
            );
            let requires_every_operand =
                (logical_expression.operator == LogicalOperator::And) != did_test_pass;
            if requires_every_operand {
                left_guarantees && right_guarantees
            } else {
                left_guarantees || right_guarantees
            }
        }
        _ => false,
    }
}

fn r3f_branch_has_ref_latch_transition<'a>(
    branch: &AstNode<'a>,
    setter_node: &AstNode<'a>,
    test: &Expression<'a>,
    did_test_pass: bool,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(setter_function_id) = local_callback_nearest_function_id(setter_node.id(), ctx) else {
        return false;
    };
    for &candidate_id in node_index.node_ids(setter_function_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        if candidate.span().start >= setter_node.span().start
            || !r3f_state_node_is_within(candidate, branch, ctx)
        {
            continue;
        }
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            continue;
        };
        if assignment.operator != AssignmentOperator::Assign {
            continue;
        }
        let Some(left_member) = assignment.left.as_member_expression() else {
            continue;
        };
        let Some(ref_symbol_id) =
            r3f_state_current_ref_member_symbol_id(left_member, analysis, ctx)
        else {
            continue;
        };
        let Expression::BooleanLiteral(assigned_value) = assignment.right.get_inner_expression()
        else {
            continue;
        };
        if r3f_branch_guarantees_ref_boolean(
            test,
            did_test_pass,
            ref_symbol_id,
            !assigned_value.value,
            analysis,
            ctx,
        ) && !is_node_conditionally_executed(candidate, branch.id(), ctx)
            && r3f_latch_transition_guaranteed_for_setter(candidate, setter_node, branch, ctx)
        {
            return true;
        }
    }
    false
}

fn r3f_get_numeric_ref_boundary<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<R3fNumericRefBoundary> {
    let Expression::BinaryExpression(binary_expression) = expression.get_inner_expression() else {
        return None;
    };
    if !matches!(
        binary_expression.operator,
        BinaryOperator::LessThan
            | BinaryOperator::LessEqualThan
            | BinaryOperator::GreaterThan
            | BinaryOperator::GreaterEqualThan
    ) {
        return None;
    }
    let left_ref_symbol_id =
        r3f_state_current_ref_symbol_id(&binary_expression.left, analysis, ctx);
    let right_ref_symbol_id =
        r3f_state_current_ref_symbol_id(&binary_expression.right, analysis, ctx);
    if left_ref_symbol_id.is_some() == right_ref_symbol_id.is_some() {
        return None;
    }
    let threshold = resolve_static_number(
        if left_ref_symbol_id.is_none() {
            &binary_expression.left
        } else {
            &binary_expression.right
        },
        ctx,
    )?;
    let operator = if right_ref_symbol_id.is_some() {
        match binary_expression.operator {
            BinaryOperator::LessThan => BinaryOperator::GreaterThan,
            BinaryOperator::LessEqualThan => BinaryOperator::GreaterEqualThan,
            BinaryOperator::GreaterThan => BinaryOperator::LessThan,
            BinaryOperator::GreaterEqualThan => BinaryOperator::LessEqualThan,
            _ => return None,
        }
    } else {
        binary_expression.operator
    };
    Some(R3fNumericRefBoundary {
        operator,
        ref_symbol_id: left_ref_symbol_id.or(right_ref_symbol_id)?,
        threshold,
    })
}

fn r3f_value_passes_numeric_boundary(value: f64, boundary: R3fNumericRefBoundary) -> bool {
    match boundary.operator {
        BinaryOperator::LessThan => value < boundary.threshold,
        BinaryOperator::LessEqualThan => value <= boundary.threshold,
        BinaryOperator::GreaterThan => value > boundary.threshold,
        BinaryOperator::GreaterEqualThan => value >= boundary.threshold,
        _ => false,
    }
}

fn r3f_state_is_inside_repeated_execution(
    node: &AstNode<'_>,
    boundary: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .take_while(|ancestor| ancestor.id() != boundary.id())
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::DoWhileStatement(_)
                    | AstKind::ForInStatement(_)
                    | AstKind::ForOfStatement(_)
                    | AstKind::ForStatement(_)
                    | AstKind::WhileStatement(_)
            )
        })
}

fn r3f_written_current_ref_symbol_id<'a>(
    node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let member_expression = match node.kind() {
        AstKind::AssignmentExpression(assignment) => assignment.left.as_member_expression()?,
        AstKind::UpdateExpression(update) => update.argument.as_member_expression()?,
        _ => return None,
    };
    r3f_state_current_ref_member_symbol_id(member_expression, analysis, ctx)
}

fn r3f_branch_has_numeric_ref_reset<'a>(
    branch: &AstNode<'a>,
    setter_node: &AstNode<'a>,
    test: &Expression<'a>,
    did_test_pass: bool,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(boundary) = r3f_get_numeric_ref_boundary(test, analysis, ctx) else {
        return false;
    };
    if r3f_state_is_inside_repeated_execution(setter_node, branch, ctx) {
        return false;
    }
    let Some(setter_function_id) = local_callback_nearest_function_id(setter_node.id(), ctx) else {
        return false;
    };
    let latest_ref_write = node_index
        .node_ids(setter_function_id)
        .iter()
        .map(|&candidate_id| ctx.nodes().get_node(candidate_id))
        .filter(|candidate| {
            candidate.span().start < setter_node.span().start
                && r3f_state_node_is_within(candidate, branch, ctx)
                && r3f_written_current_ref_symbol_id(candidate, analysis, ctx)
                    == Some(boundary.ref_symbol_id)
        })
        .max_by_key(|candidate| candidate.span().start);
    let Some(latest_ref_write) = latest_ref_write else {
        return false;
    };
    let AstKind::AssignmentExpression(assignment) = latest_ref_write.kind() else {
        return false;
    };
    if assignment.operator != AssignmentOperator::Assign
        || is_node_conditionally_executed(latest_ref_write, branch.id(), ctx)
        || r3f_state_is_inside_repeated_execution(latest_ref_write, branch, ctx)
        || !r3f_latch_transition_guaranteed_for_setter(latest_ref_write, setter_node, branch, ctx)
    {
        return false;
    }
    resolve_static_number(&assignment.right, ctx).is_some_and(|reset_value| {
        r3f_value_passes_numeric_boundary(reset_value, boundary) != did_test_pass
    })
}

fn r3f_is_bounded_boolean_state_transition<'a>(
    setter_node: &AstNode<'a>,
    setter_call: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    transition_cache: &mut R3fStateTransitionCache,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(Expression::BooleanLiteral(next_state)) = setter_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Some(setter_function_id) = local_callback_nearest_function_id(setter_node.id(), ctx) else {
        return false;
    };
    let Some(state_symbol_id) =
        r3f_state_cached_setter_binding(setter_node, setter_call, analysis, transition_cache, ctx)
            .and_then(|binding| binding.state_symbol_id)
    else {
        return false;
    };
    let Some(mut containing_if) = ctx
        .nodes()
        .ancestors(setter_node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::IfStatement(_)))
    else {
        return false;
    };
    loop {
        let parent = ctx.nodes().parent_node(containing_if.id());
        let AstKind::IfStatement(parent_if) = parent.kind() else {
            break;
        };
        if parent_if
            .alternate
            .as_ref()
            .is_none_or(|alternate| alternate.span() != containing_if.span())
        {
            break;
        }
        containing_if = parent;
    }
    let mut transitions: rustc_hash::FxHashMap<String, (Vec<bool>, Vec<bool>)> =
        rustc_hash::FxHashMap::default();
    let mut setter_boundary: Option<(String, bool)> = None;
    let mut branch = Some(containing_if);
    while let Some(branch_node) = branch {
        let AstKind::IfStatement(if_statement) = branch_node.kind() else {
            break;
        };
        let boundary = r3f_relational_boundary(&if_statement.test, ctx);
        let Some(consequent_node) = node_index
            .node_ids(setter_function_id)
            .iter()
            .map(|&candidate_id| ctx.nodes().get_node(candidate_id))
            .find(|candidate| candidate.span() == if_statement.consequent.span())
        else {
            return false;
        };
        let mut branch_setter_calls = Vec::new();
        for &candidate_id in node_index.node_ids(setter_function_id) {
            let candidate = ctx.nodes().get_node(candidate_id);
            if !r3f_state_node_is_within(candidate, consequent_node, ctx)
                || is_node_conditionally_executed(candidate, consequent_node.id(), ctx)
            {
                continue;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                continue;
            };
            let Some(candidate_state_symbol_id) = r3f_state_cached_setter_binding(
                candidate,
                call_expression,
                analysis,
                transition_cache,
                ctx,
            )
            .and_then(|binding| binding.state_symbol_id) else {
                continue;
            };
            let Some(Expression::BooleanLiteral(value)) = call_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            if candidate_state_symbol_id == state_symbol_id {
                branch_setter_calls.push((candidate, value.value));
            }
        }
        if let Some((expression_key, points_above)) = boundary
            && branch_setter_calls.len() == 1
        {
            let (candidate, value) = branch_setter_calls[0];
            let entry = transitions.entry(expression_key.clone()).or_default();
            if points_above {
                entry.0.push(value);
            } else {
                entry.1.push(value);
            }
            if candidate.id() == setter_node.id() {
                setter_boundary = Some((expression_key, points_above));
            }
        }
        branch = if_statement.alternate.as_ref().and_then(|alternate| {
            let alternate_span = alternate.span();
            node_index
                .node_ids(setter_function_id)
                .iter()
                .map(|&candidate_id| ctx.nodes().get_node(candidate_id))
                .find(|candidate| {
                    candidate.span() == alternate_span
                        && matches!(candidate.kind(), AstKind::IfStatement(_))
                })
        });
    }
    let Some((expression_key, points_above)) = setter_boundary else {
        return false;
    };
    transitions
        .get(&expression_key)
        .is_some_and(|(above, below)| {
            if points_above {
                below.contains(&!next_state.value)
            } else {
                above.contains(&!next_state.value)
            }
        })
}

fn r3f_relational_boundary(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<(String, bool)> {
    let Expression::BinaryExpression(binary_expression) = expression.get_inner_expression() else {
        return None;
    };
    if !matches!(
        binary_expression.operator,
        BinaryOperator::LessThan
            | BinaryOperator::LessEqualThan
            | BinaryOperator::GreaterThan
            | BinaryOperator::GreaterEqualThan
    ) {
        return None;
    }
    let left_is_boundary = r3f_is_primitive_comparison_boundary(&binary_expression.left);
    let right_is_boundary = r3f_is_primitive_comparison_boundary(&binary_expression.right);
    if left_is_boundary == right_is_boundary {
        return None;
    }
    let expression_key = r3f_stable_expression_key(
        if left_is_boundary {
            &binary_expression.right
        } else {
            &binary_expression.left
        },
        ctx,
    )?;
    let points_above = if left_is_boundary {
        matches!(
            binary_expression.operator,
            BinaryOperator::LessThan | BinaryOperator::LessEqualThan
        )
    } else {
        matches!(
            binary_expression.operator,
            BinaryOperator::GreaterThan | BinaryOperator::GreaterEqualThan
        )
    };
    Some((expression_key, points_above))
}

fn r3f_stable_expression_key(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<String> {
    let mut property_names = Vec::new();
    let mut current = expression.get_inner_expression();
    while let Some(member_expression) = current.as_member_expression() {
        property_names.push(member_expression.static_property_name()?.to_string());
        current = member_expression.object().get_inner_expression();
    }
    let Expression::Identifier(identifier) = current else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    property_names.reverse();
    Some(format!("{symbol_id:?}:{}", property_names.join(".")))
}
