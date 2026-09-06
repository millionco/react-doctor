use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_ROOT_REACT_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const THREE_GPU_COMPUTATION_EFFECT_HOOK_NAMES: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const THREE_GPU_COMPUTATION_MODULES: [&str; 3] = [
    "three-stdlib",
    "three/addons/misc/GPUComputationRenderer.js",
    "three/examples/jsm/misc/GPUComputationRenderer.js",
];
const THREE_GPU_COMPUTATION_BORROWING_METHOD_NAMES: [&str; 0] = [];
const MESSAGE: &str = "This component-owned GPUComputationRenderer has no provable dispose cleanup, so its ping-pong targets, textures, and materials can survive dependency changes or unmount";

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireGpuComputationCleanup;

impl RuleMeta for ThreeRequireGpuComputationCleanup {
    const NAME: &'static str = "three-require-gpu-computation-cleanup";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require cleanup for component-owned GPU computation renderers.",
    };
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ThreeGpuComputationCreationKind {
    Effect,
    Reactive,
    Render,
    Stable,
}

struct ThreeGpuComputationLifecycle {
    access_path: R3fOwnedRootAccessPath,
    creation_kind: ThreeGpuComputationCreationKind,
    owner_id: NodeId,
    owner_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
    resource_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
}

struct ThreeGpuComputationEffectEntry {
    callback_id: NodeId,
    call_id: NodeId,
    owner_id: Option<NodeId>,
    has_unconditional_registration: bool,
}

enum ThreeGpuComputationDependencyStatus {
    Valid,
    Invalid,
    Unknown,
}

impl Rule for ThreeRequireGpuComputationCleanup {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut allocations = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(allocation) = node.kind() else {
                    return None;
                };
                let constructor_name = three_gpu_computation_candidate_api_name(
                    &allocation.callee,
                    ctx,
                    &mut Vec::new(),
                )?;
                (constructor_name == "GPUComputationRenderer").then_some(node.id())
            })
            .collect::<Vec<_>>();
        if allocations.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        allocations.retain(|node_id| {
            let AstKind::NewExpression(allocation) = ctx.nodes().get_node(*node_id).kind() else {
                return false;
            };
            module_api_reference_matches(
                &allocation.callee,
                "GPUComputationRenderer",
                &THREE_GPU_COMPUTATION_MODULES,
                &analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &allocation.callee,
                "GPUComputationRenderer",
                &THREE_GPU_COMPUTATION_MODULES,
                &analysis,
                ctx,
            )
        });
        if allocations.is_empty() {
            return;
        }

        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        let effect_entries = three_gpu_computation_effect_entries(
            &analysis,
            &node_index,
            ctx,
            &mut resolution_cache,
        );
        for allocation_id in allocations {
            let allocation = ctx.nodes().get_node(allocation_id);
            if three_gpu_computation_is_eager_hook_allocation(allocation, &analysis, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
                continue;
            }
            let lifecycle =
                r3f_analyze_owned_root_lifecycle(allocation, &analysis, &node_index, ctx)
                    .map(|lifecycle| ThreeGpuComputationLifecycle {
                        access_path: lifecycle.access_path,
                        creation_kind: if lifecycle.is_stable {
                            ThreeGpuComputationCreationKind::Stable
                        } else {
                            ThreeGpuComputationCreationKind::Reactive
                        },
                        owner_id: lifecycle.owner_id,
                        owner_symbol_ids: lifecycle.owner_symbol_ids,
                        resource_symbol_ids: lifecycle.resource_symbol_ids,
                    })
                    .or_else(|| {
                        three_gpu_computation_direct_lifecycle(allocation, &effect_entries, ctx)
                    });
            let Some(lifecycle) = lifecycle else {
                continue;
            };
            if three_gpu_computation_has_unstable_identity(&lifecycle, allocation, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
                continue;
            }
            if three_gpu_computation_has_unknown_transfer(&lifecycle, &analysis, ctx)
                || three_gpu_computation_has_cleanup(
                    allocation,
                    &lifecycle,
                    &effect_entries,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    &mut assigned_expression_cache,
                )
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
        }
    }
}

