use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};
use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};

const R3F_ROOT_REACT_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const THREE_WORKER_LOADER_EFFECT_HOOK_NAMES: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const THREE_WORKER_LOADER_MODULES: [&str; 3] = [
    "three/addons/loaders/",
    "three/examples/jsm/loaders/",
    "three-stdlib",
];
const THREE_WORKER_LOADER_NAMES: [&str; 2] = ["DRACOLoader", "KTX2Loader"];
const THREE_WORKER_LOADER_BORROWING_METHOD_NAMES: [&str; 2] = ["setDRACOLoader", "setKTX2Loader"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireWorkerLoaderCleanup;

impl RuleMeta for ThreeRequireWorkerLoaderCleanup {
    const NAME: &'static str = "three-require-worker-loader-cleanup";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require cleanup for component-owned worker-backed Three.js loaders.",
    };
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ThreeWorkerLoaderCreationKind {
    Effect,
    Reactive,
    Render,
    Stable,
}

struct ThreeWorkerLoaderLifecycle {
    access_path: R3fOwnedRootAccessPath,
    creation_kind: ThreeWorkerLoaderCreationKind,
    owner_id: NodeId,
    owner_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
    resource_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
}

struct ThreeWorkerLoaderEffectEntry {
    callback_id: NodeId,
    call_id: NodeId,
    owner_id: Option<NodeId>,
    has_unconditional_registration: bool,
}

enum ThreeWorkerLoaderDependencyStatus {
    Valid,
    Invalid,
    Unknown,
}

impl Rule for ThreeRequireWorkerLoaderCleanup {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut allocations = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(allocation) = node.kind() else {
                    return None;
                };
                let constructor_name = three_worker_loader_candidate_api_name(
                    &allocation.callee,
                    ctx,
                    &mut Vec::new(),
                )?;
                THREE_WORKER_LOADER_NAMES
                    .contains(&constructor_name.as_str())
                    .then_some((node.id(), constructor_name))
            })
            .collect::<Vec<_>>();
        if allocations.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        allocations.retain(|(node_id, constructor_name)| {
            let AstKind::NewExpression(allocation) = ctx.nodes().get_node(*node_id).kind() else {
                return false;
            };
            three_worker_loader_api_reference_has_canonical_wrapper_shape(
                &allocation.callee,
                ctx,
                &mut Vec::new(),
            ) && (module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_WORKER_LOADER_MODULES,
                &analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_WORKER_LOADER_MODULES,
                &analysis,
                ctx,
            ))
        });
        if allocations.is_empty() {
            return;
        }

        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let effect_entries =
            three_worker_loader_effect_entries(&analysis, &node_index, ctx, &mut resolution_cache);
        for (allocation_id, constructor_name) in allocations {
            let allocation = ctx.nodes().get_node(allocation_id);
            let message = format!(
                "This component-owned {constructor_name} has no provable dispose cleanup, so decoder workers or transcoder resources can survive dependency changes or unmount"
            );
            if three_worker_loader_is_eager_hook_allocation(allocation, &analysis, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(message).with_label(allocation.span()));
                continue;
            }
            let lifecycle =
                r3f_analyze_owned_root_lifecycle(allocation, &analysis, &node_index, ctx)
                    .map(|lifecycle| ThreeWorkerLoaderLifecycle {
                        access_path: lifecycle.access_path,
                        creation_kind: if lifecycle.is_stable {
                            ThreeWorkerLoaderCreationKind::Stable
                        } else {
                            ThreeWorkerLoaderCreationKind::Reactive
                        },
                        owner_id: lifecycle.owner_id,
                        owner_symbol_ids: lifecycle.owner_symbol_ids,
                        resource_symbol_ids: lifecycle.resource_symbol_ids,
                    })
                    .or_else(|| {
                        three_worker_loader_direct_lifecycle(allocation, &effect_entries, ctx)
                    });
            let Some(lifecycle) = lifecycle else {
                continue;
            };
            if three_worker_loader_has_unstable_identity(&lifecycle, allocation, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(message).with_label(allocation.span()));
                continue;
            }
            if three_worker_loader_has_unknown_transfer(&lifecycle, &analysis, ctx)
                || three_worker_loader_has_cleanup(
                    allocation,
                    &lifecycle,
                    &effect_entries,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                )
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(allocation.span()));
        }
    }
}

