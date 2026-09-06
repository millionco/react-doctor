use rustc_hash::FxHashSet;

use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, MemberExpression, ObjectPropertyKind, PropertyKey, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};

use crate::{AstNode, context::LintContext, rule::Rule};

const EFFECT_HOOK_NAMES: [&str; 3] = ["useEffect", "useInsertionEffect", "useLayoutEffect"];

#[derive(Debug, Default, Clone)]
pub struct EffectListenerCleanupMismatch;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum CallbackIdentity {
    Concrete(NodeId),
    Stable(SymbolId),
}

#[derive(Debug, Clone)]
struct ListenerCandidate {
    span: Span,
    target_key: String,
    event_name: String,
    callback_identity: Option<CallbackIdentity>,
    capture: Option<bool>,
}

#[derive(Debug, Clone)]
struct ListenerRegistration {
    span: Span,
    target_key: String,
    event_name: String,
    callback_identity: CallbackIdentity,
    capture: bool,
    once: bool,
    abort_controller_symbol_id: Option<SymbolId>,
    has_unknown_cancellation: bool,
}

#[derive(Debug, Default)]
struct CleanupAnalysis {
    removals: Vec<ListenerCandidate>,
    aborted_controller_symbol_ids: FxHashSet<SymbolId>,
    execution_function_ids: FxHashSet<NodeId>,
    has_unknown_abort_call: bool,
    has_unknown_removal_call: bool,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum IdentityComparison {
    Same,
    Different,
    Unknown,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum TargetComparison {
    Same,
    Different,
    Unknown,
}

declare_oxc_lint!(
    /// Require effect cleanup to remove the event listener that the effect registered.
    EffectListenerCleanupMismatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require effect cleanup to match its event listener.",
);

impl Rule for EffectListenerCleanupMismatch {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if !is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx) {
                continue;
            }
            let Some(effect_callback) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(effect_callback_id) =
                exact_local_callback_function_id(effect_callback, ctx, &mut Vec::new())
            else {
                continue;
            };
            let Some(cleanup_function_id) = canonical_cleanup_function_id(effect_callback_id, ctx)
            else {
                continue;
            };

            let registrations = collect_listener_registrations(effect_callback_id, ctx);
            if registrations.is_empty() {
                continue;
            }
            let setup_aborted_controller_symbol_ids =
                collect_unconditional_aborted_controllers(effect_callback_id, ctx);
            let Some(cleanup) = analyze_cleanup(cleanup_function_id, ctx) else {
                continue;
            };

            for registration in &registrations {
                if registration.has_unknown_cancellation || cleanup.has_unknown_removal_call {
                    continue;
                }
                if registrations
                    .iter()
                    .filter(|candidate| {
                        candidate.target_key == registration.target_key
                            && candidate.event_name == registration.event_name
                    })
                    .count()
                    > 1
                {
                    continue;
                }
                if registration
                    .abort_controller_symbol_id
                    .is_some_and(|controller_symbol_id| {
                        cleanup.has_unknown_abort_call
                            || setup_aborted_controller_symbol_ids.contains(&controller_symbol_id)
                            || cleanup
                                .aborted_controller_symbol_ids
                                .contains(&controller_symbol_id)
                    })
                {
                    continue;
                }
                if cleanup_cancels_registration(&cleanup, registration, ctx) {
                    continue;
                }

                let candidate_removals = cleanup
                    .removals
                    .iter()
                    .filter(|removal| {
                        removal.target_key == registration.target_key
                            && removal.event_name == registration.event_name
                    })
                    .collect::<Vec<_>>();
                let mut first_mismatch = None;
                let mut has_non_mismatch_candidate = false;
                for removal in &candidate_removals {
                    let (Some(removal_identity), Some(removal_capture)) =
                        (removal.callback_identity, removal.capture)
                    else {
                        has_non_mismatch_candidate = true;
                        break;
                    };
                    let callback_comparison = compare_callback_identities(
                        registration.callback_identity,
                        removal_identity,
                    );
                    if callback_comparison == IdentityComparison::Unknown
                        || (callback_comparison == IdentityComparison::Same
                            && registration.capture == removal_capture)
                    {
                        has_non_mismatch_candidate = true;
                        break;
                    }
                    first_mismatch.get_or_insert((removal, removal_capture, callback_comparison));
                }
                let Some((removal, removal_capture, callback_comparison)) = first_mismatch else {
                    continue;
                };
                if has_non_mismatch_candidate {
                    continue;
                }

                ctx.diagnostic(
                    OxcDiagnostic::error(listener_cleanup_mismatch_message(
                        &registration.event_name,
                        registration.capture,
                        removal_capture,
                        callback_comparison,
                    ))
                    .with_label(removal.span),
                );
            }
        }
    }
}

