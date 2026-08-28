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
const THREE_OWNED_GEOMETRY_EFFECT_HOOK_NAMES: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const THREE_OWNED_GEOMETRY_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const MESSAGE: &str = "This locally constructed Three.js geometry owns GPU buffers but has no provable React cleanup. Dispose it when the owning component or hook releases it";

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireOwnedGeometryCleanup;

impl RuleMeta for ThreeRequireOwnedGeometryCleanup {
    const NAME: &'static str = "three-require-owned-geometry-cleanup";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require cleanup for locally owned Three.js geometries.",
    };
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ThreeOwnedGeometryCreationKind {
    Effect,
    Reactive,
    Render,
    Stable,
}

struct ThreeOwnedGeometryLifecycle {
    access_path: R3fOwnedRootAccessPath,
    creation_kind: ThreeOwnedGeometryCreationKind,
    has_eager_hook_allocation: bool,
    owner_id: NodeId,
    owner_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
    resource_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
}

struct ThreeOwnedGeometryEffectEntry {
    callback_id: NodeId,
    call_id: NodeId,
    owner_id: Option<NodeId>,
    has_unconditional_registration: bool,
}

enum ThreeOwnedGeometryDependencyStatus {
    Valid,
    Invalid,
    Unknown,
}

impl Rule for ThreeRequireOwnedGeometryCleanup {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut allocations = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(allocation) = node.kind() else {
                    return None;
                };
                let constructor_name = three_owned_geometry_candidate_api_name(
                    &allocation.callee,
                    ctx,
                    &mut Vec::new(),
                )?;
                constructor_name
                    .ends_with("Geometry")
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
                &THREE_OWNED_GEOMETRY_MODULES,
                &analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_OWNED_GEOMETRY_MODULES,
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
            three_owned_geometry_effect_entries(&analysis, &node_index, ctx, &mut resolution_cache);
        for (allocation_id, _) in allocations {
            let allocation = ctx.nodes().get_node(allocation_id);
            let lifecycle =
                r3f_analyze_owned_root_lifecycle(allocation, &analysis, &node_index, ctx)
                    .map(|lifecycle| ThreeOwnedGeometryLifecycle {
                        access_path: lifecycle.access_path,
                        creation_kind: if lifecycle.is_stable {
                            ThreeOwnedGeometryCreationKind::Stable
                        } else {
                            ThreeOwnedGeometryCreationKind::Reactive
                        },
                        has_eager_hook_allocation: false,
                        owner_id: lifecycle.owner_id,
                        owner_symbol_ids: lifecycle.owner_symbol_ids,
                        resource_symbol_ids: lifecycle.resource_symbol_ids,
                    })
                    .or_else(|| {
                        three_owned_geometry_eager_hook_lifecycle(allocation, &analysis, ctx)
                    })
                    .or_else(|| {
                        three_owned_geometry_direct_lifecycle(allocation, &effect_entries, ctx)
                    });
            let Some(lifecycle) = lifecycle else {
                continue;
            };
            let has_unstable_identity =
                three_owned_geometry_has_unstable_identity(&lifecycle, allocation, ctx);
            if three_owned_geometry_has_direct_disposal(
                allocation,
                &lifecycle,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
            ) {
                continue;
            }
            if lifecycle.has_eager_hook_allocation || has_unstable_identity {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
                continue;
            }
            if three_owned_geometry_has_unknown_transfer(&lifecycle, &analysis, ctx)
                || three_owned_geometry_has_cleanup(
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
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
        }
    }
}

