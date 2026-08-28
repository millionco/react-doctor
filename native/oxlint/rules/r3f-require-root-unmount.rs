use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};

const R3F_ROOT_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const R3F_ROOT_REACT_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const R3F_ROOT_EFFECT_HOOK_NAMES: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const R3F_ROOT_UNMOUNT_MESSAGE: &str = "This component-owned R3F root is never unmounted. Return cleanup that calls root.unmount() so the reconciler, events, and renderer are released";

#[derive(Debug, Default, Clone)]
pub struct R3FRequireRootUnmount;

impl RuleMeta for R3FRequireRootUnmount {
    const NAME: &'static str = "r3f-require-root-unmount";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "R3F root without unmount cleanup",
    };
}

struct R3fRootEffectEntry {
    callback_id: NodeId,
    call_id: NodeId,
    owner_id: NodeId,
    has_unconditional_registration: bool,
}

type R3fRootEarliestAbruptCompletionByFunction = rustc_hash::FxHashMap<NodeId, Option<u32>>;

impl Rule for R3FRequireRootUnmount {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut earliest_abrupt_completion_by_function =
            R3fRootEarliestAbruptCompletionByFunction::default();
        let effect_entries = r3f_root_effect_entries(
            &analysis,
            ctx,
            &mut resolution_cache,
            &mut earliest_abrupt_completion_by_function,
        );

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !r3f_root_module_api_matches(&call_expression.callee, "createRoot", &analysis, ctx) {
                continue;
            }
            if r3f_root_is_eager_hook_allocation(node, &analysis, ctx) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(R3F_ROOT_UNMOUNT_MESSAGE).with_label(call_expression.span),
                );
                continue;
            }
            if let Some(lifecycle) =
                r3f_analyze_owned_root_lifecycle(node, &analysis, &node_index, ctx)
            {
                let has_unstable_identity =
                    r3f_owned_root_lifecycle_has_identity_write(&lifecycle, node, ctx);
                if has_unstable_identity
                    || (!r3f_owned_root_lifecycle_has_unknown_transfer(
                        &lifecycle,
                        &effect_entries,
                        ctx,
                    ) && !r3f_owned_root_lifecycle_has_cleanup(
                        &lifecycle,
                        &effect_entries,
                        &analysis,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                        &mut earliest_abrupt_completion_by_function,
                    ))
                {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(R3F_ROOT_UNMOUNT_MESSAGE)
                            .with_label(call_expression.span),
                    );
                }
                continue;
            }
            let Some(root_symbol_id) = r3f_root_direct_binding_symbol_id(node, ctx) else {
                continue;
            };
            let Some(allocation_function_id) = local_callback_nearest_function_id(node.id(), ctx)
            else {
                continue;
            };
            if is_node_conditionally_executed(node, allocation_function_id, ctx) {
                continue;
            }

            let allocation_effect = effect_entries
                .iter()
                .find(|entry| entry.callback_id == allocation_function_id);
            let owner_id = if let Some(entry) = allocation_effect {
                entry.owner_id
            } else {
                let Some(owner) = find_render_phase_component_or_hook(node, ctx) else {
                    continue;
                };
                if crate::ast_util::get_enclosing_function(
                    ctx.symbol_declaration(root_symbol_id),
                    ctx,
                )
                .map(crate::AstNode::id)
                    != Some(owner.id())
                {
                    continue;
                }
                owner.id()
            };

            let root_symbol_ids = r3f_root_collect_alias_symbol_ids(root_symbol_id, ctx);
            if r3f_root_has_unknown_ownership_transfer(
                &root_symbol_ids,
                owner_id,
                &effect_entries,
                ctx,
            ) {
                continue;
            }
            if !r3f_root_has_identity_write(&root_symbol_ids, ctx)
                && r3f_root_has_proven_cleanup(
                    node,
                    allocation_effect,
                    owner_id,
                    &root_symbol_ids,
                    &effect_entries,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    &mut earliest_abrupt_completion_by_function,
                )
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(R3F_ROOT_UNMOUNT_MESSAGE).with_label(call_expression.span),
            );
        }
    }
}

fn r3f_root_has_identity_write(
    symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    symbol_ids.iter().copied().any(|symbol_id| {
        ctx.scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    })
}