fn canonical_cleanup_function_id<'a>(
    effect_callback_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    let final_statement = function_statements(effect_callback_id, ctx)?.last()?;
    let Statement::ReturnStatement(final_return) = final_statement else {
        return None;
    };
    let mut effect_return_count = 0;
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) == Some(effect_callback_id)
            && matches!(candidate.kind(), AstKind::ReturnStatement(_))
        {
            effect_return_count += 1;
        }
    }
    if effect_return_count != 1 {
        return None;
    }
    exact_local_callback_function_id(final_return.argument.as_ref()?, ctx, &mut Vec::new())
}

fn function_statements<'a>(
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<&'a [Statement<'a>]> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => Some(&function.body.as_ref()?.statements),
        AstKind::ArrowFunctionExpression(function) => {
            Some(&function.body.as_function_body()?.statements)
        }
        _ => None,
    }
}

fn collect_listener_registrations(
    effect_callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> Vec<ListenerRegistration> {
    let mut registrations = Vec::new();
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(effect_callback_id)
            || !node_path_is_unambiguous(candidate, effect_callback_id, ctx)
        {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        let Some(listener) = read_listener_candidate(call, "addEventListener", ctx) else {
            continue;
        };
        let (Some(callback_identity), Some(capture)) =
            (listener.callback_identity, listener.capture)
        else {
            continue;
        };
        let (abort_controller_symbol_id, has_unknown_cancellation) =
            registration_cancellation(call.arguments.get(2), ctx);
        registrations.push(ListenerRegistration {
            span: call.span,
            target_key: listener.target_key,
            event_name: listener.event_name,
            callback_identity,
            capture,
            once: resolve_static_once_option(call.arguments.get(2), ctx) == Some(true),
            abort_controller_symbol_id,
            has_unknown_cancellation,
        });
    }
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(effect_callback_id)
            || !node_path_is_unambiguous(candidate, effect_callback_id, ctx)
        {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        let Some((target_key, event_name)) = read_static_event_dispatch(call, ctx) else {
            continue;
        };
        let matching_registration_indices = registrations
            .iter()
            .enumerate()
            .filter_map(|(index, registration)| {
                (registration.span.start < call.span.start
                    && registration.target_key == target_key
                    && registration.event_name == event_name)
                    .then_some(index)
            })
            .collect::<Vec<_>>();
        let [registration_index] = matching_registration_indices.as_slice() else {
            continue;
        };
        let registration = &registrations[*registration_index];
        if !registration.once
            || count_listener_registrations_for_target_before(
                effect_callback_id,
                &target_key,
                call.span.start,
                ctx,
            ) != 1
            || !matches!(
                registration.callback_identity,
                CallbackIdentity::Concrete(_)
            )
            || callback_may_call(registration.callback_identity, ctx)
        {
            continue;
        }
        registrations.remove(*registration_index);
    }
    registrations
}

fn count_listener_registrations_for_target_before(
    effect_callback_id: NodeId,
    target_key: &str,
    dispatch_start: u32,
    ctx: &LintContext<'_>,
) -> usize {
    ctx.nodes()
        .iter()
        .filter(|candidate| {
            if candidate.span().start >= dispatch_start
                || local_callback_nearest_function_id(candidate.id(), ctx)
                    != Some(effect_callback_id)
                || !node_path_is_unambiguous(candidate, effect_callback_id, ctx)
            {
                return false;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            resolved_member_property_name(member, ctx).as_deref() == Some("addEventListener")
                && resolve_listener_target_key(member.object(), ctx, &mut FxHashSet::default())
                    .as_deref()
                    == Some(target_key)
        })
        .count()
}

fn callback_may_call(identity: CallbackIdentity, ctx: &LintContext<'_>) -> bool {
    let CallbackIdentity::Concrete(function_id) = identity else {
        return true;
    };
    let callback_span = ctx.nodes().get_node(function_id).span();
    ctx.nodes().iter().any(|candidate| {
        callback_span.contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::CallExpression(_))
    })
}

fn read_static_event_dispatch<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(String, String)> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    if resolved_member_property_name(member, ctx).as_deref() != Some("dispatchEvent")
        || !is_fresh_event_target_expression(member.object(), ctx)
    {
        return None;
    }
    let Expression::NewExpression(event) = call
        .arguments
        .first()?
        .as_expression()?
        .get_inner_expression()
    else {
        return None;
    };
    let Expression::Identifier(event_callee) = event.callee.get_inner_expression() else {
        return None;
    };
    if event_callee.name != "Event"
        || ctx
            .scoping()
            .get_reference(event_callee.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    let target_key = resolve_listener_target_key(member.object(), ctx, &mut FxHashSet::default())?;
    let event_name = resolve_static_string(
        event.arguments.first()?.as_expression()?,
        ctx,
        &mut FxHashSet::default(),
    )?;
    Some((target_key, event_name))
}

fn is_fresh_event_target_expression(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(symbol_id) =
        resolve_plain_const_alias_symbol(symbol_id, ctx, &mut FxHashSet::default())
    else {
        return false;
    };
    let Some(Expression::NewExpression(construction)) =
        plain_const_initializer(symbol_id, ctx).map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Expression::Identifier(callee) = construction.callee.get_inner_expression() else {
        return false;
    };
    callee.name == "EventTarget"
        && ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
            .is_none()
}

fn analyze_cleanup(cleanup_function_id: NodeId, ctx: &LintContext<'_>) -> Option<CleanupAnalysis> {
    let mut analysis = CleanupAnalysis::default();
    let mut pending_function_ids = vec![cleanup_function_id];
    while let Some(execution_function_id) = pending_function_ids.pop() {
        if !analysis
            .execution_function_ids
            .insert(execution_function_id)
        {
            continue;
        }
        if cleanup_function_has_ambiguous_exit(execution_function_id, ctx) {
            return None;
        }
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx)
                != Some(execution_function_id)
            {
                continue;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            let is_unambiguous = node_path_is_unambiguous(candidate, execution_function_id, ctx);
            if let Some(member) = call.callee.get_inner_expression().as_member_expression()
                && resolved_member_property_name(member, ctx).as_deref()
                    == Some("removeEventListener")
            {
                if is_unambiguous {
                    if let Some(removal) = read_listener_candidate(call, "removeEventListener", ctx)
                    {
                        analysis.has_unknown_removal_call |=
                            removal.callback_identity.is_none() || removal.capture.is_none();
                        analysis.removals.push(removal);
                    } else {
                        analysis.has_unknown_removal_call = true;
                    }
                }
                continue;
            }
            if is_unambiguous && let Some(removal) = read_destructured_removal_candidate(call, ctx)
            {
                analysis.removals.push(removal);
                continue;
            }
            if let Some(member) = call.callee.get_inner_expression().as_member_expression()
                && resolved_member_property_name(member, ctx).as_deref() == Some("abort")
            {
                if is_unambiguous {
                    if let Some(controller_symbol_id) =
                        resolve_local_abort_controller_symbol(member.object(), ctx)
                    {
                        analysis
                            .aborted_controller_symbol_ids
                            .insert(controller_symbol_id);
                    } else {
                        analysis.has_unknown_abort_call = true;
                    }
                }
                continue;
            }
            if is_unambiguous
                && let Some(controller_symbol_id) = resolve_bound_abort_controller_symbol(call, ctx)
            {
                analysis
                    .aborted_controller_symbol_ids
                    .insert(controller_symbol_id);
                continue;
            }
            if !is_unambiguous
                || !matches!(
                    call.callee.get_inner_expression(),
                    Expression::Identifier(_)
                )
            {
                continue;
            }
            let Some(called_function_id) =
                exact_local_callback_function_id(&call.callee, ctx, &mut Vec::new())
            else {
                continue;
            };
            if function_is_synchronous_non_generator(called_function_id, ctx) {
                pending_function_ids.push(called_function_id);
            }
        }
    }
    Some(analysis)
}