fn three_owned_geometry_candidate_api_name<'a>(
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
            return three_owned_geometry_candidate_api_name(
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

fn three_owned_geometry_direct_lifecycle<'a>(
    allocation: &crate::AstNode<'a>,
    effect_entries: &[ThreeOwnedGeometryEffectEntry],
    ctx: &LintContext<'a>,
) -> Option<ThreeOwnedGeometryLifecycle> {
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
            ThreeOwnedGeometryCreationKind::Effect,
        )
    } else {
        let owner = find_render_phase_component_or_hook(allocation, ctx)?;
        if crate::ast_util::get_enclosing_function(ctx.symbol_declaration(source_symbol_id), ctx)
            .map(crate::AstNode::id)
            != Some(owner.id())
        {
            return None;
        }
        (owner.id(), ThreeOwnedGeometryCreationKind::Render)
    };
    let symbol_ids = r3f_root_collect_alias_symbol_ids(source_symbol_id, ctx);
    Some(ThreeOwnedGeometryLifecycle {
        access_path: R3fOwnedRootAccessPath::Direct,
        creation_kind,
        has_eager_hook_allocation: false,
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

fn three_owned_geometry_eager_hook_lifecycle<'a>(
    allocation: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeOwnedGeometryLifecycle> {
    let mut current = transparent_expression_root(allocation, ctx);
    for parent in ctx.nodes().ancestors(current.id()) {
        if matches!(
            parent.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return None;
        }
        if let AstKind::CallExpression(call_expression) = parent.kind()
            && call_expression
                .arguments
                .first()
                .is_some_and(|argument| argument.span() == current.span())
        {
            let is_ref = r3f_owned_root_react_api_matches(call_expression, "useRef", analysis, ctx);
            let is_state =
                r3f_owned_root_react_api_matches(call_expression, "useState", analysis, ctx);
            if !is_ref && !is_state {
                current = parent;
                continue;
            }
            let owner_id = find_render_phase_component_or_hook(parent, ctx)?.id();
            let untracked_lifecycle = || ThreeOwnedGeometryLifecycle {
                access_path: R3fOwnedRootAccessPath::Direct,
                creation_kind: ThreeOwnedGeometryCreationKind::Stable,
                has_eager_hook_allocation: true,
                owner_id,
                owner_symbol_ids: rustc_hash::FxHashSet::default(),
                resource_symbol_ids: rustc_hash::FxHashSet::default(),
            };
            let call_root = transparent_expression_root(parent, ctx);
            let declaration = ctx.nodes().parent_node(call_root.id());
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return Some(untracked_lifecycle());
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != call_root.span())
            {
                return Some(untracked_lifecycle());
            }
            let binding = if is_ref {
                let Some(binding) = declarator.id.get_binding_identifier() else {
                    return Some(untracked_lifecycle());
                };
                binding
            } else {
                let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                    return Some(untracked_lifecycle());
                };
                let Some(binding) = pattern
                    .elements
                    .first()
                    .and_then(Option::as_ref)
                    .and_then(oxc_ast::ast::BindingPattern::get_binding_identifier)
                else {
                    return Some(untracked_lifecycle());
                };
                binding
            };
            if crate::ast_util::get_enclosing_function(declaration, ctx).map(crate::AstNode::id)
                != Some(owner_id)
            {
                return Some(untracked_lifecycle());
            }
            let owner_symbol_ids = r3f_root_collect_alias_symbol_ids(binding.symbol_id(), ctx);
            let access_path = if is_ref {
                R3fOwnedRootAccessPath::Object("current".to_string())
            } else {
                R3fOwnedRootAccessPath::Direct
            };
            let resource_symbol_ids =
                r3f_owned_root_collect_resource_aliases(&owner_symbol_ids, &access_path, ctx);
            return Some(ThreeOwnedGeometryLifecycle {
                access_path,
                creation_kind: ThreeOwnedGeometryCreationKind::Stable,
                has_eager_hook_allocation: true,
                owner_id,
                owner_symbol_ids,
                resource_symbol_ids,
            });
        }
        current = parent;
    }
    None
}

fn three_owned_geometry_effect_entries<'a>(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<ThreeOwnedGeometryEffectEntry> {
    let mut entries = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !THREE_OWNED_GEOMETRY_EFFECT_HOOK_NAMES
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
        entries.push(ThreeOwnedGeometryEffectEntry {
            callback_id,
            call_id: node.id(),
            owner_id,
            has_unconditional_registration: owner_id.is_some_and(|owner_id| {
                three_owned_geometry_execution_is_guaranteed(node, owner_id, node_index, ctx)
            }),
        });
    }
    entries
}

