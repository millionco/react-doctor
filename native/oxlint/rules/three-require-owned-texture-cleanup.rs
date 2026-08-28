use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};
use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};

const MESSAGE: &str = "This locally constructed Three.js texture owns GPU resources but has no provable React cleanup. Dispose it when the owning component or hook releases it";
const R3F_ROOT_REACT_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const R3F_OWNED_TEXTURE_EFFECT_HOOK_NAMES: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const R3F_OWNED_TEXTURE_THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireOwnedTextureCleanup;

impl RuleMeta for ThreeRequireOwnedTextureCleanup {
    const NAME: &'static str = "three-require-owned-texture-cleanup";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require cleanup for locally owned Three.js textures.",
    };
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum R3fOwnedTextureCreationKind {
    Effect,
    Reactive,
    Render,
    Stable,
}

struct R3fOwnedTextureLifecycle {
    access_path: R3fOwnedRootAccessPath,
    creation_kind: R3fOwnedTextureCreationKind,
    owner_id: NodeId,
    owner_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
    resource_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
}

struct R3fOwnedTextureEffectEntry {
    callback_id: NodeId,
    call_id: NodeId,
    owner_id: NodeId,
    has_unconditional_registration: bool,
}

enum R3fOwnedTextureDependencyStatus {
    Valid,
    Invalid,
    Unknown,
}

impl Rule for ThreeRequireOwnedTextureCleanup {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if has_capability(ctx, "r3f") {
            return;
        }
        let mut allocation_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(new_expression) = node.kind() else {
                    return None;
                };
                r3f_owned_texture_three_api_candidate_name(
                    &new_expression.callee,
                    ctx,
                    &mut Vec::new(),
                )
                .is_some_and(|constructor_name| constructor_name.ends_with("Texture"))
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if allocation_ids.is_empty() {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        allocation_ids.retain(|&allocation_id| {
            let AstKind::NewExpression(allocation) = ctx.nodes().get_node(allocation_id).kind()
            else {
                return false;
            };
            r3f_owned_texture_three_api_name(&allocation.callee, &analysis, ctx)
                .is_some_and(|constructor_name| constructor_name.ends_with("Texture"))
        });
        if allocation_ids.is_empty() {
            return;
        }
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        let effect_entries =
            r3f_owned_texture_effect_entries(&analysis, &node_index, ctx, &mut resolution_cache);

        for allocation_id in allocation_ids {
            let allocation = ctx.nodes().get_node(allocation_id);
            if r3f_owned_texture_is_eager_hook_allocation(allocation, &analysis, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
                continue;
            }
            let lifecycle =
                r3f_analyze_owned_root_lifecycle(allocation, &analysis, &node_index, ctx)
                    .map(|lifecycle| R3fOwnedTextureLifecycle {
                        access_path: lifecycle.access_path,
                        creation_kind: if lifecycle.is_stable {
                            R3fOwnedTextureCreationKind::Stable
                        } else {
                            R3fOwnedTextureCreationKind::Reactive
                        },
                        owner_id: lifecycle.owner_id,
                        owner_symbol_ids: lifecycle.owner_symbol_ids,
                        resource_symbol_ids: lifecycle.resource_symbol_ids,
                    })
                    .or_else(|| {
                        r3f_owned_texture_direct_lifecycle(allocation, &effect_entries, ctx)
                    });
            let Some(lifecycle) = lifecycle else {
                continue;
            };
            if r3f_owned_texture_has_unstable_identity(&lifecycle, allocation, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
                continue;
            }
            if r3f_owned_texture_has_unknown_transfer(
                &lifecycle,
                &effect_entries,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut assigned_expression_cache,
            ) || r3f_owned_texture_has_direct_disposal(
                allocation,
                &lifecycle,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
            ) || r3f_owned_texture_has_cleanup(
                allocation,
                &lifecycle,
                &effect_entries,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
            ) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
        }
    }
}

fn r3f_owned_texture_three_api_name<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let api_name = r3f_owned_texture_three_api_candidate_name(expression, ctx, &mut Vec::new())?;
    (module_api_reference_matches(
        expression,
        &api_name,
        &R3F_OWNED_TEXTURE_THREE_MODULES,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        expression,
        &api_name,
        &R3F_OWNED_TEXTURE_THREE_MODULES,
        analysis,
        ctx,
    ))
    .then_some(api_name)
}