fn cleanup_function_has_ambiguous_exit<'a>(function_id: NodeId, ctx: &LintContext<'a>) -> bool {
    let final_statement_span = function_statements(function_id, ctx)
        .and_then(|statements| statements.last())
        .map(GetSpan::span);
    ctx.nodes().iter().any(|candidate| {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
            return false;
        }
        match candidate.kind() {
            AstKind::ThrowStatement(_) => true,
            AstKind::ReturnStatement(_) => Some(candidate.span()) != final_statement_span,
            _ => false,
        }
    })
}

fn collect_unconditional_aborted_controllers(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    guaranteed_aborted_controllers_in_region(
        ctx.nodes().get_node(function_id).span(),
        function_id,
        ctx,
    )
}

fn guaranteed_aborted_controllers_in_region(
    region_span: Span,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let mut controllers = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id)
            || !region_span.contains_inclusive(candidate.span())
            || !node_path_is_unambiguous_to_span(candidate, region_span, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::CallExpression(call) => {
                if let Some(controller_symbol_id) = resolve_bound_abort_controller_symbol(call, ctx)
                {
                    controllers.insert(controller_symbol_id);
                    continue;
                }
                let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                    continue;
                };
                if resolved_member_property_name(member, ctx).as_deref() == Some("abort")
                    && let Some(controller_symbol_id) =
                        resolve_local_abort_controller_symbol(member.object(), ctx)
                {
                    controllers.insert(controller_symbol_id);
                }
            }
            AstKind::IfStatement(statement) => {
                let branch_controllers =
                    match static_boolean_value(&statement.test) {
                        Some(true) => guaranteed_aborted_controllers_in_region(
                            statement.consequent.span(),
                            function_id,
                            ctx,
                        ),
                        Some(false) => statement.alternate.as_ref().map_or_else(
                            FxHashSet::default,
                            |alternate| {
                                guaranteed_aborted_controllers_in_region(
                                    alternate.span(),
                                    function_id,
                                    ctx,
                                )
                            },
                        ),
                        None => statement.alternate.as_ref().map_or_else(
                            FxHashSet::default,
                            |alternate| {
                                let consequent = guaranteed_aborted_controllers_in_region(
                                    statement.consequent.span(),
                                    function_id,
                                    ctx,
                                );
                                let alternate = guaranteed_aborted_controllers_in_region(
                                    alternate.span(),
                                    function_id,
                                    ctx,
                                );
                                consequent.intersection(&alternate).copied().collect()
                            },
                        ),
                    };
                controllers.extend(branch_controllers);
            }
            AstKind::ConditionalExpression(expression) => {
                let branch_controllers = match static_boolean_value(&expression.test) {
                    Some(true) => guaranteed_aborted_controllers_in_region(
                        expression.consequent.span(),
                        function_id,
                        ctx,
                    ),
                    Some(false) => guaranteed_aborted_controllers_in_region(
                        expression.alternate.span(),
                        function_id,
                        ctx,
                    ),
                    None => {
                        let consequent = guaranteed_aborted_controllers_in_region(
                            expression.consequent.span(),
                            function_id,
                            ctx,
                        );
                        let alternate = guaranteed_aborted_controllers_in_region(
                            expression.alternate.span(),
                            function_id,
                            ctx,
                        );
                        consequent.intersection(&alternate).copied().collect()
                    }
                };
                controllers.extend(branch_controllers);
            }
            _ => {}
        }
    }
    controllers
}

