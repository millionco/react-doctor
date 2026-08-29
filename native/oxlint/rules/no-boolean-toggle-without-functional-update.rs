use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TIMER_REGISTRATIONS: [&str; 6] = [
    "setTimeout",
    "setInterval",
    "setImmediate",
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
];
const EFFECT_HOOK_NAMES: [&str; 3] = ["useEffect", "useInsertionEffect", "useLayoutEffect"];

#[derive(Debug, Default, Clone)]
pub struct NoBooleanToggleWithoutFunctionalUpdate;

declare_oxc_lint!(
    /// Warns when a deferred boolean toggle reads stale state.
    NoBooleanToggleWithoutFunctionalUpdate,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a deferred boolean toggle reads stale state.",
);

impl Rule for NoBooleanToggleWithoutFunctionalUpdate {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let registration_call_ids_by_function = toggle_registration_call_ids_by_function(ctx);
        let mut await_node_ids_by_function: rustc_hash::FxHashMap<NodeId, Vec<NodeId>> =
            rustc_hash::FxHashMap::default();
        for candidate in ctx.nodes().iter() {
            if matches!(candidate.kind(), AstKind::AwaitExpression(_))
                && let Some(function_id) = toggle_nearest_function_id(candidate.id(), ctx)
            {
                await_node_ids_by_function
                    .entry(function_id)
                    .or_default()
                    .push(candidate.id());
            }
        }

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(setter_call) = node.kind() else {
                continue;
            };
            let Expression::Identifier(setter_reference) =
                setter_call.callee.get_inner_expression()
            else {
                continue;
            };
            let Some(argument) = setter_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Expression::UnaryExpression(negation) = argument.get_inner_expression() else {
                continue;
            };
            if negation.operator != UnaryOperator::LogicalNot {
                continue;
            }
            let Expression::Identifier(state_reference) = negation.argument.get_inner_expression()
            else {
                continue;
            };
            let Some(state_symbol_id) = toggle_resolve_use_state_pair(setter_reference, ctx) else {
                continue;
            };
            if resolve_const_identifier_root_symbol(state_reference, ctx) != Some(state_symbol_id) {
                continue;
            }

            let deferred_function_id =
                toggle_enclosing_deferred_function(node, &registration_call_ids_by_function, ctx);
            if deferred_function_id.is_none()
                && !toggle_async_function_has_await_before(node, &await_node_ids_by_function, ctx)
            {
                continue;
            }
            if let Some(deferred_function_id) = deferred_function_id
                && (toggle_effect_resubscribes_with_cleanup(
                    node,
                    deferred_function_id,
                    state_symbol_id,
                    &registration_call_ids_by_function,
                    ctx,
                ) || toggle_has_promise_command_negation(
                    deferred_function_id,
                    state_symbol_id,
                    &registration_call_ids_by_function,
                    ctx,
                ))
            {
                continue;
            }
            if toggle_has_latest_ref_equality_guard(node, state_symbol_id, ctx) {
                continue;
            }

            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "You can lose this update because {}(!{}) reads a stale value; use {}(previous => !previous).",
                    setter_reference.name, state_reference.name, setter_reference.name
                ))
                .with_label(setter_call.span),
            );
        }
    }
}

fn toggle_resolve_use_state_pair<'a>(
    setter_reference: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let setter_symbol_id = resolve_const_identifier_root_symbol(setter_reference, ctx)?;
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(array_pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(state_binding) =
        array_pattern.elements.first().and_then(Option::as_ref)?
    else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter_binding) =
        array_pattern.elements.get(1).and_then(Option::as_ref)?
    else {
        return None;
    };
    let Expression::CallExpression(use_state_call) = declarator.init.as_ref()? else {
        return None;
    };
    (setter_binding.symbol_id() == setter_symbol_id
        && is_react_hook_call(use_state_call, &["useState"], ctx))
    .then_some(state_binding.symbol_id())
}

fn toggle_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn toggle_function_symbol_id<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    let declaration = ctx.nodes().parent_node(parent.id());
    let AstKind::VariableDeclaration(variable_declaration) = declaration.kind() else {
        return None;
    };
    if !variable_declaration.kind.is_const()
        || declarator.init.as_ref().is_none_or(|initializer| {
            initializer.get_inner_expression().span() != function_node.span()
        })
    {
        return None;
    }
    declarator
        .id
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
}