fn r3f_owned_root_lifecycle_has_identity_write<'a>(
    lifecycle: &R3fOwnedRootLifecycle,
    allocation: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for &symbol_id in &lifecycle.resource_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if r3f_owned_root_access_has_non_allocation_identity_write(
                reference_node,
                allocation,
                ctx,
            ) {
                return true;
            }
        }
    }
    if matches!(lifecycle.access_path, R3fOwnedRootAccessPath::Direct) {
        return false;
    }
    for &symbol_id in &lifecycle.owner_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let member_node = ctx.nodes().parent_node(reference_root.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                continue;
            };
            if member.object().span() == reference_root.span()
                && r3f_owned_root_member_node_matches_path(member_node, &lifecycle.access_path)
                && r3f_owned_root_access_has_non_allocation_identity_write(
                    member_node,
                    allocation,
                    ctx,
                )
            {
                return true;
            }
        }
    }
    false
}

fn r3f_owned_root_access_has_non_allocation_identity_write<'a>(
    resource_access: &crate::AstNode<'a>,
    allocation: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let allocation_root = transparent_expression_root(allocation, ctx);
    let mut current = transparent_expression_root(resource_access, ctx);
    for parent in ctx.nodes().ancestors(current.id()) {
        match parent.kind() {
            AstKind::AssignmentExpression(assignment) => {
                if !assignment.left.span().contains_inclusive(current.span()) {
                    return false;
                }
                return assignment.right.get_inner_expression().span() != allocation_root.span();
            }
            AstKind::UpdateExpression(update) => {
                return update.argument.span().contains_inclusive(current.span());
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ if parent.kind().as_member_expression_kind().is_some() => return false,
            _ => current = parent,
        }
    }
    false
}

fn r3f_owned_root_lifecycle_has_unknown_transfer(
    lifecycle: &R3fOwnedRootLifecycle,
    effect_entries: &[R3fRootEffectEntry],
    ctx: &LintContext<'_>,
) -> bool {
    if r3f_root_has_unknown_ownership_transfer(
        &lifecycle.resource_symbol_ids,
        lifecycle.owner_id,
        effect_entries,
        ctx,
    ) {
        return true;
    }
    if matches!(lifecycle.access_path, R3fOwnedRootAccessPath::Direct) {
        return false;
    }
    for &symbol_id in &lifecycle.owner_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if let Some(member) = parent.kind().as_member_expression_kind()
                && member.object().span() == reference_root.span()
            {
                if member.static_property_name().is_some() {
                    continue;
                }
                return true;
            }
            if r3f_root_is_effect_dependency(reference_root, effect_entries, ctx) {
                continue;
            }
            if r3f_root_is_returned_from_owner(reference_root, lifecycle.owner_id, ctx)
                || r3f_root_is_direct_call_argument(reference_root, ctx)
            {
                return true;
            }
        }
    }
    false
}

#[allow(clippy::too_many_arguments)]
fn r3f_owned_root_lifecycle_has_cleanup<'a>(
    lifecycle: &R3fOwnedRootLifecycle,
    effect_entries: &[R3fRootEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    earliest_abrupt_completion_by_function: &mut R3fRootEarliestAbruptCompletionByFunction,
) -> bool {
    let mut has_unknown_cleanup = false;
    for effect in effect_entries {
        if effect.owner_id != lifecycle.owner_id || !effect.has_unconditional_registration {
            continue;
        }
        let matching_returns = r3f_owned_root_matching_cleanup_returns(
            effect.callback_id,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            earliest_abrupt_completion_by_function,
        );
        if !r3f_root_function_returns_cleanup_on_every_path(
            effect.callback_id,
            &matching_returns,
            node_index,
            ctx,
        ) {
            continue;
        }
        let dependency_status = if lifecycle.is_stable {
            R3fRootDependencyStatus::Valid
        } else {
            r3f_owned_root_lifecycle_dependency_status(effect, lifecycle, ctx)
        };
        match dependency_status {
            R3fRootDependencyStatus::Valid => return true,
            R3fRootDependencyStatus::Unknown => has_unknown_cleanup = true,
            R3fRootDependencyStatus::Invalid => {}
        }
    }
    has_unknown_cleanup
}