fn cleanup_cancels_registration(
    cleanup: &CleanupAnalysis,
    registration: &ListenerRegistration,
    ctx: &LintContext<'_>,
) -> bool {
    if cleanup.removals.iter().any(|removal| {
        removal.event_name == registration.event_name
            && removal.capture == Some(registration.capture)
            && removal.callback_identity.is_some_and(|identity| {
                compare_callback_identities(registration.callback_identity, identity)
                    == IdentityComparison::Same
            })
            && compare_target_keys(&registration.target_key, &removal.target_key)
                != TargetComparison::Different
    }) {
        return true;
    }
    cleanup.execution_function_ids.iter().any(|function_id| {
        ctx.nodes().iter().any(|candidate| {
            if local_callback_nearest_function_id(candidate.id(), ctx) != Some(*function_id) {
                return false;
            }
            match candidate.kind() {
                AstKind::IfStatement(statement) => {
                    statement.alternate.as_ref().is_some_and(|alternate| {
                        branch_may_cancel_registration(
                            statement.consequent.span(),
                            *function_id,
                            registration,
                            ctx,
                        ) && branch_may_cancel_registration(
                            alternate.span(),
                            *function_id,
                            registration,
                            ctx,
                        )
                    })
                }
                AstKind::ConditionalExpression(expression) => {
                    branch_may_cancel_registration(
                        expression.consequent.span(),
                        *function_id,
                        registration,
                        ctx,
                    ) && branch_may_cancel_registration(
                        expression.alternate.span(),
                        *function_id,
                        registration,
                        ctx,
                    )
                }
                _ => false,
            }
        })
    })
}