fn toggle_function_registration_call_ids<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Vec<NodeId> {
    let mut call_ids = Vec::new();
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    if let AstKind::CallExpression(call_expression) = parent.kind()
        && toggle_call_registers_callback(call_expression, function_node.span(), ctx)
    {
        call_ids.push(parent.id());
    }
    let Some(function_symbol_id) = toggle_function_symbol_id(function_node, ctx) else {
        return call_ids;
    };
    let mut pending_symbol_ids = vec![function_symbol_id];
    let mut visited_symbol_ids = rustc_hash::FxHashSet::default();
    while let Some(symbol_id) = pending_symbol_ids.pop() {
        if !visited_symbol_ids.insert(symbol_id) {
            continue;
        }
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            if let Some(alias_symbol_id) = toggle_const_alias_symbol_id(reference_root, ctx) {
                pending_symbol_ids.push(alias_symbol_id);
                continue;
            }
            let call_node = ctx.nodes().parent_node(reference_root.id());
            let AstKind::CallExpression(call_expression) = call_node.kind() else {
                continue;
            };
            if toggle_call_registers_callback(call_expression, reference_node.span(), ctx)
                && !call_ids.contains(&call_node.id())
            {
                call_ids.push(call_node.id());
            }
        }
    }
    call_ids
}

fn toggle_registration_call_ids_by_function(
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashMap<NodeId, Vec<NodeId>> {
    ctx.nodes()
        .iter()
        .filter(|node| {
            matches!(
                node.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .map(|function_node| {
            (
                function_node.id(),
                toggle_function_registration_call_ids(function_node, ctx),
            )
        })
        .collect()
}

fn toggle_const_alias_symbol_id<'a>(
    source_root: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let declarator_node = ctx.nodes().parent_node(source_root.id());
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != source_root.span())
    {
        return None;
    }
    let declaration = ctx.nodes().parent_node(declarator_node.id());
    if !matches!(declaration.kind(), AstKind::VariableDeclaration(variable_declaration)
        if variable_declaration.kind.is_const())
    {
        return None;
    }
    declarator
        .id
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
}

fn toggle_call_registers_callback<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    callback_span: oxc_span::Span,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        return TIMER_REGISTRATIONS.contains(&identifier.name.as_str())
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none()
            && call_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| argument.get_inner_expression().span() == callback_span);
    }
    let Some(member_expression) = callee.as_member_expression() else {
        return false;
    };
    let Some(method_name) = member_expression.static_property_name() else {
        return false;
    };
    let callback_index = match method_name.as_ref() {
        name if TIMER_REGISTRATIONS.contains(&name) => {
            if !toggle_is_global_object(member_expression.object(), ctx) {
                return false;
            }
            0
        }
        "then" | "catch" | "finally" => {
            if toggle_is_proven_synchronous_thenable(member_expression.object(), ctx) {
                return false;
            }
            0
        }
        "subscribe" => 0,
        "addEventListener" | "on" | "addListener" | "once" => 1,
        _ => return false,
    };
    call_expression
        .arguments
        .get(callback_index)
        .and_then(Argument::as_expression)
        .is_some_and(|argument| argument.get_inner_expression().span() == callback_span)
        || matches!(method_name.as_ref(), "then" | "catch" | "finally")
            && call_expression
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
                .is_some_and(|argument| argument.get_inner_expression().span() == callback_span)
}

