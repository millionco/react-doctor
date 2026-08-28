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
const THREE_CONTROLS_EFFECT_HOOK_NAMES: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const THREE_CONTROLS_MODULES: [&str; 3] = [
    "three/addons/controls/",
    "three/examples/jsm/controls/",
    "three-stdlib",
];
const THREE_CONTROLS_NAMES: [&str; 9] = [
    "ArcballControls",
    "DragControls",
    "FirstPersonControls",
    "FlyControls",
    "MapControls",
    "OrbitControls",
    "PointerLockControls",
    "TrackballControls",
    "TransformControls",
];
const THREE_CONTROLS_DISCONNECT_EQUIVALENT_NAMES: [&str; 7] = [
    "DragControls",
    "FirstPersonControls",
    "FlyControls",
    "MapControls",
    "OrbitControls",
    "PointerLockControls",
    "TrackballControls",
];
const THREE_CONTROLS_BORROWING_METHOD_NAMES: [&str; 0] = [];
const MESSAGE: &str = "These component-owned controls register DOM listeners but have no provable React cleanup. Dispose them when their owner changes or unmounts";

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireControlsCleanup;

impl RuleMeta for ThreeRequireControlsCleanup {
    const NAME: &'static str = "three-require-controls-cleanup";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require cleanup for component-owned Three.js controls.",
    };
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ThreeControlsCreationKind {
    Effect,
    Reactive,
    Render,
    Stable,
}

struct ThreeControlsLifecycle {
    access_path: R3fOwnedRootAccessPath,
    creation_kind: ThreeControlsCreationKind,
    owner_id: NodeId,
    owner_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
    resource_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
}

struct ThreeControlsEffectEntry {
    callback_id: NodeId,
    call_id: NodeId,
    owner_id: NodeId,
    has_unconditional_registration: bool,
}

enum ThreeControlsDependencyStatus {
    Valid,
    Invalid,
    Unknown,
}

impl Rule for ThreeRequireControlsCleanup {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut allocations = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(allocation) = node.kind() else {
                    return None;
                };
                let constructor_name =
                    three_controls_candidate_api_name(&allocation.callee, ctx, &mut Vec::new())?;
                THREE_CONTROLS_NAMES
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
            module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_CONTROLS_MODULES,
                &analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_CONTROLS_MODULES,
                &analysis,
                ctx,
            )
        });
        if allocations.is_empty() {
            return;
        }

        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let effect_entries =
            three_controls_effect_entries(&analysis, &node_index, ctx, &mut resolution_cache);
        for (allocation_id, constructor_name) in allocations {
            let allocation = ctx.nodes().get_node(allocation_id);
            if three_controls_is_eager_hook_allocation(allocation, &analysis, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
                continue;
            }
            let lifecycle =
                r3f_analyze_owned_root_lifecycle(allocation, &analysis, &node_index, ctx)
                    .map(|lifecycle| ThreeControlsLifecycle {
                        access_path: lifecycle.access_path,
                        creation_kind: if lifecycle.is_stable {
                            ThreeControlsCreationKind::Stable
                        } else {
                            ThreeControlsCreationKind::Reactive
                        },
                        owner_id: lifecycle.owner_id,
                        owner_symbol_ids: lifecycle.owner_symbol_ids,
                        resource_symbol_ids: lifecycle.resource_symbol_ids,
                    })
                    .or_else(|| three_controls_direct_lifecycle(allocation, &effect_entries, ctx));
            let Some(lifecycle) = lifecycle else {
                continue;
            };
            if three_controls_has_unstable_identity(&lifecycle, allocation, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
                continue;
            }
            let allows_disconnect =
                THREE_CONTROLS_DISCONNECT_EQUIVALENT_NAMES.contains(&constructor_name.as_str());
            let cleanup_method_names = if allows_disconnect {
                &["disconnect", "dispose"][..]
            } else {
                &["dispose"][..]
            };
            if three_controls_has_unknown_transfer(&lifecycle, &effect_entries, ctx)
                || three_controls_has_cleanup(
                    allocation,
                    &lifecycle,
                    cleanup_method_names,
                    &effect_entries,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                )
                || (allows_disconnect
                    && three_controls_has_setup_cleanup(
                        &lifecycle,
                        cleanup_method_names,
                        &effect_entries,
                        &analysis,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                    ))
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
        }
    }
}