fn branch_may_cancel_registration(
    branch_span: Span,
    function_id: NodeId,
    registration: &ListenerRegistration,
    ctx: &LintContext<'_>,
) -> bool {
    for candidate in ctx.nodes().iter() {
        if !branch_span.contains_inclusive(candidate.span())
            || local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id)
            || !node_path_is_unambiguous_to_span(candidate, branch_span, ctx)
        {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if registration
            .abort_controller_symbol_id
            .is_some_and(|controller_symbol_id| {
                resolve_bound_abort_controller_symbol(call, ctx) == Some(controller_symbol_id)
            })
        {
            return true;
        }
        if let Some(removal) = read_destructured_removal_candidate(call, ctx)
            && removal_may_cancel_registration(&removal, registration)
        {
            return true;
        }
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            continue;
        };
        match resolved_member_property_name(member, ctx).as_deref() {
            Some("abort") => {
                if registration
                    .abort_controller_symbol_id
                    .is_some_and(|controller_symbol_id| {
                        resolve_local_abort_controller_symbol(member.object(), ctx)
                            == Some(controller_symbol_id)
                    })
                {
                    return true;
                }
            }
            Some("removeEventListener") => {
                let Some(removal) = read_listener_candidate(call, "removeEventListener", ctx)
                else {
                    return true;
                };
                if removal_may_cancel_registration(&removal, registration) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn removal_may_cancel_registration(
    removal: &ListenerCandidate,
    registration: &ListenerRegistration,
) -> bool {
    if removal.event_name != registration.event_name
        || removal.capture != Some(registration.capture)
    {
        return false;
    }
    let Some(identity) = removal.callback_identity else {
        return true;
    };
    compare_callback_identities(registration.callback_identity, identity)
        != IdentityComparison::Different
        && compare_target_keys(&registration.target_key, &removal.target_key)
            != TargetComparison::Different
}

fn read_listener_candidate<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    method_name: &str,
    ctx: &LintContext<'a>,
) -> Option<ListenerCandidate> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    if resolved_member_property_name(member, ctx).as_deref() != Some(method_name) {
        return None;
    }
    let target_key = resolve_listener_target_key(member.object(), ctx, &mut FxHashSet::default())?;
    let event_name = resolve_static_string(
        call.arguments.first()?.as_expression()?,
        ctx,
        &mut FxHashSet::default(),
    )?;
    let callback_identity = call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .and_then(|callback| resolve_callback_identity(callback, ctx));
    let capture = resolve_listener_capture(call.arguments.get(2), ctx);
    Some(ListenerCandidate {
        span: call.span,
        target_key,
        event_name,
        callback_identity,
        capture,
    })
}

fn read_destructured_removal_candidate<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<ListenerCandidate> {
    let call_member = call.callee.get_inner_expression().as_member_expression()?;
    if !static_member_property_matches(call_member, "call") {
        return None;
    }
    let Expression::Identifier(method) = call_member.object().get_inner_expression() else {
        return None;
    };
    let method_symbol_id = ctx
        .scoping()
        .get_reference(method.reference_id())
        .symbol_id()?;
    if ctx
        .scoping()
        .get_resolved_references(method_symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(method_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return None;
    }
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return None;
    };
    if !pattern.properties.iter().any(|property| {
        resolved_property_key_name(&property.key, property.computed, ctx).as_deref()
            == Some("removeEventListener")
            && binding_pattern_has_direct_symbol(&property.value, method_symbol_id)
    }) {
        return None;
    }
    let declaration_target_key =
        resolve_listener_target_key(declarator.init.as_ref()?, ctx, &mut FxHashSet::default())?;
    let target_key = resolve_listener_target_key(
        call.arguments.first()?.as_expression()?,
        ctx,
        &mut FxHashSet::default(),
    )?;
    if declaration_target_key != target_key {
        return None;
    }
    let event_name = resolve_static_string(
        call.arguments.get(1)?.as_expression()?,
        ctx,
        &mut FxHashSet::default(),
    )?;
    let callback_identity = call
        .arguments
        .get(2)
        .and_then(Argument::as_expression)
        .and_then(|callback| resolve_callback_identity(callback, ctx));
    let capture = resolve_listener_capture(call.arguments.get(3), ctx);
    Some(ListenerCandidate {
        span: call.span,
        target_key,
        event_name,
        callback_identity,
        capture,
    })
}

fn binding_pattern_has_direct_symbol(
    pattern: &oxc_ast::ast::BindingPattern<'_>,
    symbol_id: SymbolId,
) -> bool {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) => {
            identifier.symbol_id() == symbol_id
        }
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => matches!(
            &assignment.left,
            oxc_ast::ast::BindingPattern::BindingIdentifier(identifier)
                if identifier.symbol_id() == symbol_id
        ),
        _ => false,
    }
}

fn resolve_bound_abort_controller_symbol<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    resolve_bound_abort_controller_expression(&call.callee, ctx, &mut FxHashSet::default())
}