fn toggle_is_proven_synchronous_thenable<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = expression.get_inner_expression();
    let mut visited_symbol_ids = rustc_hash::FxHashSet::default();
    while let Expression::Identifier(identifier) = current {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited_symbol_ids.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let Some(initializer) = &declarator.init else {
            return false;
        };
        current = initializer.get_inner_expression();
    }
    let Expression::ObjectExpression(object) = current else {
        return false;
    };
    let Some(then_function) = object.properties.iter().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        (property.key.static_name().as_deref() == Some("then"))
            .then(|| property.value.get_inner_expression())
    }) else {
        return false;
    };
    let (function_id, first_parameter) = match then_function {
        Expression::FunctionExpression(function) => {
            (function.node_id.get(), function.params.items.first())
        }
        Expression::ArrowFunctionExpression(function) => {
            (function.node_id.get(), function.params.items.first())
        }
        _ => return false,
    };
    let Some(first_parameter) = first_parameter else {
        return false;
    };
    let BindingPattern::BindingIdentifier(callback_binding) = &first_parameter.pattern else {
        return false;
    };
    let references = ctx
        .scoping()
        .get_resolved_references(callback_binding.symbol_id())
        .collect::<Vec<_>>();
    !references.is_empty()
        && references.iter().all(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(reference_node.id());
            toggle_nearest_function_id(reference_node.id(), ctx) == Some(function_id)
                && matches!(parent.kind(), AstKind::CallExpression(call)
                    if call.callee.span() == reference_node.span())
        })
}

fn toggle_is_global_object<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    matches!(identifier.name.as_str(), "window" | "globalThis" | "self")
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn toggle_enclosing_deferred_function(
    node: &AstNode<'_>,
    registration_call_ids_by_function: &rustc_hash::FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
        .filter(|function_id| {
            registration_call_ids_by_function
                .get(function_id)
                .is_some_and(|call_ids| !call_ids.is_empty())
        })
    })
}

fn toggle_async_function_has_await_before<'a>(
    node: &AstNode<'a>,
    await_node_ids_by_function: &rustc_hash::FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(function_node) = ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) else {
        return false;
    };
    let is_async = match function_node.kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    };
    is_async
        && await_node_ids_by_function
            .get(&function_node.id())
            .into_iter()
            .flatten()
            .any(|candidate_id| {
                let candidate = ctx.nodes().get_node(*candidate_id);
                can_node_reach_later_node_within_function(candidate, node, function_node, ctx)
                    && nodes_can_co_execute(candidate, node, ctx)
            })
}

fn toggle_has_promise_command_negation(
    deferred_function_id: NodeId,
    state_symbol_id: SymbolId,
    registration_call_ids_by_function: &rustc_hash::FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(registration_call_ids) = registration_call_ids_by_function.get(&deferred_function_id)
    else {
        return false;
    };
    !registration_call_ids.is_empty()
        && registration_call_ids.iter().all(|call_id| {
            let AstKind::CallExpression(then_call) = ctx.nodes().get_node(*call_id).kind() else {
                return false;
            };
            let Some(then_member) = then_call.callee.get_inner_expression().as_member_expression()
            else {
                return false;
            };
            if then_member.static_property_name().as_deref() != Some("then") {
                return false;
            }
            let Expression::CallExpression(command_call) =
                then_member.object().get_inner_expression()
            else {
                return false;
            };
            let Some(command_member) = command_call
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return false;
            };
            let Some(command_name) = command_member.static_property_name() else {
                return false;
            };
            let Some(command_suffix) = command_name.strip_prefix("set") else {
                return false;
            };
            if !command_suffix
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_uppercase)
                || command_call.arguments.len() != 1
            {
                return false;
            }
            command_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| {
                    matches!(argument.get_inner_expression(), Expression::UnaryExpression(negation)
                        if negation.operator == UnaryOperator::LogicalNot
                            && matches!(negation.argument.get_inner_expression(), Expression::Identifier(identifier)
                                if resolve_const_identifier_root_symbol(identifier, ctx) == Some(state_symbol_id)))
                })
        })
}

fn toggle_effect_resubscribes_with_cleanup<'a>(
    setter_node: &AstNode<'a>,
    deferred_function_id: NodeId,
    state_symbol_id: SymbolId,
    registration_call_ids_by_function: &rustc_hash::FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'a>,
) -> bool {
    let deferred_function = ctx.nodes().get_node(deferred_function_id);
    let Some((effect_function_id, effect_call_id)) =
        toggle_enclosing_effect_registration(deferred_function, ctx)
    else {
        return false;
    };
    let AstKind::CallExpression(effect_call) = ctx.nodes().get_node(effect_call_id).kind() else {
        return false;
    };
    let Some(Expression::ArrayExpression(dependencies)) = effect_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !dependencies.elements.iter().any(|element| {
        element.as_expression().is_some_and(|expression| {
            matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
                if resolve_const_identifier_root_symbol(identifier, ctx) == Some(state_symbol_id))
        })
    }) {
        return false;
    }
    let cleanup_function_ids = toggle_returned_cleanup_function_ids(effect_function_id, ctx);
    let Some(registration_call_ids) = registration_call_ids_by_function.get(&deferred_function_id)
    else {
        return false;
    };
    !registration_call_ids.is_empty()
        && registration_call_ids.iter().all(|registration_call_id| {
            toggle_nearest_function_id(*registration_call_id, ctx) == Some(effect_function_id)
                && toggle_registration_has_cleanup(
                    *registration_call_id,
                    &cleanup_function_ids,
                    ctx,
                )
        })
        && toggle_nearest_function_id(setter_node.id(), ctx) == Some(deferred_function_id)
}

