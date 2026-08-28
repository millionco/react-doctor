use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;

const R3F_GLOBAL_EFFECT_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const R3F_GLOBAL_EFFECT_REACT_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const R3F_GLOBAL_EFFECT_API_NAMES: [&str; 3] = ["addAfterEffect", "addEffect", "addTail"];
const R3F_GLOBAL_EFFECT_HOOK_NAMES: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const R3F_GLOBAL_EFFECT_DEFERRED_METHOD_NAMES: [&str; 3] = ["catch", "finally", "then"];
const R3F_GLOBAL_EFFECT_MESSAGE: &str = "This global R3F render-loop registration is not paired with its returned disposer. Return or invoke that exact disposer during React cleanup";

#[derive(Debug, Default, Clone)]
pub struct R3FRequireGlobalEffectCleanup;

impl RuleMeta for R3FRequireGlobalEffectCleanup {
    const NAME: &'static str = "r3f-require-global-effect-cleanup";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require cleanup for global R3F render-loop effects.",
    };
}

#[derive(Clone, Copy)]
enum R3fGlobalEffectReturnTarget {
    Registration(oxc_semantic::NodeId),
    Disposer(oxc_semantic::SymbolId),
}

impl Rule for R3FRequireGlobalEffectCleanup {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !program_references_r3f(ctx) {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        let mut reported_registration_ids = rustc_hash::FxHashSet::default();

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };

            if r3f_global_effect_react_hook_matches(call_expression, &analysis, ctx) {
                let Some(callback_expression) = call_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                else {
                    continue;
                };
                let Some(effect_callback_id) = exact_local_function_id(
                    callback_expression,
                    ctx,
                    &mut Vec::new(),
                    &mut resolution_cache,
                ) else {
                    continue;
                };
                let registrations = r3f_global_effect_collect_registrations(
                    effect_callback_id,
                    true,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                );
                for registration_id in registrations {
                    if r3f_global_effect_registration_is_cleaned_up(
                        registration_id,
                        effect_callback_id,
                        &analysis,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                        &mut assigned_expression_cache,
                    ) {
                        continue;
                    }
                    r3f_global_effect_report_registration(
                        registration_id,
                        ctx,
                        &mut reported_registration_ids,
                    );
                }
                continue;
            }

            if r3f_global_effect_module_api_matches(
                &call_expression.callee,
                "useFrame",
                &analysis,
                ctx,
            ) && let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                && let Some(frame_callback_id) = resolve_r3f_analyzed_callback_function_id(
                    callback_expression,
                    &analysis,
                    ctx,
                    &mut resolution_cache,
                )
                && !matches!(
                    ctx.nodes().get_node(frame_callback_id).kind(),
                    AstKind::Function(function) if function.generator
                )
            {
                for registration_id in r3f_global_effect_collect_registrations(
                    frame_callback_id,
                    false,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                ) {
                    r3f_global_effect_report_registration(
                        registration_id,
                        ctx,
                        &mut reported_registration_ids,
                    );
                }
                continue;
            }

            if r3f_global_effect_is_registration(call_expression, &analysis, ctx)
                && find_render_phase_component_or_hook(node, ctx).is_some()
            {
                r3f_global_effect_report_registration(
                    node.id(),
                    ctx,
                    &mut reported_registration_ids,
                );
            }
        }
    }
}

fn r3f_global_effect_report_registration(
    registration_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
    reported_registration_ids: &mut rustc_hash::FxHashSet<oxc_semantic::NodeId>,
) {
    if reported_registration_ids.insert(registration_id) {
        ctx.diagnostic(
            OxcDiagnostic::warn(R3F_GLOBAL_EFFECT_MESSAGE)
                .with_label(ctx.nodes().get_node(registration_id).span()),
        );
    }
}

fn r3f_global_effect_react_hook_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    R3F_GLOBAL_EFFECT_HOOK_NAMES.iter().any(|hook_name| {
        let has_bound_namespace_receiver = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
            .and_then(|member_expression| {
                let oxc_ast::ast::Expression::Identifier(identifier) =
                    member_expression.object().get_inner_expression()
                else {
                    return None;
                };
                ctx.scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
            })
            .is_some();
        (has_bound_namespace_receiver && is_react_api_call(call_expression, hook_name, ctx))
            || module_api_reference_matches(
            &call_expression.callee,
            hook_name,
            &R3F_GLOBAL_EFFECT_REACT_MODULES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            &call_expression.callee,
            hook_name,
            &R3F_GLOBAL_EFFECT_REACT_MODULES,
            analysis,
            ctx,
        )
    })
}