fn three_owned_geometry_expression_matches(
    expression: &Expression<'_>,
    lifecycle: &ThreeOwnedGeometryLifecycle,
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

fn three_owned_geometry_expression_matches_owner(
    expression: &Expression<'_>,
    lifecycle: &ThreeOwnedGeometryLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    three_owned_geometry_expression_matches(expression, lifecycle, ctx)
        || matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
            |symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id)
        ))
}

fn three_owned_geometry_resource_access<'a, 'b>(
    reference_node: &'b crate::AstNode<'a>,
    reference_symbol_id: SymbolId,
    lifecycle: &ThreeOwnedGeometryLifecycle,
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

fn three_owned_geometry_has_unstable_identity<'a>(
    lifecycle: &ThreeOwnedGeometryLifecycle,
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
                three_owned_geometry_resource_access(reference_node, symbol_id, lifecycle, ctx)
            else {
                continue;
            };
            if r3f_owned_root_access_has_non_allocation_identity_write(
                resource_access,
                allocation,
                ctx,
            ) {
                return true;
            }
        }
    }
    false
}

fn three_owned_geometry_has_unknown_transfer<'a>(
    lifecycle: &ThreeOwnedGeometryLifecycle,
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
                three_owned_geometry_resource_access(reference_node, symbol_id, lifecycle, ctx);
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
                    || three_owned_geometry_is_effect_dependency(reference_root, analysis, ctx)
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
                || three_owned_geometry_is_effect_dependency(resource_root, analysis, ctx)
            {
                continue;
            }
            let is_resource_member_access = parent
                .kind()
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span() == resource_root.span());
            if three_owned_geometry_is_returned_from_owner(resource_root, lifecycle.owner_id, ctx)
                && !is_resource_member_access
            {
                return true;
            }
            if let Some((_, argument_span)) =
                three_owned_geometry_containing_call_argument(resource_root, ctx)
            {
                if argument_span == resource_root.span() {
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
                        if property.init.is_some() && property.span.contains_inclusive(resource_root.span()))
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

fn three_owned_geometry_is_effect_dependency<'a>(
    reference: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((call_expression, argument_span)) =
        three_owned_geometry_containing_call_argument(reference, ctx)
    else {
        return false;
    };
    call_expression
        .arguments
        .get(1)
        .is_some_and(|dependency| dependency.span() == argument_span)
        && THREE_OWNED_GEOMETRY_EFFECT_HOOK_NAMES
            .iter()
            .any(|hook_name| {
                r3f_owned_root_react_api_matches(call_expression, hook_name, analysis, ctx)
            })
}