fn r3f_owned_texture_three_api_candidate_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return static_member_expression_property_name(member_expression).map(str::to_string);
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
            return r3f_owned_texture_three_api_candidate_name(
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

fn r3f_owned_texture_direct_lifecycle<'a>(
    allocation: &crate::AstNode<'a>,
    effect_entries: &[R3fOwnedTextureEffectEntry],
    ctx: &LintContext<'a>,
) -> Option<R3fOwnedTextureLifecycle> {
    let source_symbol_id = r3f_owned_texture_direct_binding_symbol_id(allocation, ctx)?;
    let allocation_function_id = local_callback_nearest_function_id(allocation.id(), ctx)?;
    if is_node_conditionally_executed(allocation, allocation_function_id, ctx) {
        return None;
    }
    let allocation_effect = effect_entries
        .iter()
        .find(|entry| entry.callback_id == allocation_function_id);
    let (owner_id, creation_kind) = if let Some(effect) = allocation_effect {
        (effect.owner_id, R3fOwnedTextureCreationKind::Effect)
    } else {
        let owner = find_render_phase_component_or_hook(allocation, ctx)?;
        if crate::ast_util::get_enclosing_function(ctx.symbol_declaration(source_symbol_id), ctx)
            .map(crate::AstNode::id)
            != Some(owner.id())
        {
            return None;
        }
        (owner.id(), R3fOwnedTextureCreationKind::Render)
    };
    let owner_symbol_ids = r3f_root_collect_alias_symbol_ids(source_symbol_id, ctx);
    Some(R3fOwnedTextureLifecycle {
        access_path: R3fOwnedRootAccessPath::Direct,
        creation_kind,
        owner_id,
        resource_symbol_ids: owner_symbol_ids.clone(),
        owner_symbol_ids,
    })
}

fn r3f_owned_texture_direct_binding_symbol_id<'a>(
    allocation: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
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
    declarator
        .id
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
}

fn r3f_owned_texture_is_eager_hook_allocation<'a>(
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

fn r3f_owned_texture_effect_entries<'a>(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<R3fOwnedTextureEffectEntry> {
    let mut entries = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !R3F_OWNED_TEXTURE_EFFECT_HOOK_NAMES.iter().any(|hook_name| {
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
        let Some(callback_id) = exact_local_function_id_including_generators(
            callback_expression,
            ctx,
            &mut Vec::new(),
            resolution_cache,
        ) else {
            continue;
        };
        let Some(owner) = find_render_phase_component_or_hook(node, ctx) else {
            continue;
        };
        entries.push(R3fOwnedTextureEffectEntry {
            callback_id,
            call_id: node.id(),
            owner_id: owner.id(),
            has_unconditional_registration: r3f_owned_texture_execution_is_guaranteed(
                node,
                owner.id(),
                node_index,
                ctx,
            ),
        });
    }
    entries
}

fn r3f_owned_texture_expression_matches(
    expression: &Expression<'_>,
    lifecycle: &R3fOwnedTextureLifecycle,
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

fn r3f_owned_texture_expression_matches_owner(
    expression: &Expression<'_>,
    lifecycle: &R3fOwnedTextureLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    if r3f_owned_texture_expression_matches(expression, lifecycle, ctx) {
        return true;
    }
    matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
    if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
        |symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id)
    ))
}

fn r3f_owned_texture_resource_access<'a, 'b>(
    reference_node: &'b crate::AstNode<'a>,
    reference_symbol_id: SymbolId,
    lifecycle: &R3fOwnedTextureLifecycle,
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

fn r3f_owned_texture_has_unstable_identity<'a>(
    lifecycle: &R3fOwnedTextureLifecycle,
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
                r3f_owned_texture_resource_access(reference_node, symbol_id, lifecycle, ctx)
            else {
                continue;
            };
            let current = transparent_expression_root(resource_access, ctx);
            for parent in ctx.nodes().ancestors(current.id()) {
                match parent.kind() {
                    AstKind::AssignmentExpression(assignment) => {
                        if !assignment.left.span().contains_inclusive(current.span()) {
                            break;
                        }
                        if assignment.right.get_inner_expression().span() != allocation_root.span()
                        {
                            return true;
                        }
                        break;
                    }
                    AstKind::UpdateExpression(update) => {
                        if update.argument.span().contains_inclusive(current.span()) {
                            return true;
                        }
                        break;
                    }
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => break,
                    _ => break,
                }
            }
        }
    }
    false
}