fn r3f_global_effect_module_api_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(
        expression,
        api_name,
        &R3F_GLOBAL_EFFECT_PUBLIC_MODULES,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        expression,
        api_name,
        &R3F_GLOBAL_EFFECT_PUBLIC_MODULES,
        analysis,
        ctx,
    )
}

fn r3f_global_effect_is_registration<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    R3F_GLOBAL_EFFECT_API_NAMES.iter().any(|api_name| {
        r3f_global_effect_module_api_matches(&call_expression.callee, api_name, analysis, ctx)
    })
}

fn r3f_global_effect_collect_registrations<'a>(
    root_callback_id: oxc_semantic::NodeId,
    include_deferred_callbacks: bool,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<oxc_semantic::NodeId> {
    let mut registration_ids = Vec::new();
    let mut seen_registration_ids = rustc_hash::FxHashSet::default();
    let mut visited_callback_ids = rustc_hash::FxHashSet::default();
    let mut pending_callback_ids = vec![root_callback_id];
    while let Some(callback_id) = pending_callback_ids.pop() {
        if !visited_callback_ids.insert(callback_id) {
            continue;
        }
        for_each_analyzed_synchronous_execution_node(
            callback_id,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            |candidate, _, _, execution_resolution_cache| {
                let AstKind::CallExpression(call_expression) = candidate.kind() else {
                    return;
                };
                if r3f_global_effect_is_registration(call_expression, analysis, ctx) {
                    if seen_registration_ids.insert(candidate.id()) {
                        registration_ids.push(candidate.id());
                    }
                }
                if !include_deferred_callbacks
                    || call_expression
                        .callee
                        .as_member_expression()
                        .and_then(oxc_ast::ast::MemberExpression::static_property_name)
                        .is_none_or(|method_name| {
                            !R3F_GLOBAL_EFFECT_DEFERRED_METHOD_NAMES.contains(&method_name)
                        })
                {
                    return;
                }
                for argument in &call_expression.arguments {
                    let Some(callback_expression) = argument.as_expression() else {
                        continue;
                    };
                    if let Some(deferred_callback_id) = exact_local_function_id(
                        callback_expression,
                        ctx,
                        &mut Vec::new(),
                        execution_resolution_cache,
                    ) {
                        pending_callback_ids.push(deferred_callback_id);
                    }
                }
            },
        );
    }
    registration_ids
}

fn r3f_global_effect_registration_is_cleaned_up<'a>(
    registration_id: oxc_semantic::NodeId,
    effect_callback_id: oxc_semantic::NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    if r3f_global_effect_registration_is_directly_returned(registration_id, effect_callback_id, ctx)
        || r3f_global_effect_function_returns_target_on_every_path(
            effect_callback_id,
            R3fGlobalEffectReturnTarget::Registration(registration_id),
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            &mut Vec::new(),
            &mut Vec::new(),
        )
    {
        return true;
    }
    let Some(disposer_symbol_id) = r3f_global_effect_captured_disposer_symbol(registration_id, ctx)
    else {
        return false;
    };
    r3f_global_effect_returns_captured_cleanup(
        registration_id,
        effect_callback_id,
        disposer_symbol_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        assigned_expression_cache,
    )
}

