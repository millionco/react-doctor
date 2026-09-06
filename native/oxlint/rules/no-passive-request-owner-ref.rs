use oxc_ast::{
    ast::{Argument, BindingPattern, Expression, Statement},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::BinaryOperator;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "This request guard relies on an owner ref updated by a passive effect, leaving a render-to-effect window where an old request can commit into the new owner. Invalidate the request before that window or tie it to a cleanup that runs before stale commits.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PassiveOwnerSync {
    owner_function_id: NodeId,
    owner_ref_symbol_id: SymbolId,
    owner_symbol_id: SymbolId,
}

#[derive(Debug, Default, Clone)]
pub struct NoPassiveRequestOwnerRef;

declare_oxc_lint!(
    /// Disallow stale-request guards backed by owner refs synchronized in a passive effect.
    NoPassiveRequestOwnerRef,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow stale-request guards backed by owner refs synchronized in a passive effect.",
);

impl Rule for NoPassiveRequestOwnerRef {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if !passive_owner_matches_react_hook_call(effect_call, &["useEffect"], ctx) {
                continue;
            }
            let passive_owner_syncs = find_passive_owner_syncs(effect_node, effect_call, ctx);
            if passive_owner_syncs
                .iter()
                .any(|sync| has_async_commit_trusting_passive_owner(*sync, ctx))
            {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(effect_call.span));
            }
        }
    }
}

fn find_passive_owner_syncs<'a>(
    effect_node: &AstNode<'a>,
    effect_call: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Vec<PassiveOwnerSync> {
    let Some(owner_function_id) = passive_owner_nearest_function_id(effect_node.id(), ctx) else {
        return Vec::new();
    };
    let Some(callback_node_id) = effect_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .and_then(|callback| resolve_passive_owner_function(callback, ctx, &mut Vec::new()))
    else {
        return Vec::new();
    };
    let mut passive_owner_syncs = Vec::new();
    for candidate in ctx.nodes().iter() {
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            continue;
        };
        if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
            || passive_owner_nearest_function_id(candidate.id(), ctx) != Some(callback_node_id)
        {
            continue;
        }
        let Some(target) = assignment.left.as_member_expression() else {
            continue;
        };
        if target.static_property_name().as_deref() != Some("current") {
            continue;
        }
        let Expression::Identifier(owner_ref) = target.object().get_inner_expression() else {
            continue;
        };
        let Some(owner_ref_symbol_id) = ctx
            .scoping()
            .get_reference(owner_ref.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if !passive_owner_symbol_is_hook_result(
            owner_ref_symbol_id,
            &["useRef"],
            None,
            ctx,
            &mut Vec::new(),
        ) {
            continue;
        }
        let Expression::Identifier(owner) = assignment.right.get_inner_expression() else {
            continue;
        };
        let Some(owner_symbol_id) = ctx
            .scoping()
            .get_reference(owner.reference_id())
            .symbol_id()
        else {
            continue;
        };
        let owner_declaration = ctx.symbol_declaration(owner_symbol_id);
        let owner_is_parameter = passive_owner_nearest_function_id(owner_declaration.id(), ctx)
            == Some(owner_function_id)
            && (matches!(owner_declaration.kind(), AstKind::FormalParameter(_))
                || ctx
                    .nodes()
                    .ancestors(owner_declaration.id())
                    .any(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_))));
        if !owner_is_parameter
            || !passive_owner_dependency_contains(effect_call, owner_symbol_id, ctx)
        {
            continue;
        }
        let sync = PassiveOwnerSync {
            owner_function_id,
            owner_ref_symbol_id,
            owner_symbol_id,
        };
        if !passive_owner_syncs.contains(&sync) {
            passive_owner_syncs.push(sync);
        }
    }
    passive_owner_syncs
}

fn has_async_commit_trusting_passive_owner(
    passive_owner_sync: PassiveOwnerSync,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if candidate.id() == passive_owner_sync.owner_function_id
            || !passive_owner_is_function(candidate)
            || !passive_owner_function_is_async(candidate)
            || !passive_owner_is_descendant_of(
                candidate.id(),
                passive_owner_sync.owner_function_id,
                ctx,
            )
        {
            return false;
        }
        does_async_function_trust_passive_owner(candidate, passive_owner_sync, ctx)
    })
}

fn does_async_function_trust_passive_owner(
    async_function: &AstNode<'_>,
    passive_owner_sync: PassiveOwnerSync,
    ctx: &LintContext<'_>,
) -> bool {
    let mut await_nodes = Vec::new();
    let mut owner_guard_nodes = Vec::new();
    let mut state_dispatcher_nodes = Vec::new();
    for candidate in ctx.nodes().iter() {
        if passive_owner_nearest_function_id(candidate.id(), ctx) != Some(async_function.id()) {
            continue;
        }
        match candidate.kind() {
            AstKind::AwaitExpression(_) => await_nodes.push(candidate),
            AstKind::IfStatement(statement)
                if passive_owner_is_early_exit(&statement.consequent)
                    && passive_owner_test_contains_mismatch(
                        &statement.test,
                        passive_owner_sync,
                        ctx,
                    ) =>
            {
                owner_guard_nodes.push(candidate);
            }
            AstKind::CallExpression(call) if passive_owner_is_state_dispatcher_call(call, ctx) => {
                state_dispatcher_nodes.push(candidate);
            }
            _ => {}
        }
    }
    owner_guard_nodes.iter().any(|owner_guard| {
        let AstKind::IfStatement(statement) = owner_guard.kind() else {
            return false;
        };
        await_nodes.iter().any(|await_node| {
            can_node_reach_later_node_within_function(await_node, owner_guard, async_function, ctx)
        }) && state_dispatcher_nodes.iter().any(|state_dispatcher| {
            !statement
                .consequent
                .span()
                .contains_inclusive(state_dispatcher.span())
                && nodes_can_co_execute(owner_guard, state_dispatcher, ctx)
                && can_node_reach_later_node_within_function(
                    owner_guard,
                    state_dispatcher,
                    async_function,
                    ctx,
                )
        })
    })
}