fn three_owned_geometry_is_returned_from_owner(
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

fn three_owned_geometry_containing_call_argument<'a, 'b>(
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
fn three_owned_geometry_has_direct_disposal<'a>(
    allocation: &crate::AstNode<'a>,
    lifecycle: &ThreeOwnedGeometryLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Some(allocation_function_id) = local_callback_nearest_function_id(allocation.id(), ctx)
    else {
        return false;
    };
    let mut did_dispose = false;
    for_each_analyzed_synchronous_execution_node(
        allocation_function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, is_conditional, _| {
            if did_dispose
                || candidate.span().start <= allocation.span().end
                || local_callback_nearest_function_id(candidate.id(), ctx)
                    != Some(allocation_function_id)
            {
                return;
            }
            did_dispose =
                !is_conditional && three_owned_geometry_is_dispose_call(candidate, lifecycle, ctx);
        },
    );
    did_dispose
}

#[allow(clippy::too_many_arguments)]
fn three_owned_geometry_has_cleanup<'a>(
    allocation: &crate::AstNode<'a>,
    lifecycle: &ThreeOwnedGeometryLifecycle,
    effect_entries: &[ThreeOwnedGeometryEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let mut has_unknown_cleanup = false;
    let allocation_effect_call_id = (lifecycle.creation_kind
        == ThreeOwnedGeometryCreationKind::Effect)
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
        let matching_returns = three_owned_geometry_matching_cleanup_returns(
            effect.callback_id,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        );
        let cleanup_matches = if lifecycle.creation_kind == ThreeOwnedGeometryCreationKind::Effect
            && local_callback_nearest_function_id(allocation.id(), ctx) == Some(effect.callback_id)
        {
            do_nodes_cover_every_path_after_node(
                allocation,
                &matching_returns,
                ctx.nodes().get_node(effect.callback_id),
                ctx,
            )
        } else {
            three_owned_geometry_function_returns_cleanup_on_every_path(
                effect.callback_id,
                &matching_returns,
                node_index,
                ctx,
            )
        };
        if !cleanup_matches {
            continue;
        }
        match three_owned_geometry_dependency_status(effect, lifecycle, ctx) {
            ThreeOwnedGeometryDependencyStatus::Valid => return true,
            ThreeOwnedGeometryDependencyStatus::Unknown => has_unknown_cleanup = true,
            ThreeOwnedGeometryDependencyStatus::Invalid => {}
        }
    }
    has_unknown_cleanup
}

fn three_owned_geometry_dependency_status(
    effect: &ThreeOwnedGeometryEffectEntry,
    lifecycle: &ThreeOwnedGeometryLifecycle,
    ctx: &LintContext<'_>,
) -> ThreeOwnedGeometryDependencyStatus {
    let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(effect.call_id).kind()
    else {
        return ThreeOwnedGeometryDependencyStatus::Invalid;
    };
    let Some(dependency_argument) = call_expression.arguments.get(1) else {
        return ThreeOwnedGeometryDependencyStatus::Valid;
    };
    let Some(dependency_expression) = dependency_argument.as_expression() else {
        return ThreeOwnedGeometryDependencyStatus::Unknown;
    };
    let Expression::ArrayExpression(dependencies) = dependency_expression.get_inner_expression()
    else {
        return ThreeOwnedGeometryDependencyStatus::Unknown;
    };
    if matches!(
        lifecycle.creation_kind,
        ThreeOwnedGeometryCreationKind::Stable | ThreeOwnedGeometryCreationKind::Effect
    ) {
        return ThreeOwnedGeometryDependencyStatus::Valid;
    }
    if dependencies.elements.iter().any(|element| {
        element.as_expression().is_some_and(|expression| {
            three_owned_geometry_expression_matches_owner(expression, lifecycle, ctx)
        })
    }) {
        ThreeOwnedGeometryDependencyStatus::Valid
    } else {
        ThreeOwnedGeometryDependencyStatus::Invalid
    }
}

fn three_owned_geometry_matching_cleanup_returns<'a, 'b>(
    callback_id: NodeId,
    lifecycle: &ThreeOwnedGeometryLifecycle,
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
        if three_owned_geometry_cleanup_expression_matches(
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
        && three_owned_geometry_cleanup_expression_matches(
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

fn three_owned_geometry_cleanup_expression_matches<'a>(
    expression: &Expression<'a>,
    lifecycle: &ThreeOwnedGeometryLifecycle,
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
                        three_owned_geometry_execution_is_guaranteed(
                            candidate,
                            function_id,
                            node_index,
                            ctx,
                        )
                    },
                )
            {
                did_dispose = three_owned_geometry_is_dispose_call(candidate, lifecycle, ctx);
            }
        },
    );
    did_dispose
}

fn three_owned_geometry_is_dispose_call(
    candidate: &crate::AstNode<'_>,
    lifecycle: &ThreeOwnedGeometryLifecycle,
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
    static_member_expression_property_name(member) == Some("dispose")
        && three_owned_geometry_expression_matches(member.object(), lifecycle, ctx)
}

fn three_owned_geometry_function_returns_cleanup_on_every_path(
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

fn three_owned_geometry_execution_is_guaranteed<'a>(
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