fn three_worker_loader_candidate_api_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = three_worker_loader_strip_parentheses(expression);
    if let Some(member) = expression.as_member_expression() {
        return three_worker_loader_static_member_property_name(member).map(str::to_string);
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
            return three_worker_loader_candidate_api_name(
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

fn three_worker_loader_direct_lifecycle<'a>(
    allocation: &crate::AstNode<'a>,
    effect_entries: &[ThreeWorkerLoaderEffectEntry],
    ctx: &LintContext<'a>,
) -> Option<ThreeWorkerLoaderLifecycle> {
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
        (effect.owner_id?, ThreeWorkerLoaderCreationKind::Effect)
    } else {
        let owner = find_render_phase_component_or_hook(allocation, ctx)?;
        if crate::ast_util::get_enclosing_function(ctx.symbol_declaration(source_symbol_id), ctx)
            .map(crate::AstNode::id)
            != Some(owner.id())
        {
            return None;
        }
        (owner.id(), ThreeWorkerLoaderCreationKind::Render)
    };
    let symbol_ids = r3f_root_collect_alias_symbol_ids(source_symbol_id, ctx);
    Some(ThreeWorkerLoaderLifecycle {
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

fn three_worker_loader_is_eager_hook_allocation<'a>(
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
                three_worker_loader_react_api_matches(call_expression, hook_name, analysis, ctx)
            })
        {
            return find_render_phase_component_or_hook(parent, ctx).is_some();
        }
        current = parent;
    }
    false
}

fn three_worker_loader_effect_entries<'a>(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<ThreeWorkerLoaderEffectEntry> {
    let mut entries = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !THREE_WORKER_LOADER_EFFECT_HOOK_NAMES
            .iter()
            .any(|hook_name| {
                three_worker_loader_react_api_matches(call_expression, hook_name, analysis, ctx)
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
        entries.push(ThreeWorkerLoaderEffectEntry {
            callback_id,
            call_id: node.id(),
            owner_id,
            has_unconditional_registration: owner_id.is_some_and(|owner_id| {
                three_worker_loader_execution_is_guaranteed(node, owner_id, node_index, ctx)
            }),
        });
    }
    entries
}

fn three_worker_loader_expression_matches(
    expression: &Expression<'_>,
    lifecycle: &ThreeWorkerLoaderLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = three_worker_loader_strip_parentheses(expression);
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
    let Expression::Identifier(identifier) = three_worker_loader_strip_parentheses(member.object())
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id))
        && three_worker_loader_member_matches_path(member, &lifecycle.access_path)
}

fn three_worker_loader_expression_matches_owner(
    expression: &Expression<'_>,
    lifecycle: &ThreeWorkerLoaderLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    three_worker_loader_expression_matches(expression, lifecycle, ctx)
        || matches!(three_worker_loader_strip_parentheses(expression), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
            |symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id)
        ))
}

fn three_worker_loader_resource_access<'a, 'b>(
    reference_node: &'b crate::AstNode<'a>,
    reference_symbol_id: SymbolId,
    lifecycle: &ThreeWorkerLoaderLifecycle,
    ctx: &'b LintContext<'a>,
) -> Option<&'b crate::AstNode<'a>> {
    let reference_root = transparent_expression_root(reference_node, ctx);
    if reference_root.id() != parenthesized_expression_root(reference_node, ctx).id() {
        return None;
    }
    if lifecycle.resource_symbol_ids.contains(&reference_symbol_id) {
        return Some(reference_root);
    }
    if matches!(lifecycle.access_path, R3fOwnedRootAccessPath::Direct) {
        return None;
    }
    let member_node = ctx.nodes().parent_node(reference_root.id());
    let member = member_node.kind().as_member_expression_kind()?;
    (member.object().span() == reference_root.span()
        && three_worker_loader_member_kind_matches_path(member, &lifecycle.access_path))
    .then_some(member_node)
}