fn three_gpu_computation_candidate_api_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return static_member_expression_property_name(member).map(str::to_string);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = identifier_symbol_id_with_lexical_fallback(identifier, ctx)?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return None;
        };
        return Some(qualified_name.right.name.to_string());
    }
    if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return None;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            return three_gpu_computation_candidate_api_name(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            );
        }
        return destructured_binding_provenance(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .map(|(property_name, _)| property_name);
    }
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
            != Some(symbol_id)
        {
            return None;
        }
        let crate::module_record::ImportImportName::Name(imported_name) = &entry.import_name else {
            return None;
        };
        Some(imported_name.name().to_string())
    })
}

fn three_gpu_computation_direct_lifecycle<'a>(
    allocation: &crate::AstNode<'a>,
    effect_entries: &[ThreeGpuComputationEffectEntry],
    ctx: &LintContext<'a>,
) -> Option<ThreeGpuComputationLifecycle> {
    let allocation_root = transparent_expression_root(allocation, ctx);
    let declaration = ctx.nodes().parent_node(allocation_root.id());
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != allocation_root.span())
    {
        return None;
    }
    let source_symbol_id = declarator.id.get_binding_identifier()?.symbol_id();
    let allocation_function_id = local_callback_nearest_function_id(allocation.id(), ctx)?;
    if is_node_conditionally_executed(allocation, allocation_function_id, ctx) {
        return None;
    }
    let allocation_effect = effect_entries
        .iter()
        .find(|entry| entry.callback_id == allocation_function_id);
    let (owner_id, creation_kind) = if let Some(effect) = allocation_effect {
        (
            effect.owner_id?,
            ThreeGpuComputationCreationKind::Effect,
        )
    } else {
        let owner = find_render_phase_component_or_hook(allocation, ctx)?;
        if crate::ast_util::get_enclosing_function(ctx.symbol_declaration(source_symbol_id), ctx)
            .map(crate::AstNode::id)
            != Some(owner.id())
        {
            return None;
        }
        (owner.id(), ThreeGpuComputationCreationKind::Render)
    };
    let symbol_ids = r3f_root_collect_alias_symbol_ids(source_symbol_id, ctx);
    Some(ThreeGpuComputationLifecycle {
        access_path: R3fOwnedRootAccessPath::Direct,
        creation_kind,
        owner_id,
        owner_symbol_ids: symbol_ids.clone(),
        resource_symbol_ids: symbol_ids,
    })
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
            let declaration = ctx.nodes().parent_node(reference_root.id());
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
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
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
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

fn three_gpu_computation_is_eager_hook_allocation<'a>(
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

fn three_gpu_computation_effect_entries<'a>(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<ThreeGpuComputationEffectEntry> {
    let mut entries = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !THREE_GPU_COMPUTATION_EFFECT_HOOK_NAMES
            .iter()
            .any(|hook_name| {
                r3f_owned_root_react_api_matches(call_expression, hook_name, analysis, ctx)
            })
        {
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
        let owner_id = find_render_phase_component_or_hook(node, ctx).map(crate::AstNode::id);
        entries.push(ThreeGpuComputationEffectEntry {
            callback_id,
            call_id: node.id(),
            owner_id,
            has_unconditional_registration: owner_id.is_some_and(|owner_id| {
                three_gpu_computation_execution_is_guaranteed(node, owner_id, node_index, ctx)
            }),
        });
    }
    entries
}

fn three_gpu_computation_expression_matches(
    expression: &Expression<'_>,
    lifecycle: &ThreeGpuComputationLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| lifecycle.resource_symbol_ids.contains(&symbol_id));
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id))
        && r3f_owned_root_member_matches_path(member, &lifecycle.access_path)
}

fn three_gpu_computation_expression_matches_owner(
    expression: &Expression<'_>,
    lifecycle: &ThreeGpuComputationLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    three_gpu_computation_expression_matches(expression, lifecycle, ctx)
        || matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
            |symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id)
        ))
}