fn toggle_enclosing_effect_registration<'a>(
    deferred_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<(NodeId, NodeId)> {
    if let Some(registration) = toggle_effect_registration_for_function(deferred_function, ctx) {
        return Some(registration);
    }
    for ancestor in ctx.nodes().ancestors(deferred_function.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && let Some(registration) = toggle_effect_registration_for_function(ancestor, ctx)
        {
            return Some(registration);
        }
    }
    None
}

fn toggle_effect_registration_for_function<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<(NodeId, NodeId)> {
    let parent = ctx.nodes().parent_node(function_node.id());
    if let AstKind::CallExpression(effect_call) = parent.kind()
        && is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx)
        && effect_call
            .arguments
            .first()
            .is_some_and(|argument| argument.span() == function_node.span())
    {
        return Some((function_node.id(), parent.id()));
    }
    let function_symbol_id = toggle_effect_function_symbol_id(function_node, ctx)?;
    for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let call_node = ctx.nodes().parent_node(reference_node.id());
        let AstKind::CallExpression(effect_call) = call_node.kind() else {
            continue;
        };
        if is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx)
            && effect_call
                .arguments
                .first()
                .is_some_and(|argument| argument.span() == reference_node.span())
        {
            return Some((function_node.id(), call_node.id()));
        }
    }
    None
}

fn toggle_effect_function_symbol_id<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != function_node.span())
    {
        return None;
    }
    declarator
        .id
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
}

fn toggle_returned_cleanup_function_ids(
    effect_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    let mut cleanup_function_ids = Vec::new();
    let effect_function = ctx.nodes().get_node(effect_function_id);
    if let AstKind::ArrowFunctionExpression(function) = effect_function.kind()
        && let Some(returned_expression) = function.get_expression()
    {
        toggle_resolve_cleanup_function_ids(returned_expression, ctx, &mut cleanup_function_ids);
        return cleanup_function_ids;
    }
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if toggle_nearest_function_id(candidate.id(), ctx) != Some(effect_function_id) {
            continue;
        }
        let Some(returned_expression) = return_statement.argument.as_ref() else {
            continue;
        };
        toggle_resolve_cleanup_function_ids(returned_expression, ctx, &mut cleanup_function_ids);
    }
    cleanup_function_ids
}

fn toggle_resolve_cleanup_function_ids<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    function_ids: &mut Vec<NodeId>,
) {
    match expression.get_inner_expression() {
        Expression::FunctionExpression(function) => {
            if !function_ids.contains(&function.node_id.get()) {
                function_ids.push(function.node_id.get());
            }
        }
        Expression::ArrowFunctionExpression(function) => {
            if !function_ids.contains(&function.node_id.get()) {
                function_ids.push(function.node_id.get());
            }
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = resolve_const_identifier_alias(identifier, ctx) else {
                return;
            };
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| !reference.is_read() || reference.is_write())
            {
                return;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => {
                    if !function_ids.contains(&function.node_id.get()) {
                        function_ids.push(function.node_id.get());
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    if let Some(initializer) = &declarator.init {
                        toggle_resolve_cleanup_function_ids(initializer, ctx, function_ids);
                    }
                }
                _ => {}
            }
        }
        Expression::ConditionalExpression(conditional) => {
            toggle_resolve_cleanup_function_ids(&conditional.consequent, ctx, function_ids);
            toggle_resolve_cleanup_function_ids(&conditional.alternate, ctx, function_ids);
        }
        Expression::SequenceExpression(sequence) => {
            if let Some(last_expression) = sequence.expressions.last() {
                toggle_resolve_cleanup_function_ids(last_expression, ctx, function_ids);
            }
        }
        _ => {}
    }
}