fn three_worker_loader_has_unstable_identity<'a>(
    lifecycle: &ThreeWorkerLoaderLifecycle,
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
                three_worker_loader_resource_access(reference_node, symbol_id, lifecycle, ctx)
            else {
                continue;
            };
            if !three_worker_loader_is_defaulted_object_assignment_binding(resource_access, ctx)
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

fn three_worker_loader_is_defaulted_object_assignment_binding<'a>(
    resource_access: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let resource_root = transparent_expression_root(resource_access, ctx);
    match ctx.nodes().parent_node(resource_root.id()).kind() {
        AstKind::AssignmentTargetPropertyIdentifier(property) => {
            property.init.is_some()
                && property
                    .binding
                    .span()
                    .contains_inclusive(resource_root.span())
        }
        AstKind::AssignmentTargetPropertyProperty(property) => {
            matches!(
                &property.binding,
                oxc_ast::ast::AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(_)
            ) && property
                .binding
                .span()
                .contains_inclusive(resource_root.span())
        }
        _ => false,
    }
}

fn three_worker_loader_has_unknown_transfer<'a>(
    lifecycle: &ThreeWorkerLoaderLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
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
            let resource_access =
                three_worker_loader_resource_access(reference_node, symbol_id, lifecycle, ctx);
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
                    || three_worker_loader_is_effect_dependency(reference_root, analysis, ctx)
                    || parent
                        .kind()
                        .as_member_expression_kind()
                        .is_some_and(|member| {
                            member.object().span() == reference_root.span()
                                && three_worker_loader_static_member_kind_property_name(member)
                                    .is_some()
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
                || three_worker_loader_is_effect_dependency(resource_root, analysis, ctx)
            {
                continue;
            }
            let is_resource_member_access = parent
                .kind()
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span() == resource_root.span());
            if three_worker_loader_is_returned_from_owner(resource_root, lifecycle.owner_id, ctx)
                && !is_resource_member_access
            {
                return true;
            }
            if let Some((call_expression, argument_span)) =
                three_worker_loader_containing_call_argument(resource_root, ctx)
            {
                let method_name = three_worker_loader_strip_parentheses(&call_expression.callee)
                    .as_member_expression()
                    .and_then(three_worker_loader_static_member_property_name);
                if argument_span == resource_root.span()
                    && method_name.is_none_or(|method_name| {
                        !THREE_WORKER_LOADER_BORROWING_METHOD_NAMES.contains(&method_name)
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
                    || matches!(ancestor.kind(), AstKind::AssignmentTargetPropertyIdentifier(property)
                        if property.init.as_ref().is_some_and(|initializer| initializer.span().contains_inclusive(resource_root.span())))
                    || matches!(ancestor.kind(), AstKind::AssignmentTargetPropertyProperty(property)
                        if property.binding.span().contains_inclusive(resource_root.span()))
                    || matches!(ancestor.kind(), AstKind::ArrayExpression(_))
                {
                    return true;
                }
            }
        }
    }
    false
}

fn three_worker_loader_is_effect_dependency<'a>(
    reference: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((call_expression, argument_span)) =
        three_worker_loader_containing_call_argument(reference, ctx)
    else {
        return false;
    };
    call_expression
        .arguments
        .get(1)
        .is_some_and(|dependency| dependency.span() == argument_span)
        && THREE_WORKER_LOADER_EFFECT_HOOK_NAMES
            .iter()
            .any(|hook_name| {
                three_worker_loader_react_api_matches(call_expression, hook_name, analysis, ctx)
            })
}