fn r3f_global_effect_registration_is_directly_returned(
    registration_id: oxc_semantic::NodeId,
    effect_callback_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let registration_node = ctx.nodes().get_node(registration_id);
    if local_callback_nearest_function_id(registration_id, ctx) != Some(effect_callback_id) {
        return false;
    }
    let mut current = transparent_expression_root(registration_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if parent.id() == effect_callback_id {
            return matches!(
                parent.kind(),
                AstKind::ArrowFunctionExpression(function)
                    if function.get_expression().is_some_and(|expression| {
                        expression.node_id() == current.id()
                    })
            );
        }
        match parent.kind() {
            AstKind::ReturnStatement(statement)
                if statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.node_id() == current.id()) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(expression)
                if expression.consequent.node_id() == current.id()
                    || expression.alternate.node_id() == current.id() =>
            {
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::LogicalExpression(expression)
                if expression.right.node_id() == current.id() =>
            {
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::SequenceExpression(expression)
                if expression
                    .expressions
                    .last()
                    .is_some_and(|last| last.node_id() == current.id()) =>
            {
                current = transparent_expression_root(parent, ctx);
            }
            _ => return false,
        }
    }
}

fn r3f_global_effect_captured_disposer_symbol(
    registration_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let registration_root = transparent_expression_root(ctx.nodes().get_node(registration_id), ctx);
    let parent = ctx.nodes().parent_node(registration_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == registration_root.span()) =>
        {
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
                && assignment.right.span() == registration_root.span() =>
        {
            let assignment_target = assignment.left.as_simple_assignment_target()?;
            let oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) =
                assignment_target
            else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        }
        _ => None,
    }
}

fn r3f_global_effect_returns_captured_cleanup<'a>(
    registration_id: oxc_semantic::NodeId,
    effect_callback_id: oxc_semantic::NodeId,
    disposer_symbol_id: oxc_semantic::SymbolId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    let target = R3fGlobalEffectReturnTarget::Disposer(disposer_symbol_id);
    let registration_owner_id = local_callback_nearest_function_id(registration_id, ctx);
    if registration_owner_id != Some(effect_callback_id) {
        let Some(registration_owner_id) = registration_owner_id else {
            return false;
        };
        let mut owner_call_ids = Vec::new();
        for &candidate_id in node_index.node_ids(effect_callback_id) {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                continue;
            };
            if exact_local_function_id(
                &call_expression.callee,
                ctx,
                &mut Vec::new(),
                resolution_cache,
            ) == Some(registration_owner_id)
            {
                owner_call_ids.push(candidate_id);
            }
        }
        if owner_call_ids.is_empty() {
            return r3f_global_effect_function_returns_target_on_every_path(
                effect_callback_id,
                target,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                &mut Vec::new(),
                &mut Vec::new(),
            );
        }
        return owner_call_ids.into_iter().all(|owner_call_id| {
            r3f_global_effect_function_returns_target_after_node(
                effect_callback_id,
                owner_call_id,
                target,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
            )
        });
    }
    r3f_global_effect_function_returns_target_after_node(
        effect_callback_id,
        registration_id,
        target,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        assigned_expression_cache,
    )
}

fn r3f_global_effect_function_returns_target_after_node<'a>(
    function_id: oxc_semantic::NodeId,
    anchor_id: oxc_semantic::NodeId,
    target: R3fGlobalEffectReturnTarget,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    let matching_return_nodes = r3f_global_effect_matching_return_nodes(
        function_id,
        target,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        assigned_expression_cache,
    );
    do_nodes_cover_every_path_after_node(
        ctx.nodes().get_node(anchor_id),
        &matching_return_nodes,
        ctx.nodes().get_node(function_id),
        ctx,
    )
}

fn r3f_global_effect_matching_return_nodes<'a, 'b>(
    function_id: oxc_semantic::NodeId,
    target: R3fGlobalEffectReturnTarget,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &'b LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> Vec<&'b crate::AstNode<'a>> {
    let mut matching_nodes = Vec::new();
    for &candidate_id in node_index.node_ids(function_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        let Some(argument) = statement.argument.as_ref() else {
            continue;
        };
        if r3f_global_effect_return_expression_matches_target(
            argument,
            function_id,
            target,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            &mut Vec::new(),
            &mut Vec::new(),
        ) {
            matching_nodes.push(ctx.nodes().get_node(argument.node_id()));
        }
    }
    matching_nodes
}