fn three_gpu_computation_resource_access<'a, 'b>(
    reference_node: &'b crate::AstNode<'a>,
    reference_symbol_id: SymbolId,
    lifecycle: &ThreeGpuComputationLifecycle,
    ctx: &'b LintContext<'a>,
) -> Option<&'b crate::AstNode<'a>> {
    let reference_root = transparent_expression_root(reference_node, ctx);
    if lifecycle.resource_symbol_ids.contains(&reference_symbol_id) {
        return Some(reference_root);
    }
    if matches!(lifecycle.access_path, R3fOwnedRootAccessPath::Direct) {
        return None;
    }
    let member_node = ctx.nodes().parent_node(reference_root.id());
    let member = member_node.kind().as_member_expression_kind()?;
    (member.object().span() == reference_root.span()
        && r3f_owned_root_member_node_matches_path(member_node, &lifecycle.access_path))
    .then_some(member_node)
}

fn three_gpu_computation_has_unstable_identity<'a>(
    lifecycle: &ThreeGpuComputationLifecycle,
    allocation: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let symbol_ids = lifecycle
        .owner_symbol_ids
        .iter()
        .chain(&lifecycle.resource_symbol_ids)
        .copied()
        .collect::<rustc_hash::FxHashSet<_>>();
    for symbol_id in symbol_ids {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let Some(resource_access) =
                three_gpu_computation_resource_access(reference_node, symbol_id, lifecycle, ctx)
            else {
                continue;
            };
            if !three_gpu_computation_is_inside_assignment_pattern_default(resource_access, ctx)
                && r3f_owned_root_access_has_non_allocation_identity_write(
                    resource_access,
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

fn three_gpu_computation_is_inside_assignment_pattern_default<'a>(
    resource_access: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let resource_span = transparent_expression_root(resource_access, ctx).span();
    ctx.nodes().ancestors(resource_access.id()).any(|ancestor| {
        matches!(ancestor.kind(), AstKind::AssignmentTargetPropertyIdentifier(property)
            if property.init.is_some()
                && property.binding.span().contains_inclusive(resource_span))
    })
}

fn three_gpu_computation_has_unknown_transfer<'a>(
    lifecycle: &ThreeGpuComputationLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    for symbol_id in lifecycle
        .owner_symbol_ids
        .iter()
        .chain(&lifecycle.resource_symbol_ids)
        .copied()
    {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let resource_access =
                three_gpu_computation_resource_access(reference_node, symbol_id, lifecycle, ctx);
            let Some(resource_access) = resource_access else {
                if matches!(lifecycle.access_path, R3fOwnedRootAccessPath::Direct)
                    || !lifecycle.owner_symbol_ids.contains(&symbol_id)
                {
                    continue;
                }
                let reference_root = transparent_expression_root(reference_node, ctx);
                let parent = ctx.nodes().parent_node(reference_root.id());
                if matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|initializer| initializer.span() == reference_root.span()))
                    || three_gpu_computation_is_effect_dependency(reference_root, analysis, ctx)
                    || parent
                        .kind()
                        .as_member_expression_kind()
                        .is_some_and(|member| {
                            member.object().span() == reference_root.span()
                                && member.static_property_name().is_some()
                        })
                {
                    continue;
                }
                return true;
            };
            let resource_root = transparent_expression_root(resource_access, ctx);
            let parent = ctx.nodes().parent_node(resource_root.id());
            if matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| initializer.span() == resource_root.span())
                    && declarator.id.get_binding_identifier().is_some())
                || three_gpu_computation_is_effect_dependency(resource_root, analysis, ctx)
            {
                continue;
            }
            let is_resource_member_access = parent
                .kind()
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span() == resource_root.span());
            if three_gpu_computation_is_returned_from_owner(resource_root, lifecycle.owner_id, ctx)
                && !is_resource_member_access
            {
                return true;
            }
            if let Some((call_expression, argument_span)) =
                three_gpu_computation_containing_call_argument(resource_root, ctx)
            {
                let method_name = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(static_member_expression_property_name);
                if argument_span == resource_root.span()
                    && method_name.is_none_or(|method_name| {
                        !THREE_GPU_COMPUTATION_BORROWING_METHOD_NAMES.contains(&method_name)
                    })
                {
                    return true;
                }
                continue;
            }
            if is_resource_member_access {
                continue;
            }
            for ancestor in ctx.nodes().ancestors(resource_root.id()) {
                if matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    break;
                }
                if matches!(ancestor.kind(), AstKind::JSXExpressionContainer(_))
                    || matches!(ancestor.kind(), AstKind::AssignmentExpression(assignment)
                        if assignment.right.span().contains_inclusive(resource_root.span()))
                    || matches!(ancestor.kind(), AstKind::ObjectProperty(property)
                        if property.value.span().contains_inclusive(resource_root.span()))
                    || matches!(ancestor.kind(), AstKind::ArrayExpression(_))
                {
                    return true;
                }
            }
        }
    }
    false
}