fn resolve_bound_abort_controller_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<SymbolId> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if !visited_symbol_ids.insert(symbol_id)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
        {
            return None;
        }
        return resolve_bound_abort_controller_expression(
            plain_const_initializer(symbol_id, ctx)?,
            ctx,
            visited_symbol_ids,
        );
    }
    let Expression::CallExpression(bind_call) = expression else {
        return None;
    };
    let bind_member = bind_call
        .callee
        .get_inner_expression()
        .as_member_expression()?;
    if !static_member_property_matches(bind_member, "bind") {
        return None;
    }
    let abort_member = bind_member
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    if !static_member_property_matches(abort_member, "abort") {
        return None;
    }
    let method_controller_symbol =
        resolve_local_abort_controller_symbol(abort_member.object(), ctx)?;
    let bound_controller_symbol =
        resolve_local_abort_controller_symbol(bind_call.arguments.first()?.as_expression()?, ctx)?;
    (method_controller_symbol == bound_controller_symbol).then_some(method_controller_symbol)
}

fn resolve_callback_identity<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<CallbackIdentity> {
    if let Some(function_id) = exact_local_callback_function_id(expression, ctx, &mut Vec::new()) {
        return Some(CallbackIdentity::Concrete(function_id));
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    matches!(
        declaration.kind(),
        AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
            | AstKind::FormalParameter(_)
    )
    .then_some(CallbackIdentity::Stable(symbol_id))
}

fn resolve_listener_target_key<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return Some(format!("global:{}", identifier.name));
            };
            let symbol_id = resolve_plain_const_alias_symbol(symbol_id, ctx, visited_symbol_ids)?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            if let Expression::NewExpression(construction) = initializer {
                if let Expression::Identifier(callee) = construction.callee.get_inner_expression()
                    && ctx
                        .scoping()
                        .get_reference(callee.reference_id())
                        .symbol_id()
                        .is_some()
                {
                    return None;
                }
                return Some(format!("fresh:{symbol_id:?}"));
            }
            Some(format!("symbol:{symbol_id:?}"))
        }
        expression => {
            let member = expression.as_member_expression()?;
            let property_name = resolved_member_property_name(member, ctx)?;
            let object_key = resolve_listener_target_key(member.object(), ctx, visited_symbol_ids)?;
            if property_name == "document"
                && matches!(object_key.as_str(), "global:window" | "global:globalThis")
            {
                return Some("global:document".to_string());
            }
            if property_name == "window"
                && matches!(object_key.as_str(), "global:window" | "global:globalThis")
            {
                return Some("global:window".to_string());
            }
            Some(format!("{object_key}.{property_name}"))
        }
    }
}

fn resolve_plain_const_alias_symbol(
    mut symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<SymbolId> {
    loop {
        if !visited_symbol_ids.insert(symbol_id) {
            return None;
        }
        if ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
        {
            return None;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_id);
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return None;
        }
        let Some(Expression::Identifier(alias)) = declarator
            .init
            .as_ref()
            .map(|initializer| initializer.get_inner_expression())
        else {
            return Some(symbol_id);
        };
        symbol_id = ctx
            .scoping()
            .get_reference(alias.reference_id())
            .symbol_id()?;
    }
}

fn resolve_static_string<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            )
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            let initializer = plain_const_initializer(symbol_id, ctx)?;
            resolve_static_string(initializer, ctx, visited_symbol_ids)
        }
        _ => None,
    }
}

fn resolved_member_property_name<'a>(
    member: &MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if let Some(name) = member.static_property_name() {
        return Some(name.to_string());
    }
    let MemberExpression::ComputedMemberExpression(computed) = member else {
        return None;
    };
    resolve_static_string(&computed.expression, ctx, &mut FxHashSet::default())
}

fn resolve_listener_capture<'a>(
    argument: Option<&Argument<'a>>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let Some(expression) = argument.and_then(Argument::as_expression) else {
        return Some(false);
    };
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::ObjectExpression(object) => {
            let mut capture = false;
            for candidate in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = candidate else {
                    return None;
                };
                let property_name =
                    resolved_property_key_name(&property.key, property.computed, ctx)?;
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

fn resolve_static_once_option<'a>(
    argument: Option<&Argument<'a>>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let Some(expression) = argument.and_then(Argument::as_expression) else {
        return Some(false);
    };
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(_) => Some(false),
        Expression::ObjectExpression(object) => {
            let mut once = false;
            for candidate in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = candidate else {
                    return None;
                };
                let property_name =
                    resolved_property_key_name(&property.key, property.computed, ctx)?;
                if !property.computed && property_name == "__proto__" {
                    return None;
                }
                if property_name != "once" {
                    continue;
                }
                let Expression::BooleanLiteral(value) = property.value.get_inner_expression()
                else {
                    return None;
                };
                once = value.value;
            }
            Some(once)
        }
        _ => None,
    }
}