fn passive_owner_test_contains_mismatch(
    test: &Expression<'_>,
    passive_owner_sync: PassiveOwnerSync,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::BinaryExpression(binary) = candidate.kind() else {
            return false;
        };
        if !test.span().contains_inclusive(binary.span)
            || !matches!(
                binary.operator,
                BinaryOperator::Inequality | BinaryOperator::StrictInequality
            )
        {
            return false;
        }
        (passive_owner_is_current_member(&binary.left, passive_owner_sync.owner_ref_symbol_id, ctx)
            && passive_owner_is_symbol_identifier(
                &binary.right,
                passive_owner_sync.owner_symbol_id,
                ctx,
            ))
            || (passive_owner_is_symbol_identifier(
                &binary.left,
                passive_owner_sync.owner_symbol_id,
                ctx,
            ) && passive_owner_is_current_member(
                &binary.right,
                passive_owner_sync.owner_ref_symbol_id,
                ctx,
            ))
    })
}

fn passive_owner_is_current_member(
    expression: &Expression<'_>,
    owner_ref_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.static_property_name().as_deref() != Some("current") {
        return false;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
        == Some(owner_ref_symbol_id)
}

fn passive_owner_is_symbol_identifier(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        == Some(symbol_id)
}

fn passive_owner_is_state_dispatcher_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
    else {
        return false;
    };
    passive_owner_symbol_is_hook_result(
        symbol_id,
        &["useReducer", "useState"],
        Some(1),
        ctx,
        &mut Vec::new(),
    )
}

fn passive_owner_symbol_is_hook_result(
    symbol_id: SymbolId,
    hook_names: &[&str],
    destructure_index: Option<usize>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    if !variable_declaration.kind.is_const() {
        return false;
    }
    if let BindingPattern::BindingIdentifier(binding) = &declarator.id {
        if binding.symbol_id() != symbol_id {
            return false;
        }
        if let Some(Expression::Identifier(alias_source)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        {
            let Some(source_symbol_id) = ctx
                .scoping()
                .get_reference(alias_source.reference_id())
                .symbol_id()
            else {
                return false;
            };
            return passive_owner_symbol_is_hook_result(
                source_symbol_id,
                hook_names,
                destructure_index,
                ctx,
                visited_symbol_ids,
            );
        }
        if destructure_index.is_some() {
            return false;
        }
    } else {
        let Some(element_index) = destructure_index else {
            return false;
        };
        let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
            return false;
        };
        let Some(element) = pattern.elements.get(element_index).and_then(Option::as_ref) else {
            return false;
        };
        let binding = match element {
            BindingPattern::BindingIdentifier(binding) => binding,
            BindingPattern::AssignmentPattern(assignment) => {
                let BindingPattern::BindingIdentifier(binding) = &assignment.left else {
                    return false;
                };
                binding
            }
            _ => return false,
        };
        if binding.symbol_id() != symbol_id {
            return false;
        }
    }
    matches!(
        declarator.init.as_ref().map(Expression::get_inner_expression),
        Some(Expression::CallExpression(hook_call))
            if passive_owner_matches_react_hook_call(hook_call, hook_names, ctx)
    )
}

fn passive_owner_dependency_contains(
    effect_call: &oxc_ast::ast::CallExpression<'_>,
    owner_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(Expression::ArrayExpression(dependencies)) = effect_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    dependencies.elements.iter().any(|element| {
        let Some(Expression::Identifier(identifier)) = element
            .as_expression()
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(owner_symbol_id)
    })
}

fn resolve_passive_owner_function(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
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
                AstKind::Function(_) => Some(declaration.id()),
                AstKind::VariableDeclarator(declarator) => {
                    let parent = ctx.nodes().parent_node(declaration.id());
                    if !matches!(
                        parent.kind(),
                        AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) || declarator
                        .id
                        .get_binding_identifier()
                        .is_none_or(|binding| binding.symbol_id() != symbol_id)
                    {
                        return None;
                    }
                    resolve_passive_owner_function(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn passive_owner_matches_react_hook_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    hook_names: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    if hook_names
        .iter()
        .any(|hook_name| is_react_api_call(call, hook_name, ctx))
    {
        return true;
    }
    matches!(
        call.callee.get_inner_expression(),
        Expression::Identifier(identifier)
            if hook_names.contains(&identifier.name.as_str())
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
    )
}

fn passive_owner_is_early_exit(statement: &Statement<'_>) -> bool {
    if statement_always_exits(statement) {
        return true;
    }
    match statement {
        Statement::BlockStatement(block) => {
            block.body.last().is_some_and(passive_owner_is_early_exit)
        }
        Statement::BreakStatement(_) | Statement::ContinueStatement(_) => true,
        _ => false,
    }
}

fn passive_owner_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node_id)
        .find_map(|ancestor| passive_owner_is_function(ancestor).then(|| ancestor.id()))
}

fn passive_owner_is_function(node: &AstNode<'_>) -> bool {
    matches!(
        node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    )
}

fn passive_owner_function_is_async(node: &AstNode<'_>) -> bool {
    match node.kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn passive_owner_is_descendant_of(
    node_id: NodeId,
    ancestor_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .any(|ancestor| ancestor.id() == ancestor_id)
}