fn toggle_registration_has_cleanup(
    registration_call_id: NodeId,
    cleanup_function_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    let registration_node = ctx.nodes().get_node(registration_call_id);
    let AstKind::CallExpression(registration_call) = registration_node.kind() else {
        return false;
    };
    let callee = registration_call.callee.get_inner_expression();
    let registration_name = match callee {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        expression => expression
            .as_member_expression()
            .and_then(oxc_ast::ast::MemberExpression::static_property_name)
            .map(str::to_owned),
    };
    let clear_name = match registration_name.as_deref() {
        Some("requestAnimationFrame") => Some("cancelAnimationFrame"),
        Some("requestIdleCallback") => Some("cancelIdleCallback"),
        Some("setImmediate") => Some("clearImmediate"),
        Some("setInterval") => Some("clearInterval"),
        Some("setTimeout") => Some("clearTimeout"),
        _ => None,
    };
    if let Some(clear_name) = clear_name {
        let Some(result_symbol_id) = toggle_call_result_symbol_id(registration_node, ctx) else {
            return false;
        };
        return toggle_cleanup_calls(cleanup_function_ids, ctx, |cleanup_call| {
            toggle_call_name(cleanup_call, ctx).as_deref() == Some(clear_name)
                && cleanup_call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| {
                        matches!(argument.get_inner_expression(), Expression::Identifier(identifier)
                            if resolve_const_identifier_alias(identifier, ctx) == Some(result_symbol_id))
                    })
        });
    }
    let Some(member_expression) = callee.as_member_expression() else {
        return false;
    };
    match member_expression.static_property_name().as_deref() {
        Some("subscribe") => {
            let Some(subscription_key) = toggle_call_result_expression_key(registration_node, ctx)
            else {
                return false;
            };
            toggle_cleanup_calls(cleanup_function_ids, ctx, |cleanup_call| {
                cleanup_call
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .is_some_and(|cleanup_member| {
                        cleanup_member.static_property_name().as_deref() == Some("unsubscribe")
                            && resolve_expression_key(cleanup_member.object(), ctx, &mut Vec::new())
                                == Some(subscription_key.clone())
                    })
            })
        }
        Some("addEventListener") => {
            toggle_event_listener_has_cleanup(registration_call, cleanup_function_ids, ctx)
                || toggle_event_listener_has_abort_cleanup(
                    registration_call,
                    cleanup_function_ids,
                    ctx,
                )
        }
        _ => false,
    }
}

fn toggle_call_result_expression_key<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    toggle_call_result_symbol_id(call_node, ctx)
        .map(|symbol_id| format!("symbol:{}", symbol_id.index()))
}

fn toggle_call_result_symbol_id<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let parent = ctx.nodes().parent_node(call_node.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != call_node.span())
    {
        return None;
    }
    declarator
        .id
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
}

fn toggle_cleanup_calls<'a>(
    cleanup_function_ids: &[NodeId],
    ctx: &LintContext<'a>,
    mut matches_cleanup: impl FnMut(&oxc_ast::ast::CallExpression<'a>) -> bool,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(cleanup_call) = candidate.kind() else {
            return false;
        };
        let Some(cleanup_function_id) = toggle_nearest_function_id(candidate.id(), ctx) else {
            return false;
        };
        cleanup_function_ids.contains(&cleanup_function_id)
            && !is_node_conditionally_executed(candidate, cleanup_function_id, ctx)
            && matches_cleanup(cleanup_call)
    })
}

fn toggle_call_name<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier)
            if ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none() =>
        {
            Some(identifier.name.to_string())
        }
        expression => expression
            .as_member_expression()
            .filter(|member| toggle_is_global_object(member.object(), ctx))
            .and_then(oxc_ast::ast::MemberExpression::static_property_name)
            .map(str::to_owned),
    }
}