fn r3f_owned_root_lifecycle_dependency_status(
    effect: &R3fRootEffectEntry,
    lifecycle: &R3fOwnedRootLifecycle,
    ctx: &LintContext<'_>,
) -> R3fRootDependencyStatus {
    let AstKind::CallExpression(call) = ctx.nodes().get_node(effect.call_id).kind() else {
        return R3fRootDependencyStatus::Invalid;
    };
    let Some(argument) = call.arguments.get(1) else {
        return R3fRootDependencyStatus::Valid;
    };
    let Some(expression) = argument.as_expression() else {
        return R3fRootDependencyStatus::Unknown;
    };
    let oxc_ast::ast::Expression::ArrayExpression(array) = expression.get_inner_expression() else {
        return R3fRootDependencyStatus::Unknown;
    };
    array
        .elements
        .iter()
        .filter_map(oxc_ast::ast::ArrayExpressionElement::as_expression)
        .any(|expression| {
            r3f_owned_root_expression_matches_resource(expression, lifecycle, ctx)
                || matches!(expression.get_inner_expression(), oxc_ast::ast::Expression::Identifier(identifier)
                    if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(|symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id)))
        })
        .then_some(R3fRootDependencyStatus::Valid)
        .unwrap_or(R3fRootDependencyStatus::Invalid)
}

fn r3f_owned_root_matching_cleanup_returns<'a, 'b>(
    callback_id: NodeId,
    lifecycle: &R3fOwnedRootLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &'b LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    earliest_abrupt_completion_by_function: &mut R3fRootEarliestAbruptCompletionByFunction,
) -> Vec<&'b crate::AstNode<'a>> {
    let mut matching = Vec::new();
    for &candidate_id in node_index.node_ids(callback_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        let Some(expression) = statement.argument.as_ref() else {
            continue;
        };
        if r3f_owned_root_cleanup_expression_matches(
            expression,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            earliest_abrupt_completion_by_function,
        ) {
            matching.push(ctx.nodes().get_node(expression.node_id()));
        }
    }
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = function.get_expression()
        && r3f_owned_root_cleanup_expression_matches(
            expression,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            earliest_abrupt_completion_by_function,
        )
    {
        matching.push(ctx.nodes().get_node(expression.node_id()));
    }
    matching
}

fn r3f_owned_root_cleanup_expression_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    lifecycle: &R3fOwnedRootLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    earliest_abrupt_completion_by_function: &mut R3fRootEarliestAbruptCompletionByFunction,
) -> bool {
    let Some(function_id) =
        exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
    else {
        return false;
    };
    let mut matched = false;
    for_each_analyzed_synchronous_execution_node(
        function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, conditional, _| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return;
            };
            if !matched
                && !conditional
                && member.static_property_name() == Some("unmount")
                && r3f_owned_root_expression_matches_resource(member.object(), lifecycle, ctx)
                && r3f_root_execution_is_guaranteed(
                    candidate,
                    local_callback_nearest_function_id(candidate.id(), ctx).unwrap_or(function_id),
                    ctx,
                    earliest_abrupt_completion_by_function,
                )
            {
                matched = true;
            }
        },
    );
    matched
}

fn r3f_owned_root_expression_matches_resource(
    expression: &oxc_ast::ast::Expression<'_>,
    lifecycle: &R3fOwnedRootLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| lifecycle.resource_symbol_ids.contains(&symbol_id));
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    let oxc_ast::ast::Expression::Identifier(owner) = member.object().get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(owner.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id))
        && r3f_owned_root_member_matches_path(member, &lifecycle.access_path)
}

fn r3f_root_module_api_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(
        expression,
        api_name,
        &R3F_ROOT_PUBLIC_MODULES,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        expression,
        api_name,
        &R3F_ROOT_PUBLIC_MODULES,
        analysis,
        ctx,
    )
}