fn static_member_property_matches(member: &MemberExpression<'_>, expected_name: &str) -> bool {
    match member {
        MemberExpression::StaticMemberExpression(member) => member.property.name == expected_name,
        MemberExpression::ComputedMemberExpression(member) => {
            matches!(member.expression.get_inner_expression(),
                Expression::StringLiteral(literal) if literal.value == expected_name)
        }
        MemberExpression::PrivateFieldExpression(_) => false,
    }
}

fn registration_cancellation<'a>(
    argument: Option<&Argument<'a>>,
    ctx: &LintContext<'a>,
) -> (Option<SymbolId>, bool) {
    let Some(Expression::ObjectExpression(object)) = argument
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return (None, false);
    };
    let mut controller_symbol_id = None;
    for candidate in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = candidate else {
            return (None, false);
        };
        let Some(property_name) = resolved_property_key_name(&property.key, property.computed, ctx)
        else {
            return (None, false);
        };
        if property_name != "signal" {
            continue;
        }
        if controller_symbol_id.is_some() {
            return (None, true);
        }
        controller_symbol_id = resolve_signal_abort_controller_symbol(&property.value, ctx);
        if controller_symbol_id.is_none() {
            return (None, true);
        }
    }
    (controller_symbol_id, false)
}

fn resolve_signal_abort_controller_symbol<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    resolve_signal_abort_controller_symbol_internal(expression, ctx, &mut FxHashSet::default())
}

fn resolve_signal_abort_controller_symbol_internal<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<SymbolId> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression()
        && resolved_member_property_name(member, ctx).as_deref() == Some("signal")
    {
        return resolve_local_abort_controller_symbol(member.object(), ctx);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    let initializer = plain_const_initializer(symbol_id, ctx)?;
    resolve_signal_abort_controller_symbol_internal(initializer, ctx, visited_symbol_ids)
}

fn resolve_local_abort_controller_symbol<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let symbol_id = resolve_plain_const_alias_symbol(symbol_id, ctx, &mut FxHashSet::default())?;
    let initializer = plain_const_initializer(symbol_id, ctx)?.get_inner_expression();
    let Expression::NewExpression(construction) = initializer else {
        return None;
    };
    let Expression::Identifier(callee) = construction.callee.get_inner_expression() else {
        return None;
    };
    (callee.name == "AbortController"
        && ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
            .is_none())
    .then_some(symbol_id)
}

fn plain_const_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    declarator.init.as_ref()
}

fn resolved_property_key_name<'a>(
    key: &PropertyKey<'a>,
    computed: bool,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if !computed {
        return key.static_name().map(|name| name.to_string());
    }
    match key {
        PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
        PropertyKey::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            )
        }
        PropertyKey::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            resolve_static_string(
                plain_const_initializer(symbol_id, ctx)?,
                ctx,
                &mut FxHashSet::default(),
            )
        }
        _ => None,
    }
}

fn compare_callback_identities(
    first: CallbackIdentity,
    second: CallbackIdentity,
) -> IdentityComparison {
    if first == second {
        return IdentityComparison::Same;
    }
    if matches!(first, CallbackIdentity::Concrete(_))
        && matches!(second, CallbackIdentity::Concrete(_))
    {
        return IdentityComparison::Different;
    }
    IdentityComparison::Unknown
}

fn compare_target_keys(first: &str, second: &str) -> TargetComparison {
    if first == second {
        return TargetComparison::Same;
    }
    if first.starts_with("global:") && second.starts_with("global:")
        || first.starts_with("fresh:")
        || second.starts_with("fresh:")
    {
        return TargetComparison::Different;
    }
    TargetComparison::Unknown
}

fn node_path_is_unambiguous(
    node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    node_path_is_unambiguous_until(node, None, Some(function_id), ctx)
}

fn node_path_is_unambiguous_to_span(
    node: &AstNode<'_>,
    boundary_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    node_path_is_unambiguous_until(node, Some(boundary_span), None, ctx)
}