fn three_gpu_computation_is_effect_dependency<'a>(
    reference: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((call_expression, argument_span)) =
        three_gpu_computation_containing_call_argument(reference, ctx)
    else {
        return false;
    };
    call_expression
        .arguments
        .get(1)
        .is_some_and(|dependency| dependency.span() == argument_span)
        && THREE_GPU_COMPUTATION_EFFECT_HOOK_NAMES
            .iter()
            .any(|hook_name| {
                r3f_owned_root_react_api_matches(call_expression, hook_name, analysis, ctx)
            })
}

fn three_gpu_computation_is_returned_from_owner(
    reference: &crate::AstNode<'_>,
    owner_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    local_callback_nearest_function_id(reference.id(), ctx) == Some(owner_id)
        && ctx
            .nodes()
            .ancestors(reference.id())
            .take_while(|ancestor| ancestor.id() != owner_id)
            .any(|ancestor| matches!(ancestor.kind(), AstKind::ReturnStatement(_)))
}

fn three_gpu_computation_containing_call_argument<'a, 'b>(
    reference: &'b crate::AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b oxc_ast::ast::CallExpression<'a>, oxc_span::Span)> {
    let mut current = reference;
    for parent in ctx.nodes().ancestors(reference.id()) {
        if matches!(
            parent.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return None;
        }
        if let AstKind::CallExpression(call_expression) = parent.kind() {
            return call_expression
                .arguments
                .iter()
                .any(|argument| argument.span() == current.span())
                .then_some((call_expression, current.span()));
        }
        current = parent;
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn three_gpu_computation_has_cleanup<'a>(
    allocation: &crate::AstNode<'a>,
    lifecycle: &ThreeGpuComputationLifecycle,
    effect_entries: &[ThreeGpuComputationEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    let mut has_unknown_cleanup = false;
    let allocation_effect_call_id = (lifecycle.creation_kind
        == ThreeGpuComputationCreationKind::Effect)
        .then(|| local_callback_nearest_function_id(allocation.id(), ctx))
        .flatten()
        .and_then(|callback_id| {
            effect_entries
                .iter()
                .find(|entry| entry.callback_id == callback_id)
                .map(|entry| entry.call_id)
        });
    for effect in effect_entries {
        if effect.owner_id != Some(lifecycle.owner_id)
            || !effect.has_unconditional_registration
            || allocation_effect_call_id
                .is_some_and(|allocation_call_id| allocation_call_id != effect.call_id)
        {
            continue;
        }
        let cleanup_matches = if lifecycle.creation_kind == ThreeGpuComputationCreationKind::Effect
            && local_callback_nearest_function_id(allocation.id(), ctx) == Some(effect.callback_id)
        {
            let matching_returns = three_gpu_computation_matching_cleanup_returns(
                effect.callback_id,
                lifecycle,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                &mut Vec::new(),
            );
            do_nodes_cover_every_path_after_node(
                allocation,
                &matching_returns,
                ctx.nodes().get_node(effect.callback_id),
                ctx,
            )
        } else {
            three_gpu_computation_function_returns_cleanup_on_every_path(
                effect.callback_id,
                lifecycle,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                &mut Vec::new(),
            )
        };
        if !cleanup_matches {
            continue;
        }
        match three_gpu_computation_dependency_status(effect, lifecycle, ctx) {
            ThreeGpuComputationDependencyStatus::Valid => return true,
            ThreeGpuComputationDependencyStatus::Unknown => has_unknown_cleanup = true,
            ThreeGpuComputationDependencyStatus::Invalid => {}
        }
    }
    has_unknown_cleanup
}

fn three_gpu_computation_dependency_status(
    effect: &ThreeGpuComputationEffectEntry,
    lifecycle: &ThreeGpuComputationLifecycle,
    ctx: &LintContext<'_>,
) -> ThreeGpuComputationDependencyStatus {
    let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(effect.call_id).kind()
    else {
        return ThreeGpuComputationDependencyStatus::Invalid;
    };
    let Some(dependency_argument) = call_expression.arguments.get(1) else {
        return ThreeGpuComputationDependencyStatus::Valid;
    };
    let Some(dependency_expression) = dependency_argument.as_expression() else {
        return ThreeGpuComputationDependencyStatus::Unknown;
    };
    let Expression::ArrayExpression(dependencies) = dependency_expression.get_inner_expression()
    else {
        return ThreeGpuComputationDependencyStatus::Unknown;
    };
    if matches!(
        lifecycle.creation_kind,
        ThreeGpuComputationCreationKind::Stable | ThreeGpuComputationCreationKind::Effect
    ) {
        return ThreeGpuComputationDependencyStatus::Valid;
    }
    if dependencies.elements.iter().any(|element| {
        element.as_expression().is_some_and(|expression| {
            three_gpu_computation_expression_matches_owner(expression, lifecycle, ctx)
        })
    }) {
        ThreeGpuComputationDependencyStatus::Valid
    } else {
        ThreeGpuComputationDependencyStatus::Invalid
    }
}

fn three_gpu_computation_matching_cleanup_returns<'a, 'b>(
    callback_id: NodeId,
    lifecycle: &ThreeGpuComputationLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &'b LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
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
        if three_gpu_computation_cleanup_expression_matches(
            returned_expression,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            visited_function_ids,
            &mut Vec::new(),
        ) {
            matching_returns.push(candidate);
        }
    }
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = function.get_expression()
        && three_gpu_computation_cleanup_expression_matches(
            expression,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            visited_function_ids,
            &mut Vec::new(),
        )
    {
        matching_returns.push(ctx.nodes().get_node(expression.node_id()));
    }
    matching_returns
}

#[allow(clippy::too_many_arguments)]
fn three_gpu_computation_cleanup_expression_matches<'a>(
    expression: &'a Expression<'a>,
    lifecycle: &ThreeGpuComputationLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(cleanup_function_id) =
        exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
        && three_gpu_computation_cleanup_function_matches(
            cleanup_function_id,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        )
    {
        return true;
    }
    match expression {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let assigned_expressions = r3f_analyzed_possible_assigned_expressions(
                identifier,
                symbol_id,
                ctx,
                assigned_expression_cache,
            );
            let matches = !assigned_expressions.is_empty()
                && assigned_expressions.into_iter().all(|assigned_expression| {
                    let assigned_expression = assigned_expression.get_inner_expression();
                    if matches!(
                        assigned_expression,
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) {
                        return false;
                    }
                    three_gpu_computation_cleanup_expression_matches(
                        assigned_expression,
                        lifecycle,
                        analysis,
                        node_index,
                        ctx,
                        resolution_cache,
                        assigned_expression_cache,
                        visited_function_ids,
                        &mut visited_symbol_ids.clone(),
                    )
                });
            visited_symbol_ids.pop();
            matches
        }
        Expression::CallExpression(call_expression) if call_expression.arguments.is_empty() => {
            matches!(&call_expression.callee, Expression::Identifier(_))
                && r3f_analyzed_zero_argument_helper_id(&call_expression.callee, ctx).is_some_and(
                    |called_function_id| {
                        three_gpu_computation_function_returns_cleanup_on_every_path(
                            called_function_id,
                            lifecycle,
                            analysis,
                            node_index,
                            ctx,
                            resolution_cache,
                            assigned_expression_cache,
                            visited_function_ids,
                        )
                    },
                )
        }
        Expression::ConditionalExpression(conditional) => {
            three_gpu_computation_cleanup_expression_matches(
                &conditional.consequent,
                lifecycle,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) && three_gpu_computation_cleanup_expression_matches(
                &conditional.alternate,
                lifecycle,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::LogicalExpression(logical) => {
            three_gpu_computation_cleanup_expression_matches(
                &logical.left,
                lifecycle,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) && three_gpu_computation_cleanup_expression_matches(
                &logical.right,
                lifecycle,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            )
        }
        _ => false,
    }
}

#[allow(clippy::too_many_arguments)]
fn three_gpu_computation_cleanup_function_matches<'a>(
    cleanup_function_id: NodeId,
    lifecycle: &ThreeGpuComputationLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let mut did_dispose = false;
    for_each_analyzed_synchronous_execution_node(
        cleanup_function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, is_conditional, _| {
            if !did_dispose
                && !is_conditional
                && local_callback_nearest_function_id(candidate.id(), ctx).is_some_and(
                    |function_id| {
                        three_gpu_computation_execution_is_guaranteed(
                            candidate,
                            function_id,
                            node_index,
                            ctx,
                        )
                    },
                )
            {
                did_dispose = three_gpu_computation_is_dispose_call(candidate, lifecycle, ctx);
            }
        },
    );
    did_dispose
}