fn three_worker_loader_is_returned_from_owner(
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

fn three_worker_loader_containing_call_argument<'a, 'b>(
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
fn three_worker_loader_has_cleanup<'a>(
    allocation: &crate::AstNode<'a>,
    lifecycle: &ThreeWorkerLoaderLifecycle,
    effect_entries: &[ThreeWorkerLoaderEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let mut has_unknown_cleanup = false;
    let allocation_effect_call_id = (lifecycle.creation_kind
        == ThreeWorkerLoaderCreationKind::Effect)
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
        let matching_returns = three_worker_loader_matching_cleanup_returns(
            effect.callback_id,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        );
        let cleanup_matches = if allocation_effect_call_id == Some(effect.call_id) {
            do_nodes_cover_every_path_after_node(
                allocation,
                &matching_returns,
                ctx.nodes().get_node(effect.callback_id),
                ctx,
            )
        } else {
            three_worker_loader_function_returns_cleanup_on_every_path(
                effect.callback_id,
                &matching_returns,
                node_index,
                ctx,
            )
        };
        if !cleanup_matches {
            continue;
        }
        match three_worker_loader_dependency_status(effect, lifecycle, ctx) {
            ThreeWorkerLoaderDependencyStatus::Valid => return true,
            ThreeWorkerLoaderDependencyStatus::Unknown => has_unknown_cleanup = true,
            ThreeWorkerLoaderDependencyStatus::Invalid => {}
        }
    }
    has_unknown_cleanup
}

fn three_worker_loader_dependency_status(
    effect: &ThreeWorkerLoaderEffectEntry,
    lifecycle: &ThreeWorkerLoaderLifecycle,
    ctx: &LintContext<'_>,
) -> ThreeWorkerLoaderDependencyStatus {
    let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(effect.call_id).kind()
    else {
        return ThreeWorkerLoaderDependencyStatus::Invalid;
    };
    let Some(dependency_argument) = call_expression.arguments.get(1) else {
        return ThreeWorkerLoaderDependencyStatus::Valid;
    };
    let Some(dependency_expression) = dependency_argument.as_expression() else {
        return ThreeWorkerLoaderDependencyStatus::Unknown;
    };
    let Expression::ArrayExpression(dependencies) =
        three_worker_loader_strip_parentheses(dependency_expression)
    else {
        return ThreeWorkerLoaderDependencyStatus::Unknown;
    };
    if matches!(
        lifecycle.creation_kind,
        ThreeWorkerLoaderCreationKind::Stable | ThreeWorkerLoaderCreationKind::Effect
    ) {
        return ThreeWorkerLoaderDependencyStatus::Valid;
    }
    if dependencies.elements.iter().any(|element| {
        element.as_expression().is_some_and(|expression| {
            three_worker_loader_expression_matches_owner(expression, lifecycle, ctx)
        })
    }) {
        ThreeWorkerLoaderDependencyStatus::Valid
    } else {
        ThreeWorkerLoaderDependencyStatus::Invalid
    }
}

fn three_worker_loader_matching_cleanup_returns<'a, 'b>(
    callback_id: NodeId,
    lifecycle: &ThreeWorkerLoaderLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &'b LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
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
        if three_worker_loader_cleanup_expression_matches(
            returned_expression,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        ) {
            matching_returns.push(candidate);
        }
    }
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = function.get_expression()
        && three_worker_loader_cleanup_expression_matches(
            expression,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        )
    {
        matching_returns.push(ctx.nodes().get_node(expression.node_id()));
    }
    matching_returns
}

fn three_worker_loader_cleanup_expression_matches<'a>(
    expression: &Expression<'a>,
    lifecycle: &ThreeWorkerLoaderLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Some(cleanup_function_id) =
        exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
    else {
        return false;
    };
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
                        three_worker_loader_execution_is_guaranteed(
                            candidate,
                            function_id,
                            node_index,
                            ctx,
                        )
                    },
                )
            {
                did_dispose = three_worker_loader_is_dispose_call(candidate, lifecycle, ctx);
            }
        },
    );
    did_dispose
}

fn three_worker_loader_is_dispose_call(
    candidate: &crate::AstNode<'_>,
    lifecycle: &ThreeWorkerLoaderLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::CallExpression(call_expression) = candidate.kind() else {
        return false;
    };
    let Some(member) = call_expression.callee.as_member_expression() else {
        return false;
    };
    three_worker_loader_static_member_property_name(member) == Some("dispose")
        && three_worker_loader_expression_matches(member.object(), lifecycle, ctx)
}