#[allow(clippy::too_many_arguments)]
fn r3f_owned_texture_has_unknown_transfer<'a>(
    lifecycle: &R3fOwnedTextureLifecycle,
    effect_entries: &[R3fOwnedTextureEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
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
                r3f_owned_texture_resource_access(reference_node, symbol_id, lifecycle, ctx);
            if resource_access.is_none() {
                if matches!(lifecycle.access_path, R3fOwnedRootAccessPath::Direct)
                    || !lifecycle.owner_symbol_ids.contains(&symbol_id)
                {
                    continue;
                }
                let reference_root = transparent_expression_root(reference_node, ctx);
                let parent = ctx.nodes().parent_node(reference_root.id());
                if matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|initializer| initializer.span() == reference_root.span()))
                    || r3f_owned_texture_is_effect_dependency(reference_root, effect_entries, ctx)
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
            }
            let resource_access = resource_access.expect("resource access");
            let resource_root = transparent_expression_root(resource_access, ctx);
            let parent = ctx.nodes().parent_node(resource_root.id());
            if matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| initializer.span() == resource_root.span())
                    && declarator.id.get_binding_identifier().is_some())
            {
                continue;
            }
            if r3f_owned_texture_is_effect_dependency(resource_root, effect_entries, ctx)
                || r3f_owned_texture_is_borrowed_by_material(
                    resource_root,
                    analysis,
                    node_index,
                    ctx,
                    resolution_cache,
                    assigned_expression_cache,
                )
            {
                continue;
            }
            if r3f_owned_texture_crosses_custom_jsx_boundary(resource_root, ctx) {
                return true;
            }
            let is_resource_member_access = parent
                .kind()
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span() == resource_root.span());
            if r3f_owned_texture_is_returned_from_owner(resource_root, lifecycle.owner_id, ctx)
                && !is_resource_member_access
                && !r3f_owned_texture_is_inside_jsx(resource_root, ctx)
            {
                return true;
            }
            if r3f_owned_texture_is_direct_call_argument(resource_root, ctx) {
                return true;
            }
            if is_resource_member_access {
                continue;
            }
            let mut current = resource_root;
            for ancestor in ctx.nodes().ancestors(resource_root.id()) {
                if matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    break;
                }
                let is_wrapping_transfer = matches!(
                    ancestor.kind(),
                    AstKind::AssignmentExpression(assignment)
                        if assignment.right.span() == current.span()
                ) || matches!(ancestor.kind(), AstKind::ObjectProperty(property)
                    if property.value.span() == current.span())
                    || matches!(ancestor.kind(), AstKind::ArrayExpression(_));
                if is_wrapping_transfer {
                    if matches!(
                        ancestor.kind(),
                        AstKind::ObjectProperty(_) | AstKind::ArrayExpression(_)
                    ) && r3f_owned_texture_is_nested_in_owned_memo_jsx(
                        resource_root,
                        lifecycle.owner_id,
                        analysis,
                        ctx,
                    ) {
                        break;
                    }
                    return true;
                }
                current = ancestor;
            }
        }
    }
    false
}