fn node_path_is_unambiguous_until(
    node: &AstNode<'_>,
    boundary_span: Option<Span>,
    function_id: Option<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if function_id == Some(ancestor.id()) || boundary_span == Some(ancestor.span()) {
            return true;
        }
        let is_guaranteed = match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                if statement.test.span().contains_inclusive(child_span) {
                    true
                } else {
                    let static_test = static_boolean_value(&statement.test);
                    statement.consequent.span().contains_inclusive(child_span)
                        && static_test == Some(true)
                        || statement.alternate.as_ref().is_some_and(|alternate| {
                            alternate.span().contains_inclusive(child_span)
                                && static_test == Some(false)
                        })
                }
            }
            AstKind::ConditionalExpression(expression) => {
                if expression.test.span().contains_inclusive(child_span) {
                    true
                } else {
                    let static_test = static_boolean_value(&expression.test);
                    expression.consequent.span().contains_inclusive(child_span)
                        && static_test == Some(true)
                        || expression.alternate.span().contains_inclusive(child_span)
                            && static_test == Some(false)
                }
            }
            AstKind::LogicalExpression(expression) => {
                expression.left.span().contains_inclusive(child_span)
                    || expression.right.span().contains_inclusive(child_span)
                        && matches!(
                            (
                                expression.operator.as_str(),
                                static_boolean_value(&expression.left)
                            ),
                            ("&&", Some(true)) | ("||", Some(false))
                        )
            }
            AstKind::TryStatement(statement) => statement
                .finalizer
                .as_ref()
                .is_some_and(|finalizer| finalizer.span.contains_inclusive(child_span)),
            AstKind::SwitchStatement(statement) => {
                statement.discriminant.span().contains_inclusive(child_span)
            }
            AstKind::ForStatement(statement) => {
                statement
                    .init
                    .as_ref()
                    .is_some_and(|init| init.span().contains_inclusive(child_span))
                    || statement
                        .test
                        .as_ref()
                        .is_some_and(|test| test.span().contains_inclusive(child_span))
            }
            AstKind::ForInStatement(statement) => {
                statement.right.span().contains_inclusive(child_span)
            }
            AstKind::ForOfStatement(statement) => {
                statement.right.span().contains_inclusive(child_span)
                    || statement.body.span().contains_inclusive(child_span)
                        && for_of_body_prefix_is_guaranteed(statement, child_span, ctx)
            }
            AstKind::WhileStatement(statement) => {
                statement.test.span().contains_inclusive(child_span)
            }
            AstKind::CatchClause(_) | AstKind::DoWhileStatement(_) | AstKind::SwitchCase(_) => {
                false
            }
            _ => true,
        };
        if !is_guaranteed {
            return false;
        }
        child_span = ancestor.span();
    }
    false
}

fn for_of_body_prefix_is_guaranteed(
    statement: &oxc_ast::ast::ForOfStatement<'_>,
    child_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::ArrayExpression(array) = statement.right.get_inner_expression() else {
        return false;
    };
    if !array.elements.iter().any(|element| {
        !matches!(
            element,
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(_)
                | oxc_ast::ast::ArrayExpressionElement::Elision(_)
        )
    }) {
        return false;
    }
    !ctx.nodes().iter().any(|candidate| {
        candidate.span().start < child_span.start
            && statement.body.span().contains_inclusive(candidate.span())
            && matches!(
                candidate.kind(),
                AstKind::BreakStatement(_) | AstKind::ContinueStatement(_)
            )
    })
}

fn static_boolean_value(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            static_boolean_value(&unary.argument).map(|value| !value)
        }
        _ => None,
    }
}

fn function_is_synchronous_non_generator(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => !function.r#async && !function.generator,
        AstKind::ArrowFunctionExpression(function) => !function.r#async,
        _ => false,
    }
}

fn listener_cleanup_mismatch_message(
    event_name: &str,
    registration_capture: bool,
    removal_capture: bool,
    callback_comparison: IdentityComparison,
) -> String {
    let callback_mismatch = callback_comparison == IdentityComparison::Different;
    let capture_mismatch = registration_capture != removal_capture;
    if callback_mismatch && capture_mismatch {
        return format!(
            "The cleanup removes `{event_name}` with a different callback binding and capture {removal_capture}, but it was registered with capture {registration_capture}. Pass the same callback binding and capture flag to both EventTarget calls."
        );
    }
    if callback_mismatch {
        return format!(
            "The cleanup removes `{event_name}` with a different callback binding than the one registered, so `removeEventListener` cannot detach that listener. Pass the same callback binding to both calls."
        );
    }
    format!(
        "The cleanup removes `{event_name}` with capture {removal_capture}, but it was registered with capture {registration_capture}. `removeEventListener` must use the same capture flag as `addEventListener`."
    )
}