fn three_controls_candidate_api_name<'a>(
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
            return three_controls_candidate_api_name(
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

fn three_controls_direct_lifecycle<'a>(
    allocation: &crate::AstNode<'a>,
    effect_entries: &[ThreeControlsEffectEntry],
    ctx: &LintContext<'a>,
) -> Option<ThreeControlsLifecycle> {
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
        (effect.owner_id, ThreeControlsCreationKind::Effect)
    } else {
        let owner = find_render_phase_component_or_hook(allocation, ctx)?;
        if crate::ast_util::get_enclosing_function(ctx.symbol_declaration(source_symbol_id), ctx)
            .map(crate::AstNode::id)
            != Some(owner.id())
        {
            return None;
        }
        (owner.id(), ThreeControlsCreationKind::Render)
    };
    let symbol_ids = r3f_root_collect_alias_symbol_ids(source_symbol_id, ctx);
    Some(ThreeControlsLifecycle {
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

fn three_controls_is_eager_hook_allocation<'a>(
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

fn three_controls_effect_entries<'a>(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<ThreeControlsEffectEntry> {
    let mut entries = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !THREE_CONTROLS_EFFECT_HOOK_NAMES.iter().any(|hook_name| {
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
        entries.push(ThreeControlsEffectEntry {
            callback_id,
            call_id: node.id(),
            owner_id: owner.id(),
            has_unconditional_registration: three_controls_execution_is_guaranteed(
                node,
                owner.id(),
                node_index,
                ctx,
            ),
        });
    }
    entries
}

fn three_controls_expression_matches(
    expression: &Expression<'_>,
    lifecycle: &ThreeControlsLifecycle,
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

fn three_controls_expression_matches_owner(
    expression: &Expression<'_>,
    lifecycle: &ThreeControlsLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    three_controls_expression_matches(expression, lifecycle, ctx)
        || matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
            |symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id)
        ))
}

fn three_controls_resource_access<'a, 'b>(
    reference_node: &'b crate::AstNode<'a>,
    reference_symbol_id: SymbolId,
    lifecycle: &ThreeControlsLifecycle,
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

fn three_controls_has_unstable_identity<'a>(
    lifecycle: &ThreeControlsLifecycle,
    allocation: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let allocation_root = transparent_expression_root(allocation, ctx);
    for symbol_id in lifecycle
        .owner_symbol_ids
        .iter()
        .chain(&lifecycle.resource_symbol_ids)
        .copied()
    {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let Some(resource_access) =
                three_controls_resource_access(reference_node, symbol_id, lifecycle, ctx)
            else {
                continue;
            };
            let current = transparent_expression_root(resource_access, ctx);
            let parent = ctx.nodes().parent_node(current.id());
            match parent.kind() {
                AstKind::AssignmentExpression(assignment)
                    if assignment.left.span().contains_inclusive(current.span())
                        && assignment.right.get_inner_expression().span()
                            != allocation_root.span() =>
                {
                    return true;
                }
                AstKind::UpdateExpression(update)
                    if update.argument.span().contains_inclusive(current.span()) =>
                {
                    return true;
                }
                _ => {}
            }
        }
    }
    false
}

