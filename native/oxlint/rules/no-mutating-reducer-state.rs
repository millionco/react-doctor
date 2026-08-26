use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This reducer changes state in place, so your update is silently skipped.";
const ALIAS_DEPTH_LIMIT: usize = 12;

#[derive(Debug, Default, Clone)]
pub struct NoMutatingReducerState;

declare_oxc_lint!(
    /// Disallow returning reducer state after mutating it in place.
    NoMutatingReducerState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow returning reducer state after mutating it in place.",
);

impl Rule for NoMutatingReducerState {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut analyzed_reducer_ids = FxHashSet::default();
        for call_node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = call_node.kind() else {
                continue;
            };
            if !is_react_use_reducer_call(&call_expression.callee, ctx) {
                continue;
            }
            let Some(reducer_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(reducer_node_id) =
                resolve_local_reducer_function(reducer_expression, ctx, &mut Vec::new())
            else {
                continue;
            };
            if !analyzed_reducer_ids.insert(reducer_node_id) {
                continue;
            }
            let reducer_node = ctx.nodes().get_node(reducer_node_id);
            analyze_reducer(reducer_node, ctx);
        }
    }
}

fn is_react_use_reducer_call<'a>(callee: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let callee = callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        return resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
            entry.module_request.name() == "react"
                && matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if imported_name.name() == "useReducer"
                )
        });
    }
    let Expression::StaticMemberExpression(member_expression) = callee else {
        return false;
    };
    if member_expression.property.name != "useReducer" {
        return false;
    }
    let Expression::Identifier(receiver) = member_expression.object.get_inner_expression() else {
        return false;
    };
    resolve_identifier_import(receiver, ctx).is_some_and(|entry| {
        entry.module_request.name() == "react"
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
                    | crate::module_record::ImportImportName::Default(_)
            )
    })
}

fn resolve_local_reducer_function<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::ArrowFunctionExpression(function) if function.get_expression().is_none() => {
            Some(function.node_id.get())
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) if function.body.is_some() => Some(declaration.id()),
                AstKind::VariableDeclarator(declarator) => resolve_local_reducer_function(
                    declarator.init.as_ref()?,
                    ctx,
                    visited_symbol_ids,
                ),
                _ => None,
            }
        }
        _ => None,
    }
}

fn analyze_reducer<'a>(reducer_node: &AstNode<'a>, ctx: &LintContext<'a>) {
    let Some((state_symbol_id, body_span)) = reducer_state_symbol_and_body_span(reducer_node)
    else {
        return;
    };
    let return_nodes = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            matches!(candidate.kind(), AstKind::ReturnStatement(_))
                && body_span.contains_inclusive(candidate.span())
                && node_belongs_to_reducer(candidate, reducer_node.id(), ctx)
        })
        .filter(|return_node| return_returns_original_state(return_node, state_symbol_id, ctx))
        .collect::<Vec<_>>();
    if return_nodes.is_empty() {
        return;
    }
    let mut reported_spans = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        if !body_span.contains_inclusive(candidate.span())
            || !node_belongs_to_reducer(candidate, reducer_node.id(), ctx)
            || !is_reducer_state_mutation(candidate, state_symbol_id, ctx)
            || !return_nodes.iter().any(|return_node| {
                return_node.span().contains_inclusive(candidate.span())
                    || can_node_reach_later_node_within_function(
                        candidate,
                        return_node,
                        reducer_node,
                        ctx,
                    )
            })
            || !reported_spans.insert((candidate.span().start, candidate.span().end))
        {
            continue;
        }
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(candidate.span()));
    }
}

fn reducer_state_symbol_and_body_span(
    reducer_node: &AstNode<'_>,
) -> Option<(SymbolId, oxc_span::Span)> {
    let (parameters, body_span) = match reducer_node.kind() {
        AstKind::Function(function) => (&function.params, function.body.as_ref()?.span),
        AstKind::ArrowFunctionExpression(function) if function.get_expression().is_none() => {
            (&function.params, function.body.span())
        }
        _ => return None,
    };
    let parameter = parameters.items.first()?;
    let state_symbol_id = match &parameter.pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        BindingPattern::AssignmentPattern(pattern) => pattern
            .left
            .get_binding_identifier()
            .map(oxc_ast::ast::BindingIdentifier::symbol_id),
        _ => None,
    }?;
    Some((state_symbol_id, body_span))
}