fn toggle_event_listener_has_cleanup<'a>(
    registration_call: &oxc_ast::ast::CallExpression<'a>,
    cleanup_function_ids: &[NodeId],
    ctx: &LintContext<'a>,
) -> bool {
    let Some(registration_member) = registration_call
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Some(event_argument) = registration_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(callback_argument) = registration_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(receiver_key) =
        resolve_expression_key(registration_member.object(), ctx, &mut Vec::new())
    else {
        return false;
    };
    let Some(event_key) = resolve_expression_key(event_argument, ctx, &mut Vec::new()) else {
        return false;
    };
    let Some(callback_key) = resolve_expression_key(callback_argument, ctx, &mut Vec::new()) else {
        return false;
    };
    let registration_capture = toggle_event_listener_capture(registration_call);
    toggle_cleanup_calls(cleanup_function_ids, ctx, |cleanup_call| {
        let Some(cleanup_member) = cleanup_call
            .callee
            .get_inner_expression()
            .as_member_expression()
        else {
            return false;
        };
        cleanup_member.static_property_name().as_deref() == Some("removeEventListener")
            && registration_capture.is_some()
            && toggle_event_listener_capture(cleanup_call) == registration_capture
            && resolve_expression_key(cleanup_member.object(), ctx, &mut Vec::new()).as_deref()
                == Some(receiver_key.as_str())
            && cleanup_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|argument| resolve_expression_key(argument, ctx, &mut Vec::new()))
                .as_deref()
                == Some(event_key.as_str())
            && cleanup_call
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
                .and_then(|argument| resolve_expression_key(argument, ctx, &mut Vec::new()))
                .as_deref()
                == Some(callback_key.as_str())
    })
}

fn toggle_event_listener_capture(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
) -> Option<bool> {
    let Some(options) = call_expression
        .arguments
        .get(2)
        .and_then(Argument::as_expression)
    else {
        return Some(false);
    };
    match options.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::ObjectExpression(object) => {
            let mut capture = false;
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return None;
                };
                let Some(property_name) = property.key.static_name() else {
                    return None;
                };
                if !property.computed && property_name == "__proto__" {
                    return None;
                }
                if property_name != "capture" {
                    continue;
                }
                let Expression::BooleanLiteral(value) = property.value.get_inner_expression()
                else {
                    return None;
                };
                capture = value.value;
            }
            Some(capture)
        }
        _ => None,
    }
}

fn toggle_event_listener_has_abort_cleanup<'a>(
    registration_call: &oxc_ast::ast::CallExpression<'a>,
    cleanup_function_ids: &[NodeId],
    ctx: &LintContext<'a>,
) -> bool {
    let Some(Expression::ObjectExpression(options)) = registration_call
        .arguments
        .get(2)
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let controller_key = options.properties.iter().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if property.key.static_name().as_deref() != Some("signal") {
            return None;
        }
        let member = property
            .value
            .get_inner_expression()
            .as_member_expression()?;
        (member.static_property_name().as_deref() == Some("signal"))
            .then(|| resolve_expression_key(member.object(), ctx, &mut Vec::new()))
            .flatten()
    });
    let Some(controller_key) = controller_key else {
        return false;
    };
    toggle_cleanup_calls(cleanup_function_ids, ctx, |cleanup_call| {
        cleanup_call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member| {
                member.static_property_name().as_deref() == Some("abort")
                    && resolve_expression_key(member.object(), ctx, &mut Vec::new()).as_deref()
                        == Some(controller_key.as_str())
            })
    })
}

fn toggle_has_latest_ref_equality_guard<'a>(
    setter_node: &AstNode<'a>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let has_enclosing_equality = ctx.nodes().ancestors(setter_node.id()).any(|ancestor| {
        matches!(ancestor.kind(), AstKind::IfStatement(statement)
            if statement.consequent.span().contains_inclusive(setter_node.span())
                && toggle_test_compares_fresh_ref(&statement.test, state_symbol_id, true, ctx))
    });
    if has_enclosing_equality {
        return true;
    }
    let Some(block_node) = ctx
        .nodes()
        .ancestors(setter_node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::BlockStatement(_)))
    else {
        return false;
    };
    let mut containing_statement = setter_node;
    while ctx.nodes().parent_node(containing_statement.id()).id() != block_node.id() {
        containing_statement = ctx.nodes().parent_node(containing_statement.id());
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IfStatement(statement) = candidate.kind() else {
            return false;
        };
        ctx.nodes().parent_node(candidate.id()).id() == block_node.id()
            && candidate.span().start < containing_statement.span().start
            && toggle_statement_terminates(&statement.consequent)
            && toggle_test_compares_fresh_ref(&statement.test, state_symbol_id, false, ctx)
    })
}