fn three_controls_has_unknown_transfer<'a>(
    lifecycle: &ThreeControlsLifecycle,
    effect_entries: &[ThreeControlsEffectEntry],
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
                three_controls_resource_access(reference_node, symbol_id, lifecycle, ctx);
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
                    || three_controls_is_effect_dependency(reference_root, effect_entries, ctx)
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
                || three_controls_is_effect_dependency(resource_root, effect_entries, ctx)
            {
                continue;
            }
            if three_controls_crosses_custom_jsx_boundary(resource_root, ctx) {
                return true;
            }
            let is_resource_member_access = parent
                .kind()
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span() == resource_root.span());
            if three_controls_is_returned_from_owner(resource_root, lifecycle.owner_id, ctx)
                && !is_resource_member_access
                && !three_controls_is_inside_jsx(resource_root, ctx)
            {
                return true;
            }
            if let Some((call_expression, argument_span)) =
                three_controls_containing_call_argument(resource_root, ctx)
            {
                let method_name = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(static_member_expression_property_name);
                if argument_span == resource_root.span()
                    && method_name.is_none_or(|method_name| {
                        !THREE_CONTROLS_BORROWING_METHOD_NAMES.contains(&method_name)
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
                if matches!(ancestor.kind(), AstKind::AssignmentExpression(assignment)
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

fn three_controls_is_effect_dependency(
    reference: &crate::AstNode<'_>,
    effect_entries: &[ThreeControlsEffectEntry],
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

fn three_controls_is_returned_from_owner(
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

fn three_controls_is_inside_jsx(reference: &crate::AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(reference.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        if matches!(ancestor.kind(), AstKind::JSXExpressionContainer(_)) {
            return true;
        }
    }
    false
}

fn three_controls_crosses_custom_jsx_boundary<'a>(
    reference: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let reference_root = transparent_expression_root(reference, ctx);
    let parent = ctx.nodes().parent_node(reference_root.id());
    if parent
        .kind()
        .as_member_expression_kind()
        .is_some_and(|member| member.object().span() == reference_root.span())
    {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(reference.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        let AstKind::JSXAttribute(_) = ancestor.kind() else {
            continue;
        };
        let opening_element = ctx.nodes().parent_node(ancestor.id());
        let AstKind::JSXOpeningElement(opening_element) = opening_element.kind() else {
            return true;
        };
        let oxc_ast::ast::JSXElementName::Identifier(element_name) = &opening_element.name else {
            return true;
        };
        return element_name.name.contains('-')
            || element_name
                .name
                .chars()
                .next()
                .is_none_or(char::is_uppercase);
    }
    false
}

fn three_controls_containing_call_argument<'a, 'b>(
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
fn three_controls_has_cleanup<'a>(
    allocation: &crate::AstNode<'a>,
    lifecycle: &ThreeControlsLifecycle,
    cleanup_method_names: &[&str],
    effect_entries: &[ThreeControlsEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let mut has_unknown_cleanup = false;
    for effect in effect_entries {
        if effect.owner_id != lifecycle.owner_id || !effect.has_unconditional_registration {
            continue;
        }
        let matching_returns = three_controls_matching_cleanup_returns(
            effect.callback_id,
            lifecycle,
            cleanup_method_names,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        );
        let cleanup_matches = if lifecycle.creation_kind == ThreeControlsCreationKind::Effect
            && local_callback_nearest_function_id(allocation.id(), ctx) == Some(effect.callback_id)
        {
            do_nodes_cover_every_path_after_node(
                allocation,
                &matching_returns,
                ctx.nodes().get_node(effect.callback_id),
                ctx,
            )
        } else {
            three_controls_function_returns_cleanup_on_every_path(
                effect.callback_id,
                &matching_returns,
                node_index,
                ctx,
            )
        };
        if !cleanup_matches {
            continue;
        }
        match three_controls_dependency_status(effect, lifecycle, ctx) {
            ThreeControlsDependencyStatus::Valid => return true,
            ThreeControlsDependencyStatus::Unknown => has_unknown_cleanup = true,
            ThreeControlsDependencyStatus::Invalid => {}
        }
    }
    has_unknown_cleanup
}

#[allow(clippy::too_many_arguments)]
fn three_controls_has_setup_cleanup<'a>(
    lifecycle: &ThreeControlsLifecycle,
    cleanup_method_names: &[&str],
    effect_entries: &[ThreeControlsEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let mut has_unknown_cleanup = false;
    for effect in effect_entries {
        if effect.owner_id != lifecycle.owner_id || !effect.has_unconditional_registration {
            continue;
        }
        let matching_returns = three_controls_matching_cleanup_returns(
            effect.callback_id,
            lifecycle,
            cleanup_method_names,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        );
        let mut setup_call_ids = Vec::new();
        for_each_analyzed_synchronous_execution_node(
            effect.callback_id,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            |candidate, _, _, _| {
                let AstKind::CallExpression(call_expression) = candidate.kind() else {
                    return;
                };
                let Some(member) = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                else {
                    return;
                };
                if static_member_expression_property_name(member) == Some("connect")
                    && three_controls_expression_matches(member.object(), lifecycle, ctx)
                {
                    setup_call_ids.push(candidate.id());
                }
            },
        );
        if setup_call_ids.is_empty()
            || !setup_call_ids.iter().all(|&setup_call_id| {
                do_nodes_cover_every_path_after_node(
                    ctx.nodes().get_node(setup_call_id),
                    &matching_returns,
                    ctx.nodes().get_node(effect.callback_id),
                    ctx,
                )
            })
        {
            continue;
        }
        match three_controls_dependency_status(effect, lifecycle, ctx) {
            ThreeControlsDependencyStatus::Valid => return true,
            ThreeControlsDependencyStatus::Unknown => has_unknown_cleanup = true,
            ThreeControlsDependencyStatus::Invalid => {}
        }
    }
    has_unknown_cleanup
}

fn three_controls_dependency_status(
    effect: &ThreeControlsEffectEntry,
    lifecycle: &ThreeControlsLifecycle,
    ctx: &LintContext<'_>,
) -> ThreeControlsDependencyStatus {
    let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(effect.call_id).kind()
    else {
        return ThreeControlsDependencyStatus::Invalid;
    };
    let Some(dependency_argument) = call_expression.arguments.get(1) else {
        return ThreeControlsDependencyStatus::Valid;
    };
    let Some(dependency_expression) = dependency_argument.as_expression() else {
        return ThreeControlsDependencyStatus::Unknown;
    };
    let Expression::ArrayExpression(dependencies) = dependency_expression.get_inner_expression()
    else {
        return ThreeControlsDependencyStatus::Unknown;
    };
    if matches!(
        lifecycle.creation_kind,
        ThreeControlsCreationKind::Stable | ThreeControlsCreationKind::Effect
    ) {
        return ThreeControlsDependencyStatus::Valid;
    }
    if dependencies.elements.iter().any(|element| {
        element.as_expression().is_some_and(|expression| {
            three_controls_expression_matches_owner(expression, lifecycle, ctx)
        })
    }) {
        ThreeControlsDependencyStatus::Valid
    } else {
        ThreeControlsDependencyStatus::Invalid
    }
}

fn three_controls_matching_cleanup_returns<'a, 'b>(
    callback_id: NodeId,
    lifecycle: &ThreeControlsLifecycle,
    cleanup_method_names: &[&str],
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
        if three_controls_cleanup_expression_matches(
            returned_expression,
            lifecycle,
            cleanup_method_names,
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
        && three_controls_cleanup_expression_matches(
            expression,
            lifecycle,
            cleanup_method_names,
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

fn three_controls_cleanup_expression_matches<'a>(
    expression: &Expression<'a>,
    lifecycle: &ThreeControlsLifecycle,
    cleanup_method_names: &[&str],
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
    let mut did_cleanup = false;
    for_each_analyzed_synchronous_execution_node(
        cleanup_function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, is_conditional, _| {
            if !did_cleanup
                && !is_conditional
                && local_callback_nearest_function_id(candidate.id(), ctx).is_some_and(
                    |function_id| {
                        three_controls_execution_is_guaranteed(
                            candidate,
                            function_id,
                            node_index,
                            ctx,
                        )
                    },
                )
            {
                did_cleanup =
                    three_controls_is_cleanup_call(candidate, lifecycle, cleanup_method_names, ctx);
            }
        },
    );
    did_cleanup
}

fn three_controls_is_cleanup_call(
    candidate: &crate::AstNode<'_>,
    lifecycle: &ThreeControlsLifecycle,
    cleanup_method_names: &[&str],
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::CallExpression(call_expression) = candidate.kind() else {
        return false;
    };
    let Some(member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    static_member_expression_property_name(member)
        .is_some_and(|method_name| cleanup_method_names.contains(&method_name))
        && three_controls_expression_matches(member.object(), lifecycle, ctx)
}

fn three_controls_function_returns_cleanup_on_every_path(
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

fn three_controls_execution_is_guaranteed<'a>(
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