fn node_belongs_to_reducer(
    node: &AstNode<'_>,
    reducer_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .is_some_and(|owner| owner.id() == reducer_node_id)
}

fn return_returns_original_state<'a>(
    return_node: &AstNode<'a>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let AstKind::ReturnStatement(statement) = return_node.kind() else {
        return false;
    };
    statement.argument.as_ref().is_some_and(|argument| {
        expression_can_return_original_state(
            argument,
            state_symbol_id,
            return_node,
            ctx,
            &mut Vec::new(),
            0,
        )
    })
}

fn expression_can_return_original_state<'a>(
    expression: &Expression<'a>,
    state_symbol_id: SymbolId,
    target_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    depth: usize,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return identifier_reaches_state(
            identifier,
            state_symbol_id,
            target_node,
            true,
            ctx,
            visited_symbol_ids,
            depth,
        );
    }
    if let Expression::CallExpression(call_expression) = expression
        && let Some(member_expression) = call_expression.callee.get_member_expr()
        && let Some(method_name) = member_expression.static_property_name()
    {
        if method_name == "assign"
            && is_unresolved_named_identifier(member_expression.object(), "Object", ctx)
        {
            return call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .is_some_and(|first_argument| {
                    expression_can_return_original_state(
                        first_argument,
                        state_symbol_id,
                        target_node,
                        ctx,
                        visited_symbol_ids,
                        depth + 1,
                    )
                });
        }
        if matches!(method_name, "copyWithin" | "fill" | "reverse" | "sort") {
            return expression_can_return_original_state(
                member_expression.object(),
                state_symbol_id,
                target_node,
                ctx,
                visited_symbol_ids,
                depth + 1,
            );
        }
    }
    match expression {
        Expression::ConditionalExpression(conditional) => {
            expression_can_return_original_state(
                &conditional.consequent,
                state_symbol_id,
                target_node,
                ctx,
                &mut visited_symbol_ids.clone(),
                depth + 1,
            ) || expression_can_return_original_state(
                &conditional.alternate,
                state_symbol_id,
                target_node,
                ctx,
                visited_symbol_ids,
                depth + 1,
            )
        }
        Expression::LogicalExpression(logical) => {
            expression_can_return_original_state(
                &logical.left,
                state_symbol_id,
                target_node,
                ctx,
                &mut visited_symbol_ids.clone(),
                depth + 1,
            ) || expression_can_return_original_state(
                &logical.right,
                state_symbol_id,
                target_node,
                ctx,
                visited_symbol_ids,
                depth + 1,
            )
        }
        Expression::SequenceExpression(sequence) => {
            sequence.expressions.last().is_some_and(|last_expression| {
                expression_can_return_original_state(
                    last_expression,
                    state_symbol_id,
                    target_node,
                    ctx,
                    visited_symbol_ids,
                    depth + 1,
                )
            })
        }
        _ => false,
    }
}

fn is_reducer_state_mutation<'a>(
    node: &AstNode<'a>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    match node.kind() {
        AstKind::AssignmentExpression(assignment) => assignment
            .left
            .as_member_expression()
            .and_then(|member| member_root_identifier(member.object()))
            .is_some_and(|identifier| {
                identifier_reaches_state(
                    identifier,
                    state_symbol_id,
                    node,
                    false,
                    ctx,
                    &mut Vec::new(),
                    0,
                )
            }),
        AstKind::UpdateExpression(update) => update
            .argument
            .as_member_expression()
            .and_then(|member| member_root_identifier(member.object()))
            .is_some_and(|identifier| {
                identifier_reaches_state(
                    identifier,
                    state_symbol_id,
                    node,
                    false,
                    ctx,
                    &mut Vec::new(),
                    0,
                )
            }),
        AstKind::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::Delete =>
        {
            member_root_identifier(&unary.argument).is_some_and(|identifier| {
                identifier_reaches_state(
                    identifier,
                    state_symbol_id,
                    node,
                    false,
                    ctx,
                    &mut Vec::new(),
                    0,
                )
            })
        }
        AstKind::CallExpression(call_expression) => {
            is_mutating_state_call(call_expression, node, state_symbol_id, ctx)
        }
        _ => false,
    }
}