fn r3f_root_effect_entries(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'_>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    earliest_abrupt_completion_by_function: &mut R3fRootEarliestAbruptCompletionByFunction,
) -> Vec<R3fRootEffectEntry> {
    let mut entries = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !R3F_ROOT_EFFECT_HOOK_NAMES.iter().any(|hook_name| {
            r3f_owned_root_react_api_matches(call_expression, hook_name, analysis, ctx)
        }) {
            continue;
        }
        let Some(callback_expression) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            continue;
        };
        let Some(callback_id) =
            exact_local_function_id(callback_expression, ctx, &mut Vec::new(), resolution_cache)
        else {
            continue;
        };
        let Some(owner) = find_render_phase_component_or_hook(node, ctx) else {
            continue;
        };
        entries.push(R3fRootEffectEntry {
            callback_id,
            call_id: node.id(),
            owner_id: owner.id(),
            has_unconditional_registration: r3f_root_execution_is_guaranteed(
                node,
                owner.id(),
                ctx,
                earliest_abrupt_completion_by_function,
            ),
        });
    }
    entries
}

fn r3f_root_execution_is_guaranteed(
    node: &crate::AstNode<'_>,
    boundary_id: NodeId,
    ctx: &LintContext<'_>,
    earliest_abrupt_completion_by_function: &mut R3fRootEarliestAbruptCompletionByFunction,
) -> bool {
    if is_node_conditionally_executed(node, boundary_id, ctx) {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == boundary_id {
            break;
        }
        if matches!(
            ancestor.kind(),
            AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::TryStatement(_)
        ) {
            return false;
        }
    }
    let earliest_abrupt_completion = *earliest_abrupt_completion_by_function
        .entry(boundary_id)
        .or_insert_with(|| {
            ctx.nodes()
                .iter()
                .filter(|candidate| {
                    local_callback_nearest_function_id(candidate.id(), ctx) == Some(boundary_id)
                        && matches!(
                            candidate.kind(),
                            AstKind::ReturnStatement(_) | AstKind::ThrowStatement(_)
                        )
                })
                .map(|candidate| candidate.span().start)
                .min()
        });
    earliest_abrupt_completion.is_none_or(|offset| offset >= node.span().start)
}

fn r3f_root_direct_binding_symbol_id<'a>(
    allocation: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let allocation_root = transparent_expression_root(allocation, ctx);
    let parent = ctx.nodes().parent_node(allocation_root.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != allocation_root.span())
    {
        return None;
    }
    declarator
        .id
        .get_binding_identifier()
        .map(|binding| binding.symbol_id())
}

fn r3f_root_is_eager_hook_allocation<'a>(
    allocation: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = transparent_expression_root(allocation, ctx);
    for parent in ctx.nodes().ancestors(current.id()) {
        if matches!(
            parent.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        if let AstKind::CallExpression(call_expression) = parent.kind()
            && call_expression
                .arguments
                .first()
                .is_some_and(|argument| argument.span() == current.span())
            && ["useRef", "useState"].iter().any(|hook_name| {
                r3f_owned_root_react_api_matches(call_expression, hook_name, analysis, ctx)
            })
        {
            return find_render_phase_component_or_hook(parent, ctx).is_some();
        }
        current = parent;
    }
    false
}

fn r3f_root_collect_alias_symbol_ids(
    source_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashSet<SymbolId> {
    let mut symbol_ids = rustc_hash::FxHashSet::from_iter([source_symbol_id]);
    let mut pending_symbol_ids = vec![source_symbol_id];
    while let Some(symbol_id) = pending_symbol_ids.pop() {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != reference_root.span())
            {
                continue;
            }
            let Some(alias_binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            let alias_symbol_id = alias_binding.symbol_id();
            if !matches!(
                ctx.nodes().parent_node(parent.id()).kind(),
                AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
            ) || ctx
                .scoping()
                .get_resolved_references(alias_symbol_id)
                .any(oxc_semantic::Reference::is_write)
            {
                continue;
            }
            if symbol_ids.insert(alias_symbol_id) {
                pending_symbol_ids.push(alias_symbol_id);
            }
        }
    }
    symbol_ids
}