fn r3f_global_effect_function_returns_target_on_every_path<'a>(
    function_id: oxc_semantic::NodeId,
    target: R3fGlobalEffectReturnTarget,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<oxc_semantic::NodeId>,
    visited_function_ids: &mut Vec<oxc_semantic::NodeId>,
) -> bool {
    if visited_function_ids.contains(&function_id) {
        return false;
    }
    visited_function_ids.push(function_id);
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        let matches = r3f_global_effect_return_expression_matches_target(
            expression,
            function_id,
            target,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            visited_expression_ids,
            visited_function_ids,
        );
        visited_function_ids.pop();
        return matches;
    }
    let body_statements = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function
            .body
            .as_ref()
            .map(|body| body.statements.as_slice()),
        AstKind::ArrowFunctionExpression(function) => function
            .body
            .as_function_body()
            .map(|body| body.statements.as_slice()),
        _ => None,
    };
    let Some(body_statements) = body_statements else {
        visited_function_ids.pop();
        return false;
    };
    let mut returned_expressions = Vec::new();
    let mut has_bare_return = false;
    for &candidate_id in node_index.node_ids(function_id) {
        let AstKind::ReturnStatement(statement) = ctx.nodes().get_node(candidate_id).kind() else {
            continue;
        };
        if let Some(argument) = statement.argument.as_ref() {
            returned_expressions.push(argument);
        } else {
            has_bare_return = true;
        }
    }
    let matches = !has_bare_return
        && body_statements.iter().any(statement_always_exits)
        && !returned_expressions.is_empty()
        && returned_expressions.into_iter().all(|expression| {
            r3f_global_effect_return_expression_matches_target(
                expression,
                function_id,
                target,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        });
    visited_function_ids.pop();
    matches
}

#[allow(clippy::too_many_arguments)]
fn r3f_global_effect_return_expression_matches_target<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    function_id: oxc_semantic::NodeId,
    target: R3fGlobalEffectReturnTarget,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<oxc_semantic::NodeId>,
    visited_function_ids: &mut Vec<oxc_semantic::NodeId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match target {
        R3fGlobalEffectReturnTarget::Registration(registration_id)
            if expression.node_id() == registration_id =>
        {
            return true;
        }
        R3fGlobalEffectReturnTarget::Disposer(disposer_symbol_id) => {
            if let oxc_ast::ast::Expression::Identifier(identifier) = expression
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    == Some(disposer_symbol_id)
            {
                return true;
            }
            if let Some(cleanup_function_id) =
                exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
                && r3f_global_effect_function_invokes_symbol(
                    cleanup_function_id,
                    disposer_symbol_id,
                    analysis,
                    node_index,
                    ctx,
                    resolution_cache,
                )
            {
                return true;
            }
        }
        R3fGlobalEffectReturnTarget::Registration(_) => {}
    }

    let expression_id = expression.node_id();
    if visited_expression_ids.contains(&expression_id) {
        return false;
    }
    visited_expression_ids.push(expression_id);
    let matches = match expression {
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                visited_expression_ids.pop();
                return false;
            };
            let assigned_expressions = r3f_global_effect_possible_assigned_expressions(
                identifier,
                symbol_id,
                ctx,
                assigned_expression_cache,
            );
            !assigned_expressions.is_empty()
                && assigned_expressions.into_iter().all(|assigned_expression| {
                    !matches!(
                        assigned_expression.get_inner_expression(),
                        oxc_ast::ast::Expression::ArrowFunctionExpression(_)
                            | oxc_ast::ast::Expression::FunctionExpression(_)
                    ) && r3f_global_effect_return_expression_matches_target(
                        assigned_expression,
                        function_id,
                        target,
                        analysis,
                        node_index,
                        ctx,
                        resolution_cache,
                        assigned_expression_cache,
                        visited_expression_ids,
                        visited_function_ids,
                    )
                })
        }
        oxc_ast::ast::Expression::CallExpression(call_expression)
            if call_expression.arguments.is_empty()
                && matches!(
                    &call_expression.callee,
                    oxc_ast::ast::Expression::Identifier(_)
                ) =>
        {
            exact_local_function_id(
                &call_expression.callee,
                ctx,
                &mut Vec::new(),
                resolution_cache,
            )
            .filter(|called_function_id| {
                r3f_global_effect_is_zero_argument_sync_function(*called_function_id, ctx)
            })
            .is_some_and(|called_function_id| {
                r3f_global_effect_function_returns_target_on_every_path(
                    called_function_id,
                    target,
                    analysis,
                    node_index,
                    ctx,
                    resolution_cache,
                    assigned_expression_cache,
                    visited_expression_ids,
                    visited_function_ids,
                )
            })
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional) => {
            r3f_global_effect_return_expression_matches_target(
                &conditional.consequent,
                function_id,
                target,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) && r3f_global_effect_return_expression_matches_target(
                &conditional.alternate,
                function_id,
                target,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        }
        oxc_ast::ast::Expression::LogicalExpression(logical) => {
            r3f_global_effect_return_expression_matches_target(
                &logical.left,
                function_id,
                target,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) && r3f_global_effect_return_expression_matches_target(
                &logical.right,
                function_id,
                target,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        }
        _ => false,
    };
    visited_expression_ids.pop();
    matches
}