fn is_mutating_state_call<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    call_node: &AstNode<'a>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let first_argument_reaches_state = || {
        call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .and_then(member_root_identifier)
            .is_some_and(|identifier| {
                identifier_reaches_state(
                    identifier,
                    state_symbol_id,
                    call_node,
                    false,
                    ctx,
                    &mut Vec::new(),
                    0,
                )
            })
    };
    if first_argument_reaches_state()
        && (is_global_object_or_reflect_mutator(call_expression, ctx)
            || is_lodash_mutator_call(call_expression, ctx))
    {
        return true;
    }
    let Some(member_expression) = call_expression.callee.get_member_expr() else {
        return false;
    };
    let Some(method_name) = member_expression.static_property_name() else {
        return false;
    };
    let Some(root_identifier) = member_root_identifier(member_expression.object()) else {
        return false;
    };
    if !identifier_reaches_state(
        root_identifier,
        state_symbol_id,
        call_node,
        false,
        ctx,
        &mut Vec::new(),
        0,
    ) {
        return false;
    }
    if matches!(
        method_name,
        "push"
            | "pop"
            | "shift"
            | "unshift"
            | "splice"
            | "sort"
            | "reverse"
            | "fill"
            | "copyWithin"
    ) {
        return true;
    }
    matches!(method_name, "add" | "clear" | "delete" | "set")
        && is_result_discarded_call(call_node, false, ctx)
}

fn is_global_object_or_reflect_mutator<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression.callee.get_member_expr() else {
        return false;
    };
    let Some(method_name) = member_expression.static_property_name() else {
        return false;
    };
    (matches!(
        method_name,
        "assign" | "defineProperties" | "defineProperty"
    ) && is_unresolved_named_identifier(member_expression.object(), "Object", ctx))
        || (matches!(method_name, "defineProperty" | "set")
            && is_unresolved_named_identifier(member_expression.object(), "Reflect", ctx))
}

fn is_lodash_mutator_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    const MUTATOR_NAMES: [&str; 14] = [
        "set",
        "unset",
        "update",
        "merge",
        "defaults",
        "defaultsDeep",
        "assign",
        "assignIn",
        "pull",
        "pullAll",
        "pullAllBy",
        "pullAt",
        "remove",
        "fill",
    ];
    let callee = call_expression.callee.get_inner_expression();
    let import_entry = match callee {
        Expression::Identifier(identifier) if MUTATOR_NAMES.contains(&identifier.name.as_str()) => {
            resolve_identifier_import(identifier, ctx)
        }
        Expression::StaticMemberExpression(member_expression)
            if MUTATOR_NAMES.contains(&member_expression.property.name.as_str()) =>
        {
            let Expression::Identifier(receiver) = member_expression.object.get_inner_expression()
            else {
                return false;
            };
            resolve_identifier_import(receiver, ctx)
        }
        _ => return false,
    };
    import_entry.is_some_and(|entry| {
        let source = entry.module_request.name();
        !source.starts_with("lodash/fp")
            && !source.starts_with("lodash-es/fp")
            && (source == "lodash"
                || source == "lodash-es"
                || source.starts_with("lodash/")
                || source.starts_with("lodash-es/"))
    })
}

fn is_unresolved_named_identifier<'a>(
    expression: &Expression<'a>,
    expected_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == expected_name
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn member_root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier),
        expression => member_root_identifier(expression.as_member_expression()?.object()),
    }
}