fn toggle_statement_terminates(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    match statement {
        oxc_ast::ast::Statement::ReturnStatement(_)
        | oxc_ast::ast::Statement::ThrowStatement(_) => true,
        oxc_ast::ast::Statement::BlockStatement(block) => {
            block.body.last().is_some_and(toggle_statement_terminates)
        }
        _ => false,
    }
}

fn toggle_test_compares_fresh_ref<'a>(
    expression: &Expression<'a>,
    state_symbol_id: SymbolId,
    expects_equality: bool,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::BinaryExpression(binary) = expression.get_inner_expression() else {
        return false;
    };
    let operator_matches = if expects_equality {
        matches!(
            binary.operator,
            BinaryOperator::Equality | BinaryOperator::StrictEquality
        )
    } else {
        matches!(
            binary.operator,
            BinaryOperator::Inequality | BinaryOperator::StrictInequality
        )
    };
    if !operator_matches {
        return false;
    }
    let expressions = [&binary.left, &binary.right];
    let has_state = expressions.iter().any(|operand| {
        matches!(operand.get_inner_expression(), Expression::Identifier(identifier)
            if resolve_const_identifier_root_symbol(identifier, ctx) == Some(state_symbol_id))
    });
    let fresh_ref = expressions.iter().find_map(|operand| {
        let member = operand.get_inner_expression().as_member_expression()?;
        (member.static_property_name().as_deref() == Some("current"))
            .then(|| toggle_ref_is_fresh_state_mirror(member, state_symbol_id, ctx))
    });
    has_state && fresh_ref == Some(true)
}

fn toggle_ref_is_fresh_state_mirror<'a>(
    ref_member: &oxc_ast::ast::MemberExpression<'a>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(ref_identifier) = ref_member.object().get_inner_expression() else {
        return false;
    };
    let Some(ref_symbol_id) = ctx
        .scoping()
        .get_reference(ref_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(ref_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let declaration_statement = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = declaration_statement.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(use_ref_call)) = declarator.init.as_ref() else {
        return false;
    };
    if !variable_declaration.kind.is_const()
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|identifier| identifier.symbol_id() != ref_symbol_id)
        || !is_react_hook_call(use_ref_call, &["useRef"], ctx)
    {
        return false;
    }
    let component_function_id = toggle_nearest_function_id(declaration.id(), ctx);
    let execution_boundary_id = component_function_id
        .unwrap_or_else(|| ctx.nodes().iter().next().expect("program node").id());
    let mut latest_assignment: Option<(u32, bool)> = None;
    for reference in ctx.scoping().get_resolved_references(ref_symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let member_node = ctx.nodes().parent_node(reference_node.id());
        let is_current_member = match member_node.kind() {
            AstKind::StaticMemberExpression(member) => {
                member.property.name == "current" && member.object.span() == reference_node.span()
            }
            AstKind::ComputedMemberExpression(member) => {
                member.static_property_name().as_deref() == Some("current")
                    && member.object.span() == reference_node.span()
            }
            _ => false,
        };
        if !is_current_member {
            continue;
        }
        let assignment_node = ctx.nodes().parent_node(member_node.id());
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            continue;
        };
        if assignment.left.span() != member_node.span()
            || toggle_nearest_function_id(assignment_node.id(), ctx) != component_function_id
            || is_node_conditionally_executed(assignment_node, execution_boundary_id, ctx)
        {
            continue;
        }
        let mirrors_state = matches!(assignment.right.get_inner_expression(), Expression::Identifier(identifier)
            if resolve_const_identifier_root_symbol(identifier, ctx) == Some(state_symbol_id));
        if latest_assignment
            .as_ref()
            .is_none_or(|(offset, _)| assignment_node.span().start > *offset)
        {
            latest_assignment = Some((assignment_node.span().start, mirrors_state));
        }
    }
    latest_assignment.is_some_and(|(_, mirrors_state)| mirrors_state)
}