fn r3f_global_effect_possible_assigned_expressions<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> Vec<&'a oxc_ast::ast::Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Vec::new();
    };
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return Vec::new();
    };
    if variable_declaration.kind.is_const() {
        return binding_pattern_initializer_for_symbol(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .into_iter()
        .collect();
    }
    r3f_analyzed_possible_assigned_expressions(
        identifier,
        symbol_id,
        ctx,
        assigned_expression_cache,
    )
}

fn r3f_global_effect_is_zero_argument_sync_function(
    function_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => {
            !function.r#async && !function.generator && function.params.items.is_empty()
        }
        AstKind::ArrowFunctionExpression(function) => {
            !function.r#async && function.params.items.is_empty()
        }
        _ => false,
    }
}

fn r3f_global_effect_function_invokes_symbol<'a>(
    function_id: oxc_semantic::NodeId,
    target_symbol_id: oxc_semantic::SymbolId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let invoked_symbol_ids = r3f_global_effect_invoked_symbol_ids(
        function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    invoked_symbol_ids.into_iter().any(|invoked_symbol_id| {
        r3f_global_effect_invocation_reaches_symbol(
            invoked_symbol_id,
            target_symbol_id,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            &mut Vec::new(),
        )
    })
}

fn r3f_global_effect_invoked_symbol_ids<'a>(
    function_id: oxc_semantic::NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<oxc_semantic::SymbolId> {
    let mut symbol_ids = Vec::new();
    for_each_analyzed_synchronous_execution_node(
        function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            let oxc_ast::ast::Expression::Identifier(identifier) =
                call_expression.callee.get_inner_expression()
            else {
                return;
            };
            if let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                && !symbol_ids.contains(&symbol_id)
            {
                symbol_ids.push(symbol_id);
            }
        },
    );
    symbol_ids
}

#[allow(clippy::too_many_arguments)]
fn r3f_global_effect_invocation_reaches_symbol<'a>(
    invoked_symbol_id: oxc_semantic::SymbolId,
    target_symbol_id: oxc_semantic::SymbolId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if invoked_symbol_id == target_symbol_id {
        return true;
    }
    if visited_symbol_ids.contains(&invoked_symbol_id) {
        return false;
    }
    visited_symbol_ids.push(invoked_symbol_id);
    let mut assigned_function_ids = Vec::new();
    for reference in ctx.scoping().get_resolved_references(invoked_symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let identifier_node = ctx.nodes().get_node(reference.node_id());
        let identifier_root = transparent_expression_root(identifier_node, ctx);
        let assignment_node = ctx.nodes().parent_node(identifier_root.id());
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            visited_symbol_ids.pop();
            return false;
        };
        if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
            || assignment.left.span() != identifier_root.span()
        {
            visited_symbol_ids.pop();
            return false;
        }
        let Some(assigned_function_id) =
            exact_local_function_id(&assignment.right, ctx, &mut Vec::new(), resolution_cache)
        else {
            visited_symbol_ids.pop();
            return false;
        };
        assigned_function_ids.push(assigned_function_id);
    }
    let reaches_target = !assigned_function_ids.is_empty()
        && assigned_function_ids
            .into_iter()
            .all(|assigned_function_id| {
                r3f_global_effect_invoked_symbol_ids(
                    assigned_function_id,
                    analysis,
                    node_index,
                    ctx,
                    resolution_cache,
                )
                .into_iter()
                .any(|nested_symbol_id| {
                    r3f_global_effect_invocation_reaches_symbol(
                        nested_symbol_id,
                        target_symbol_id,
                        analysis,
                        node_index,
                        ctx,
                        resolution_cache,
                        &mut visited_symbol_ids.clone(),
                    )
                })
            });
    visited_symbol_ids.pop();
    reaches_target
}