fn identifier_reaches_state<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    state_symbol_id: SymbolId,
    target_node: &AstNode<'a>,
    must_be_original_reference: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    depth: usize,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    symbol_reaches_state(
        symbol_id,
        state_symbol_id,
        target_node,
        must_be_original_reference,
        ctx,
        visited_symbol_ids,
        depth,
    )
}

fn symbol_reaches_state<'a>(
    symbol_id: SymbolId,
    state_symbol_id: SymbolId,
    target_node: &AstNode<'a>,
    must_be_original_reference: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    depth: usize,
) -> bool {
    if depth > ALIAS_DEPTH_LIMIT || visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    if let Some(rebinding_expression) = latest_dominating_rebinding(symbol_id, target_node, ctx) {
        return expression_reaches_state(
            rebinding_expression,
            state_symbol_id,
            target_node,
            must_be_original_reference,
            ctx,
            visited_symbol_ids,
            depth + 1,
        );
    }
    if symbol_id == state_symbol_id {
        return true;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(initializer) = declarator.init.as_ref() else {
        return false;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
    {
        return expression_reaches_state(
            initializer,
            state_symbol_id,
            declaration,
            must_be_original_reference,
            ctx,
            visited_symbol_ids,
            depth + 1,
        );
    }
    !must_be_original_reference
        && pattern_has_direct_non_rest_symbol(&declarator.id, symbol_id)
        && expression_reaches_state(
            initializer,
            state_symbol_id,
            declaration,
            false,
            ctx,
            visited_symbol_ids,
            depth + 1,
        )
}

fn expression_reaches_state<'a>(
    expression: &'a Expression<'a>,
    state_symbol_id: SymbolId,
    target_node: &AstNode<'a>,
    must_be_original_reference: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    depth: usize,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return identifier_reaches_state(
            identifier,
            state_symbol_id,
            target_node,
            must_be_original_reference,
            ctx,
            visited_symbol_ids,
            depth,
        );
    }
    !must_be_original_reference
        && member_root_identifier(expression).is_some_and(|identifier| {
            identifier_reaches_state(
                identifier,
                state_symbol_id,
                target_node,
                false,
                ctx,
                visited_symbol_ids,
                depth,
            )
        })
}

fn latest_dominating_rebinding<'a>(
    symbol_id: SymbolId,
    target_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .filter_map(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            let assignment_node = ctx.nodes().parent_node(identifier_node.id());
            let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
                return None;
            };
            if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
                || !matches!(
                    &assignment.left,
                    AssignmentTarget::AssignmentTargetIdentifier(identifier)
                        if identifier.span == identifier_node.span()
                )
                || !node_dominates_node(assignment_node, target_node, ctx)
            {
                return None;
            }
            Some((assignment_node.span().start, &assignment.right))
        })
        .max_by_key(|(start, _)| *start)
        .map(|(_, expression)| expression)
}

fn pattern_has_direct_non_rest_symbol(pattern: &BindingPattern<'_>, symbol_id: SymbolId) -> bool {
    match pattern {
        BindingPattern::ObjectPattern(object_pattern) => {
            object_pattern
                .properties
                .iter()
                .any(|property| match &property.value {
                    BindingPattern::BindingIdentifier(identifier) => {
                        identifier.symbol_id() == symbol_id
                    }
                    BindingPattern::AssignmentPattern(assignment) => assignment
                        .left
                        .get_binding_identifier()
                        .is_some_and(|identifier| identifier.symbol_id() == symbol_id),
                    _ => false,
                })
        }
        BindingPattern::ArrayPattern(array_pattern) => {
            array_pattern
                .elements
                .iter()
                .flatten()
                .any(|element| match element {
                    BindingPattern::BindingIdentifier(identifier) => {
                        identifier.symbol_id() == symbol_id
                    }
                    BindingPattern::AssignmentPattern(assignment) => assignment
                        .left
                        .get_binding_identifier()
                        .is_some_and(|identifier| identifier.symbol_id() == symbol_id),
                    _ => false,
                })
        }
        _ => false,
    }
}