fn three_worker_loader_function_returns_cleanup_on_every_path(
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

fn three_worker_loader_execution_is_guaranteed<'a>(
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

fn three_worker_loader_react_api_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    three_worker_loader_api_reference_has_canonical_wrapper_shape(
        &call_expression.callee,
        ctx,
        &mut Vec::new(),
    ) && r3f_owned_root_react_api_matches(call_expression, api_name, analysis, ctx)
}

fn three_worker_loader_static_member_property_name<'a, 'node>(
    member: &'node oxc_ast::ast::MemberExpression<'a>,
) -> Option<&'node str> {
    match member {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
            Some(member.property.name.as_str())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
            match &member.expression {
                Expression::StringLiteral(literal) => Some(literal.value.as_str()),
                Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                    template.quasis.first().map(|quasi| {
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    })
                }
                _ => None,
            }
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn three_worker_loader_static_member_kind_property_name<'node>(
    member: oxc_ast::MemberExpressionKind<'node>,
) -> Option<&'node str> {
    match member {
        oxc_ast::MemberExpressionKind::Static(member) => Some(member.property.name.as_str()),
        oxc_ast::MemberExpressionKind::Computed(member) => match &member.expression {
            Expression::StringLiteral(literal) => Some(literal.value.as_str()),
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                template.quasis.first().map(|quasi| {
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                })
            }
            _ => None,
        },
        oxc_ast::MemberExpressionKind::PrivateField(_) => None,
    }
}

fn three_worker_loader_member_matches_path(
    member: &oxc_ast::ast::MemberExpression<'_>,
    access_path: &R3fOwnedRootAccessPath,
) -> bool {
    match access_path {
        R3fOwnedRootAccessPath::Direct => false,
        R3fOwnedRootAccessPath::Object(property_name) => {
            three_worker_loader_static_member_property_name(member) == Some(property_name.as_str())
        }
        R3fOwnedRootAccessPath::Array(index) => matches!(
            member,
            oxc_ast::ast::MemberExpression::ComputedMemberExpression(member)
                if matches!(&member.expression, Expression::NumericLiteral(literal) if literal.value == *index as f64)
        ),
    }
}

fn three_worker_loader_member_kind_matches_path(
    member: oxc_ast::MemberExpressionKind<'_>,
    access_path: &R3fOwnedRootAccessPath,
) -> bool {
    match access_path {
        R3fOwnedRootAccessPath::Direct => false,
        R3fOwnedRootAccessPath::Object(property_name) => {
            three_worker_loader_static_member_kind_property_name(member)
                == Some(property_name.as_str())
        }
        R3fOwnedRootAccessPath::Array(index) => matches!(
            member,
            oxc_ast::MemberExpressionKind::Computed(member)
                if matches!(&member.expression, Expression::NumericLiteral(literal) if literal.value == *index as f64)
        ),
    }
}

fn three_worker_loader_api_reference_has_canonical_wrapper_shape<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = three_worker_loader_strip_parentheses(expression);
    if let Some(member) = expression.as_member_expression() {
        return three_worker_loader_module_namespace_has_canonical_wrapper_shape(
            member.object(),
            ctx,
            visited_symbol_ids,
        );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(declaration.kind(), AstKind::TSImportEqualsDeclaration(_)) {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return true;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            three_worker_loader_api_reference_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        });
    }
    destructured_binding_provenance(&declarator.id, symbol_id, declarator.init.as_ref())
        .is_some_and(|(_, initializer)| {
            three_worker_loader_module_namespace_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_worker_loader_module_namespace_has_canonical_wrapper_shape<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = three_worker_loader_strip_parentheses(expression);
    if matches!(expression, Expression::CallExpression(_)) {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(declaration.kind(), AstKind::TSImportEqualsDeclaration(_)) {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return true;
    };
    declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            three_worker_loader_module_namespace_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_worker_loader_strip_parentheses<'a, 'node>(
    mut expression: &'node Expression<'a>,
) -> &'node Expression<'a> {
    while let Expression::ParenthesizedExpression(parenthesized) = expression {
        expression = &parenthesized.expression;
    }
    expression
}