fn r3f_owned_texture_is_effect_dependency(
    reference: &crate::AstNode<'_>,
    effect_entries: &[R3fOwnedTextureEffectEntry],
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

fn r3f_owned_texture_is_returned_from_owner(
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

fn r3f_owned_texture_is_direct_call_argument(
    reference: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
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

fn r3f_owned_texture_is_inside_jsx(reference: &crate::AstNode<'_>, ctx: &LintContext<'_>) -> bool {
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

fn r3f_owned_texture_crosses_custom_jsx_boundary<'a>(
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

fn r3f_owned_texture_is_nested_in_owned_memo_jsx<'a>(
    reference: &crate::AstNode<'a>,
    owner_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(callback_id) = local_callback_nearest_function_id(reference.id(), ctx) else {
        return false;
    };
    if callback_id == owner_id {
        return false;
    }
    let callback = ctx.nodes().get_node(callback_id);
    let callback_root = transparent_expression_root(callback, ctx);
    let memo_call_node = ctx.nodes().parent_node(callback_root.id());
    let AstKind::CallExpression(memo_call) = memo_call_node.kind() else {
        return false;
    };
    if memo_call
        .arguments
        .first()
        .is_none_or(|argument| argument.span() != callback_root.span())
        || !r3f_owned_root_react_api_matches(memo_call, "useMemo", analysis, ctx)
        || find_render_phase_component_or_hook(memo_call_node, ctx).map(crate::AstNode::id)
            != Some(owner_id)
    {
        return false;
    }
    let memo_root = transparent_expression_root(memo_call_node, ctx);
    let declaration = ctx.nodes().parent_node(memo_root.id());
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != memo_root.span())
    {
        return false;
    }
    let Some(binding) = declarator.id.get_binding_identifier() else {
        return false;
    };
    let references = ctx
        .scoping()
        .get_resolved_references(binding.symbol_id())
        .collect::<Vec<_>>();
    !references.is_empty()
        && references.iter().all(|memo_reference| {
            let memo_reference_node = ctx.nodes().get_node(memo_reference.node_id());
            r3f_owned_texture_is_inside_jsx(memo_reference_node, ctx)
                && !r3f_owned_texture_crosses_custom_jsx_boundary(memo_reference_node, ctx)
        })
}

fn r3f_owned_texture_is_borrowed_by_material<'a>(
    reference: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    let reference_root = transparent_expression_root(reference, ctx);
    let parent = ctx.nodes().parent_node(reference_root.id());
    if let AstKind::AssignmentExpression(assignment) = parent.kind()
        && assignment.right.span() == reference_root.span()
        && let Some(target) = assignment.left.as_member_expression().or_else(|| {
            assignment
                .left
                .get_expression()?
                .get_inner_expression()
                .as_member_expression()
        })
        && r3f_owned_texture_is_material_texture_property(static_member_expression_property_name(
            target,
        ))
    {
        return r3f_owned_texture_expression_resolves_to_material(
            target.object(),
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            &mut Vec::new(),
        );
    }
    let AstKind::ObjectProperty(property) = parent.kind() else {
        return false;
    };
    if property.value.span() != reference_root.span()
        || !r3f_owned_texture_is_material_texture_property(property.key.static_name().as_deref())
    {
        return false;
    }
    let options_node = ctx.nodes().parent_node(parent.id());
    if !matches!(options_node.kind(), AstKind::ObjectExpression(_)) {
        return false;
    }
    let allocation_node = ctx.nodes().parent_node(options_node.id());
    let AstKind::NewExpression(allocation) = allocation_node.kind() else {
        return false;
    };
    allocation
        .arguments
        .iter()
        .any(|argument| argument.span() == options_node.span())
        && r3f_owned_texture_is_material_allocation(allocation, analysis, ctx)
}

fn r3f_owned_texture_is_material_texture_property(property_name: Option<&str>) -> bool {
    property_name.is_some_and(|property_name| {
        property_name == "map" || property_name == "matcap" || property_name.ends_with("Map")
    })
}

fn r3f_owned_texture_is_material_allocation<'a>(
    allocation: &oxc_ast::ast::NewExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    r3f_owned_texture_three_api_name(&allocation.callee, analysis, ctx)
        .is_some_and(|constructor_name| constructor_name.ends_with("Material"))
}

#[allow(clippy::too_many_arguments)]
fn r3f_owned_texture_expression_resolves_to_material<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return r3f_owned_texture_is_material_allocation(allocation, analysis, ctx);
    }
    if let Some(current_member) = expression.as_member_expression()
        && static_member_expression_property_name(current_member) == Some("current")
    {
        let Expression::Identifier(ref_identifier) = current_member.object().get_inner_expression()
        else {
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
        let Some(Expression::CallExpression(use_ref_call)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        if !r3f_owned_root_react_api_matches(use_ref_call, "useRef", analysis, ctx) {
            return false;
        }
        if use_ref_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_some_and(|initial_value| {
                matches!(initial_value.get_inner_expression(), Expression::NewExpression(allocation)
                    if r3f_owned_texture_is_material_allocation(allocation, analysis, ctx))
            })
        {
            return true;
        }
        return ctx
            .scoping()
            .get_resolved_references(ref_symbol_id)
            .any(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let reference_root = transparent_expression_root(reference_node, ctx);
                let member_node = ctx.nodes().parent_node(reference_root.id());
                let assignment_node = ctx.nodes().parent_node(member_node.id());
                matches!(member_node.kind().as_member_expression_kind(), Some(member)
                    if member.object().span() == reference_root.span()
                        && member.static_property_name().as_deref() == Some("current"))
                    && matches!(assignment_node.kind(), AstKind::AssignmentExpression(assignment)
                        if assignment.left.span() == member_node.span()
                            && matches!(assignment.right.get_inner_expression(), Expression::NewExpression(allocation)
                                if r3f_owned_texture_is_material_allocation(allocation, analysis, ctx)))
            });
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let initializer = if let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = &declarator.id
        && pattern
            .elements
            .first()
            .and_then(Option::as_ref)
            .is_some_and(|element| {
                element
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
            }) {
        let Some(Expression::CallExpression(use_state_call)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        if !r3f_owned_root_react_api_matches(use_state_call, "useState", analysis, ctx) {
            return false;
        }
        use_state_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
    } else {
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return false;
        }
        declarator.init.as_ref()
    };
    let Some(initializer) = initializer else {
        return false;
    };
    if r3f_owned_texture_expression_resolves_to_material(
        initializer,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        assigned_expression_cache,
        visited_symbol_ids,
    ) {
        return true;
    }
    let Expression::CallExpression(wrapper_call) = initializer.get_inner_expression() else {
        return r3f_owned_texture_function_creates_material(
            initializer,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
        );
    };
    if !r3f_owned_root_react_api_matches(wrapper_call, "useMemo", analysis, ctx) {
        return false;
    }
    wrapper_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|callback| {
            r3f_owned_texture_function_creates_material(
                callback,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
            )
        })
}