fn three_gpu_computation_is_dispose_call(
    candidate: &crate::AstNode<'_>,
    lifecycle: &ThreeGpuComputationLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::CallExpression(call_expression) = candidate.kind() else {
        return false;
    };
    let Some(member) = call_expression.callee.as_member_expression() else {
        return false;
    };
    static_member_expression_property_name(member) == Some("dispose")
        && three_gpu_computation_expression_matches(member.object(), lifecycle, ctx)
}

#[allow(clippy::too_many_arguments)]
fn three_gpu_computation_function_returns_cleanup_on_every_path<'a>(
    callback_id: NodeId,
    lifecycle: &ThreeGpuComputationLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    if visited_function_ids.contains(&callback_id) {
        return false;
    }
    visited_function_ids.push(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = function.get_expression()
    {
        let matches = three_gpu_computation_cleanup_expression_matches(
            expression,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            visited_function_ids,
            &mut Vec::new(),
        );
        visited_function_ids.pop();
        return matches;
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
        visited_function_ids.pop();
        return false;
    };
    let mut returned_expressions = Vec::new();
    let mut has_bare_return = false;
    for &candidate_id in node_index.node_ids(callback_id) {
        let AstKind::ReturnStatement(return_statement) = ctx.nodes().get_node(candidate_id).kind()
        else {
            continue;
        };
        if let Some(returned_expression) = return_statement.argument.as_ref() {
            returned_expressions.push(returned_expression);
        } else {
            has_bare_return = true;
        }
    }
    let matches = !has_bare_return
        && !returned_expressions.is_empty()
        && body_statements.iter().any(statement_always_exits)
        && returned_expressions.into_iter().all(|returned_expression| {
            three_gpu_computation_cleanup_expression_matches(
                returned_expression,
                lifecycle,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut Vec::new(),
            )
        });
    visited_function_ids.pop();
    matches
}

fn three_gpu_computation_execution_is_guaranteed<'a>(
    node: &crate::AstNode<'a>,
    boundary_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    if is_node_conditionally_executed(node, boundary_id, ctx)
        || ctx
            .nodes()
            .ancestors(node.id())
            .take_while(|ancestor| ancestor.id() != boundary_id)
            .any(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::ForStatement(_)
                        | AstKind::ForInStatement(_)
                        | AstKind::ForOfStatement(_)
                        | AstKind::WhileStatement(_)
                        | AstKind::DoWhileStatement(_)
                        | AstKind::TryStatement(_)
                )
            })
    {
        return false;
    }
    node_index
        .node_ids(boundary_id)
        .iter()
        .all(|&candidate_id| {
            let candidate = ctx.nodes().get_node(candidate_id);
            !matches!(
                candidate.kind(),
                AstKind::ReturnStatement(_) | AstKind::ThrowStatement(_)
            ) || candidate.span().start >= node.span().start
        })
}