fn r3f_root_has_unknown_ownership_transfer(
    symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    owner_id: NodeId,
    effect_entries: &[R3fRootEffectEntry],
    ctx: &LintContext<'_>,
) -> bool {
    for &symbol_id in symbol_ids {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| initializer.span() == reference_root.span()))
            {
                continue;
            }
            if parent
                .kind()
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span() == reference_root.span())
            {
                continue;
            }
            if r3f_root_is_effect_dependency(reference_root, effect_entries, ctx) {
                continue;
            }
            if r3f_root_is_returned_from_owner(reference_root, owner_id, ctx)
                || r3f_root_is_direct_call_argument(reference_root, ctx)
            {
                return true;
            }
            let mut current = reference_root;
            loop {
                let current_parent = ctx.nodes().parent_node(current.id());
                if matches!(
                    current_parent.kind(),
                    AstKind::AssignmentExpression(assignment)
                        if assignment.right.span() == current.span()
                ) || matches!(current_parent.kind(), AstKind::ObjectProperty(property)
                    if property.value.span() == current.span())
                    || matches!(current_parent.kind(), AstKind::ArrayExpression(_))
                    || matches!(current_parent.kind(), AstKind::JSXExpressionContainer(_))
                {
                    return true;
                }
                if matches!(
                    current_parent.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    break;
                }
                current = current_parent;
            }
        }
    }
    false
}

fn r3f_root_is_returned_from_owner(
    reference: &crate::AstNode<'_>,
    owner_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if local_callback_nearest_function_id(reference.id(), ctx) != Some(owner_id) {
        return false;
    }
    ctx.nodes()
        .ancestors(reference.id())
        .take_while(|ancestor| ancestor.id() != owner_id)
        .any(|ancestor| matches!(ancestor.kind(), AstKind::ReturnStatement(_)))
}