fn r3f_owned_texture_function_creates_material<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    let Some(function_id) = exact_local_function_id_including_generators(
        expression,
        ctx,
        &mut Vec::new(),
        resolution_cache,
    ) else {
        return false;
    };
    r3f_owned_texture_function_returns_material_on_every_path(
        function_id,
        analysis,
        node_index,
        ctx,
        assigned_expression_cache,
        &mut Vec::new(),
        &mut Vec::new(),
    )
}

#[allow(clippy::too_many_arguments)]
fn r3f_owned_texture_function_returns_material_on_every_path<'a>(
    function_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<NodeId>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    if visited_function_ids.contains(&function_id) {
        return false;
    }
    visited_function_ids.push(function_id);
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        let matches = r3f_owned_texture_material_expression_matches(
            expression,
            analysis,
            node_index,
            ctx,
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
        let AstKind::ReturnStatement(return_statement) = ctx.nodes().get_node(candidate_id).kind()
        else {
            continue;
        };
        if let Some(argument) = return_statement.argument.as_ref() {
            returned_expressions.push(argument);
        } else {
            has_bare_return = true;
        }
    }
    let matches = !has_bare_return
        && body_statements
            .iter()
            .any(|statement| statement_always_exits(statement))
        && !returned_expressions.is_empty()
        && returned_expressions.into_iter().all(|returned_expression| {
            r3f_owned_texture_material_expression_matches(
                returned_expression,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        });
    visited_function_ids.pop();
    matches
}

#[allow(clippy::too_many_arguments)]
fn r3f_owned_texture_material_expression_matches<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<NodeId>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return r3f_owned_texture_is_material_allocation(allocation, analysis, ctx);
    }
    let expression_id = expression.node_id();
    if visited_expression_ids.contains(&expression_id) {
        return false;
    }
    visited_expression_ids.push(expression_id);
    let matches = match expression {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                visited_expression_ids.pop();
                return false;
            };
            let assigned_expressions = r3f_analyzed_possible_assigned_expressions(
                identifier,
                symbol_id,
                ctx,
                assigned_expression_cache,
            );
            !assigned_expressions.is_empty()
                && assigned_expressions.into_iter().all(|assigned_expression| {
                    !matches!(
                        assigned_expression.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) && r3f_owned_texture_material_expression_matches(
                        assigned_expression,
                        analysis,
                        node_index,
                        ctx,
                        assigned_expression_cache,
                        visited_expression_ids,
                        visited_function_ids,
                    )
                })
        }
        Expression::CallExpression(call_expression) if call_expression.arguments.is_empty() => {
            r3f_analyzed_zero_argument_helper_id(&call_expression.callee, ctx).is_some_and(
                |function_id| {
                    r3f_owned_texture_function_returns_material_on_every_path(
                        function_id,
                        analysis,
                        node_index,
                        ctx,
                        assigned_expression_cache,
                        visited_expression_ids,
                        visited_function_ids,
                    )
                },
            )
        }
        Expression::ConditionalExpression(conditional_expression) => {
            r3f_owned_texture_material_expression_matches(
                &conditional_expression.consequent,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) && r3f_owned_texture_material_expression_matches(
                &conditional_expression.alternate,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        }
        Expression::LogicalExpression(logical_expression) => {
            r3f_owned_texture_material_expression_matches(
                &logical_expression.left,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) && r3f_owned_texture_material_expression_matches(
                &logical_expression.right,
                analysis,
                node_index,
                ctx,
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

#[allow(clippy::too_many_arguments)]
fn r3f_owned_texture_has_direct_disposal<'a>(
    allocation: &crate::AstNode<'a>,
    lifecycle: &R3fOwnedTextureLifecycle,
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
                !is_conditional && r3f_owned_texture_is_dispose_call(candidate, lifecycle, ctx);
        },
    );
    did_dispose
}