fn r3f_root_is_direct_call_argument(reference: &crate::AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current = reference;
    for parent in ctx.nodes().ancestors(reference.id()) {
        if matches!(
            parent.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        if let AstKind::CallExpression(call_expression) = parent.kind() {
            return call_expression
                .arguments
                .iter()
                .any(|argument| argument.span() == current.span());
        }
        current = parent;
    }
    false
}

fn r3f_root_is_effect_dependency(
    reference: &crate::AstNode<'_>,
    effect_entries: &[R3fRootEffectEntry],
    ctx: &LintContext<'_>,
) -> bool {
    effect_entries.iter().any(|entry| {
        let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(entry.call_id).kind()
        else {
            return false;
        };
        call_expression
            .arguments
            .get(1)
            .is_some_and(|dependency| dependency.span().contains_inclusive(reference.span()))
    })
}

#[allow(clippy::too_many_arguments)]
fn r3f_root_has_proven_cleanup<'a>(
    allocation: &crate::AstNode<'a>,
    allocation_effect: Option<&R3fRootEffectEntry>,
    owner_id: NodeId,
    root_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    effect_entries: &[R3fRootEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    earliest_abrupt_completion_by_function: &mut R3fRootEarliestAbruptCompletionByFunction,
) -> bool {
    let mut has_unknown_cleanup = false;
    for effect in effect_entries {
        if effect.owner_id != owner_id || !effect.has_unconditional_registration {
            continue;
        }
        let matching_returns = r3f_root_matching_cleanup_returns(
            effect.callback_id,
            root_symbol_ids,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            earliest_abrupt_completion_by_function,
        );
        let cleanup_matches = if allocation_effect
            .is_some_and(|allocation_entry| allocation_entry.callback_id == effect.callback_id)
        {
            do_nodes_cover_every_path_after_node(
                allocation,
                &matching_returns,
                ctx.nodes().get_node(effect.callback_id),
                ctx,
            )
        } else {
            r3f_root_function_returns_cleanup_on_every_path(
                effect.callback_id,
                &matching_returns,
                node_index,
                ctx,
            )
        };
        if !cleanup_matches {
            continue;
        }
        match r3f_root_effect_dependency_status(effect, root_symbol_ids, allocation_effect, ctx) {
            R3fRootDependencyStatus::Valid => return true,
            R3fRootDependencyStatus::Unknown => has_unknown_cleanup = true,
            R3fRootDependencyStatus::Invalid => {}
        }
    }
    has_unknown_cleanup
}

enum R3fRootDependencyStatus {
    Valid,
    Invalid,
    Unknown,
}

fn r3f_root_effect_dependency_status(
    effect: &R3fRootEffectEntry,
    root_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    allocation_effect: Option<&R3fRootEffectEntry>,
    ctx: &LintContext<'_>,
) -> R3fRootDependencyStatus {
    if allocation_effect.is_some() {
        return R3fRootDependencyStatus::Valid;
    }
    let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(effect.call_id).kind()
    else {
        return R3fRootDependencyStatus::Invalid;
    };
    let Some(dependency_argument) = call_expression.arguments.get(1) else {
        return R3fRootDependencyStatus::Valid;
    };
    let Some(dependency_expression) = dependency_argument.as_expression() else {
        return R3fRootDependencyStatus::Unknown;
    };
    let oxc_ast::ast::Expression::ArrayExpression(dependencies) =
        dependency_expression.get_inner_expression()
    else {
        return R3fRootDependencyStatus::Unknown;
    };
    if dependencies.elements.iter().any(|element| {
        element.as_expression().is_some_and(|expression| {
            matches!(expression.get_inner_expression(), oxc_ast::ast::Expression::Identifier(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(|symbol_id| root_symbol_ids.contains(&symbol_id)))
        })
    }) {
        R3fRootDependencyStatus::Valid
    } else {
        R3fRootDependencyStatus::Invalid
    }
}

fn r3f_root_matching_cleanup_returns<'a, 'b>(
    callback_id: NodeId,
    root_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &'b LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    earliest_abrupt_completion_by_function: &mut R3fRootEarliestAbruptCompletionByFunction,
) -> Vec<&'b crate::AstNode<'a>> {
    let mut matching_returns = Vec::new();
    for &candidate_id in node_index.node_ids(callback_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        let Some(returned_expression) = return_statement.argument.as_ref() else {
            continue;
        };
        if r3f_root_cleanup_expression_matches(
            returned_expression,
            root_symbol_ids,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            earliest_abrupt_completion_by_function,
        ) {
            matching_returns.push(candidate);
        }
    }
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = function.get_expression()
        && r3f_root_cleanup_expression_matches(
            expression,
            root_symbol_ids,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            earliest_abrupt_completion_by_function,
        )
    {
        matching_returns.push(ctx.nodes().get_node(expression.node_id()));
    }
    matching_returns
}

fn r3f_root_cleanup_expression_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    root_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    earliest_abrupt_completion_by_function: &mut R3fRootEarliestAbruptCompletionByFunction,
) -> bool {
    let Some(cleanup_function_id) =
        exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
    else {
        return false;
    };
    let mut did_invoke_unmount = false;
    for_each_analyzed_synchronous_execution_node(
        cleanup_function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, is_conditional, _| {
            if did_invoke_unmount
                || is_conditional
                || !r3f_root_execution_is_guaranteed(
                    candidate,
                    local_callback_nearest_function_id(candidate.id(), ctx)
                        .unwrap_or(cleanup_function_id),
                    ctx,
                    earliest_abrupt_completion_by_function,
                )
            {
                return;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            let Some(member_expression) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return;
            };
            if member_expression.static_property_name() != Some("unmount") {
                return;
            }
            let oxc_ast::ast::Expression::Identifier(identifier) =
                member_expression.object().get_inner_expression()
            else {
                return;
            };
            did_invoke_unmount = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| root_symbol_ids.contains(&symbol_id));
        },
    );
    did_invoke_unmount
}

fn r3f_root_function_returns_cleanup_on_every_path(
    callback_id: NodeId,
    matching_returns: &[&crate::AstNode<'_>],
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    if matches!(
        ctx.nodes().get_node(callback_id).kind(),
        AstKind::ArrowFunctionExpression(function) if function.get_expression().is_some()
    ) {
        return !matching_returns.is_empty();
    }
    let body_statements = match ctx.nodes().get_node(callback_id).kind() {
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
        return false;
    };
    let return_count = node_index
        .node_ids(callback_id)
        .iter()
        .filter(|&&node_id| {
            matches!(
                ctx.nodes().get_node(node_id).kind(),
                AstKind::ReturnStatement(_)
            )
        })
        .count();
    !matching_returns.is_empty()
        && matching_returns.len() == return_count
        && body_statements.iter().any(statement_always_exits)
}