#[allow(clippy::too_many_arguments)]
fn r3f_owned_texture_has_cleanup<'a>(
    allocation: &crate::AstNode<'a>,
    lifecycle: &R3fOwnedTextureLifecycle,
    effect_entries: &[R3fOwnedTextureEffectEntry],
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
        let matching_returns = r3f_owned_texture_matching_cleanup_returns(
            effect.callback_id,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        );
        let cleanup_matches = if lifecycle.creation_kind == R3fOwnedTextureCreationKind::Effect
            && local_callback_nearest_function_id(allocation.id(), ctx) == Some(effect.callback_id)
        {
            do_nodes_cover_every_path_after_node(
                allocation,
                &matching_returns,
                ctx.nodes().get_node(effect.callback_id),
                ctx,
            )
        } else {
            r3f_owned_texture_function_returns_cleanup_on_every_path(
                effect.callback_id,
                &matching_returns,
                node_index,
                ctx,
            )
        };
        if !cleanup_matches {
            continue;
        }
        match r3f_owned_texture_dependency_status(effect, lifecycle, ctx) {
            R3fOwnedTextureDependencyStatus::Valid => return true,
            R3fOwnedTextureDependencyStatus::Unknown => has_unknown_cleanup = true,
            R3fOwnedTextureDependencyStatus::Invalid => {}
        }
    }
    has_unknown_cleanup
}

fn r3f_owned_texture_dependency_status(
    effect: &R3fOwnedTextureEffectEntry,
    lifecycle: &R3fOwnedTextureLifecycle,
    ctx: &LintContext<'_>,
) -> R3fOwnedTextureDependencyStatus {
    let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(effect.call_id).kind()
    else {
        return R3fOwnedTextureDependencyStatus::Invalid;
    };
    let Some(dependency_argument) = call_expression.arguments.get(1) else {
        return R3fOwnedTextureDependencyStatus::Valid;
    };
    let Some(dependency_expression) = dependency_argument.as_expression() else {
        return R3fOwnedTextureDependencyStatus::Unknown;
    };
    let Expression::ArrayExpression(dependencies) = dependency_expression.get_inner_expression()
    else {
        return R3fOwnedTextureDependencyStatus::Unknown;
    };
    if matches!(
        lifecycle.creation_kind,
        R3fOwnedTextureCreationKind::Stable | R3fOwnedTextureCreationKind::Effect
    ) {
        return R3fOwnedTextureDependencyStatus::Valid;
    }
    if dependencies.elements.iter().any(|element| {
        element.as_expression().is_some_and(|expression| {
            r3f_owned_texture_expression_matches_owner(expression, lifecycle, ctx)
        })
    }) {
        R3fOwnedTextureDependencyStatus::Valid
    } else {
        R3fOwnedTextureDependencyStatus::Invalid
    }
}

fn r3f_owned_texture_matching_cleanup_returns<'a, 'b>(
    callback_id: NodeId,
    lifecycle: &R3fOwnedTextureLifecycle,
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
        if r3f_owned_texture_cleanup_expression_matches(
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
        && r3f_owned_texture_cleanup_expression_matches(
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

fn r3f_owned_texture_cleanup_expression_matches<'a>(
    expression: &Expression<'a>,
    lifecycle: &R3fOwnedTextureLifecycle,
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
                        r3f_owned_texture_execution_is_guaranteed(
                            candidate,
                            function_id,
                            node_index,
                            ctx,
                        )
                    },
                )
            {
                did_dispose = r3f_owned_texture_is_dispose_call(candidate, lifecycle, ctx);
            }
        },
    );
    did_dispose
}

fn r3f_owned_texture_is_dispose_call(
    candidate: &crate::AstNode<'_>,
    lifecycle: &R3fOwnedTextureLifecycle,
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
        && r3f_owned_texture_expression_matches(member.object(), lifecycle, ctx)
}

fn r3f_owned_texture_function_returns_cleanup_on_every_path(
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

fn r3f_owned_texture_execution_is_guaranteed<'a>(
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
