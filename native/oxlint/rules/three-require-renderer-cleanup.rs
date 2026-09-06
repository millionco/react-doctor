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
const THREE_RENDERER_EFFECT_HOOK_NAMES: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const THREE_RENDERER_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDERER_BORROWING_METHOD_NAMES: [&str; 0] = [];
const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const MESSAGE: &str = "This component-owned renderer is not fully released. Dispose it and stop its setAnimationLoop or requestAnimationFrame work in matching React cleanup";

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireRendererCleanup;

impl RuleMeta for ThreeRequireRendererCleanup {
    const NAME: &'static str = "three-require-renderer-cleanup";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require complete cleanup for component-owned Three.js renderers.",
    };
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ThreeRendererCreationKind {
    Effect,
    Reactive,
    Render,
    Stable,
}

struct ThreeRendererLifecycle {
    access_path: R3fOwnedRootAccessPath,
    creation_kind: ThreeRendererCreationKind,
    has_eager_hook_allocation: bool,
    owner_id: NodeId,
    owner_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
    resource_symbol_ids: rustc_hash::FxHashSet<SymbolId>,
}

struct ThreeRendererEffectEntry {
    callback_id: NodeId,
    call_id: NodeId,
    owner_id: Option<NodeId>,
    has_unconditional_registration: bool,
    is_first_callback_registration: bool,
}

enum ThreeRendererDependencyStatus {
    Valid,
    Invalid,
    Unknown,
}

#[derive(Clone, Copy)]
enum ThreeRendererAnimationFrameHandle {
    Symbol(SymbolId),
    Ref(SymbolId),
}

impl Rule for ThreeRequireRendererCleanup {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut allocations = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(allocation) = node.kind() else {
                    return None;
                };
                let constructor_name =
                    three_renderer_candidate_api_name(&allocation.callee, ctx, &mut Vec::new())?;
                matches!(
                    constructor_name.as_str(),
                    "WebGLRenderer" | "WebGPURenderer"
                )
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
            three_renderer_api_reference_has_canonical_wrapper_shape(
                &allocation.callee,
                ctx,
                &mut Vec::new(),
            ) && (module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_RENDERER_MODULES,
                &analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_RENDERER_MODULES,
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
            three_renderer_effect_entries(&analysis, &node_index, ctx, &mut resolution_cache);
        for (allocation_id, _) in allocations {
            let allocation = ctx.nodes().get_node(allocation_id);
            let lifecycle =
                r3f_analyze_owned_root_lifecycle(allocation, &analysis, &node_index, ctx)
                    .map(|lifecycle| ThreeRendererLifecycle {
                        access_path: lifecycle.access_path,
                        creation_kind: if lifecycle.is_stable {
                            ThreeRendererCreationKind::Stable
                        } else {
                            ThreeRendererCreationKind::Reactive
                        },
                        has_eager_hook_allocation: false,
                        owner_id: lifecycle.owner_id,
                        owner_symbol_ids: lifecycle.owner_symbol_ids,
                        resource_symbol_ids: lifecycle.resource_symbol_ids,
                    })
                    .or_else(|| three_renderer_eager_hook_lifecycle(allocation, &analysis, ctx))
                    .or_else(|| three_renderer_direct_lifecycle(allocation, &effect_entries, ctx));
            let Some(lifecycle) = lifecycle else {
                continue;
            };
            if three_renderer_is_supplied_to_r3f_canvas(
                &lifecycle,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) {
                continue;
            }
            let has_unstable_identity =
                three_renderer_has_unstable_identity(&lifecycle, allocation, ctx);
            if lifecycle.has_eager_hook_allocation || has_unstable_identity {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
                continue;
            }
            if three_renderer_has_unknown_transfer(&lifecycle, &analysis, ctx) {
                continue;
            }
            let has_dispose_cleanup = three_renderer_has_cleanup(
                allocation,
                &lifecycle,
                &effect_entries,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                "dispose",
                false,
            );
            let starts_animation_loop =
                three_renderer_has_method_call(&lifecycle, "setAnimationLoop", false, ctx);
            let has_animation_loop_cleanup = !starts_animation_loop
                || three_renderer_has_cleanup(
                    allocation,
                    &lifecycle,
                    &effect_entries,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    "setAnimationLoop",
                    true,
                );
            let has_animation_frame_cleanup = three_renderer_has_animation_frame_cleanup(
                allocation,
                &lifecycle,
                &effect_entries,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
            );
            if has_dispose_cleanup && has_animation_loop_cleanup && has_animation_frame_cleanup {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span()));
        }
    }
}

fn three_renderer_has_method_call(
    lifecycle: &ThreeRendererLifecycle,
    method_name: &str,
    requires_null_argument: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let owner_span = ctx.nodes().get_node(lifecycle.owner_id).span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        let Some(member) = call_expression.callee.as_member_expression() else {
            return false;
        };
        owner_span.contains_inclusive(candidate.span())
            && three_renderer_static_member_property_name(member) == Some(method_name)
            && three_renderer_expression_matches(member.object(), lifecycle, ctx)
            && (requires_null_argument
                || !matches!(
                    call_expression
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression),
                    Some(Expression::NullLiteral(_))
                ))
    })
}

fn three_renderer_is_supplied_to_r3f_canvas<'a>(
    lifecycle: &ThreeRendererLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let owner_span = ctx.nodes().get_node(lifecycle.owner_id).span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::JSXAttribute(attribute) = candidate.kind() else {
            return false;
        };
        if !owner_span.contains_inclusive(candidate.span()) {
            return false;
        }
        let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            return false;
        };
        let parent = ctx.nodes().parent_node(candidate.id());
        let AstKind::JSXOpeningElement(opening_element) = parent.kind() else {
            return false;
        };
        let Some(module_source) = R3F_PUBLIC_MODULES.iter().copied().find(|module_source| {
            jsx_module_api_reference_matches(
                &opening_element.name,
                "Canvas",
                &[*module_source],
                analysis,
                ctx,
            )
        }) else {
            return false;
        };
        if attribute_name.name != "gl"
            && !(attribute_name.name == "renderer" && module_source == "@react-three/fiber/webgpu")
        {
            return false;
        }
        let Some(expression) = jsx_attribute_expression(attribute) else {
            return false;
        };
        if three_renderer_expression_matches(expression, lifecycle, ctx) {
            return true;
        }
        let Some(function_id) =
            exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
        else {
            return false;
        };
        three_renderer_factory_returns_renderer(function_id, lifecycle, ctx)
    })
}

fn three_renderer_factory_returns_renderer(
    function_id: NodeId,
    lifecycle: &ThreeRendererLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        return three_renderer_expression_matches(expression, lifecycle, ctx);
    }
    let mut return_count = 0;
    let mut matching_return_count = 0;
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
            continue;
        }
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        return_count += 1;
        if return_statement
            .argument
            .as_ref()
            .is_some_and(|expression| three_renderer_expression_matches(expression, lifecycle, ctx))
        {
            matching_return_count += 1;
        }
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
    return_count > 0
        && matching_return_count == return_count
        && body_statements.is_some_and(|statements| statements.iter().any(statement_always_exits))
}

#[allow(clippy::too_many_arguments)]
fn three_renderer_has_animation_frame_cleanup<'a>(
    allocation: &crate::AstNode<'a>,
    lifecycle: &ThreeRendererLifecycle,
    effect_entries: &[ThreeRendererEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let owner_span = ctx.nodes().get_node(lifecycle.owner_id).span();
    let render_function_ids = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return None;
            };
            let member = call_expression.callee.as_member_expression()?;
            (owner_span.contains_inclusive(candidate.span())
                && matches!(
                    three_renderer_static_member_property_name(member),
                    Some("render" | "renderAsync")
                )
                && three_renderer_expression_matches(member.object(), lifecycle, ctx))
            .then(|| local_callback_nearest_function_id(candidate.id(), ctx))
            .flatten()
        })
        .collect::<rustc_hash::FxHashSet<_>>();
    if render_function_ids.is_empty() {
        return true;
    }
    let registrations = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            matches!(candidate.kind(), AstKind::CallExpression(call_expression)
                if three_renderer_is_global_browser_call(call_expression, "requestAnimationFrame", ctx))
                && local_callback_nearest_function_id(candidate.id(), ctx)
                    .is_some_and(|function_id| render_function_ids.contains(&function_id))
        })
        .collect::<Vec<_>>();
    registrations.into_iter().all(|registration| {
        let Some(handle) = three_renderer_animation_frame_handle(registration, analysis, ctx)
        else {
            return false;
        };
        if three_renderer_animation_frame_handle_is_overwritten(
            registration,
            handle,
            lifecycle,
            analysis,
            ctx,
        ) {
            return false;
        }
        three_renderer_cleanup_cancels_animation_frame(
            allocation,
            handle,
            lifecycle,
            effect_entries,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        )
    })
}

fn three_renderer_is_global_browser_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    function_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    match three_renderer_strip_parentheses(&call.callee) {
        Expression::Identifier(identifier) => {
            identifier.name == function_name
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            three_renderer_static_member_property_name(member) == Some(function_name)
                && matches!(three_renderer_strip_parentheses(member.object()), Expression::Identifier(identifier)
                    if matches!(identifier.name.as_str(), "window" | "globalThis")
                        && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }),
    }
}

fn three_renderer_animation_frame_handle<'a>(
    call: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeRendererAnimationFrameHandle> {
    let call_root = transparent_expression_root(call, ctx);
    let parent = ctx.nodes().parent_node(call_root.id());
    if let AstKind::VariableDeclarator(declarator) = parent.kind()
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| initializer.span() == call_root.span())
    {
        return Some(ThreeRendererAnimationFrameHandle::Symbol(
            declarator.id.get_binding_identifier()?.symbol_id(),
        ));
    }
    let AstKind::AssignmentExpression(assignment) = parent.kind() else {
        return None;
    };
    if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
        || assignment.right.span() != call_root.span()
    {
        return None;
    }
    if let Some(Expression::Identifier(identifier)) = assignment.left.get_expression() {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .map(ThreeRendererAnimationFrameHandle::Symbol);
    }
    let member = assignment.left.as_member_expression()?;
    three_renderer_react_ref_symbol(member, analysis, ctx)
        .map(ThreeRendererAnimationFrameHandle::Ref)
}

fn three_renderer_react_ref_symbol(
    member: &oxc_ast::ast::MemberExpression<'_>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    if three_renderer_static_member_property_name(member) != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = three_renderer_strip_parentheses(member.object())
    else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let symbol_id = three_renderer_const_identifier_root_symbol(symbol_id, ctx)?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let Expression::CallExpression(call) =
        three_renderer_strip_parentheses(declarator.init.as_ref()?)
    else {
        return None;
    };
    three_renderer_react_api_matches(call, "useRef", analysis, ctx).then_some(symbol_id)
}

fn three_renderer_expression_matches_frame_handle(
    expression: &Expression<'_>,
    handle: ThreeRendererAnimationFrameHandle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    match handle {
        ThreeRendererAnimationFrameHandle::Symbol(symbol_id) => {
            matches!(three_renderer_strip_parentheses(expression), Expression::Identifier(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(symbol_id))
        }
        ThreeRendererAnimationFrameHandle::Ref(symbol_id) => {
            three_renderer_strip_parentheses(expression)
                .as_member_expression()
                .and_then(|member| three_renderer_react_ref_symbol(member, analysis, ctx))
                == Some(symbol_id)
        }
    }
}

fn three_renderer_animation_frame_handle_is_overwritten<'a>(
    registration: &crate::AstNode<'a>,
    handle: ThreeRendererAnimationFrameHandle,
    lifecycle: &ThreeRendererLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let registration_span = transparent_expression_root(registration, ctx).span();
    let owner_span = ctx.nodes().get_node(lifecycle.owner_id).span();
    ctx.nodes().iter().any(|candidate| {
        if !owner_span.contains_inclusive(candidate.span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                assignment.left.get_expression().is_some_and(|target| {
                    three_renderer_expression_matches_frame_handle(target, handle, analysis, ctx)
                }) && assignment.right.span() != registration_span
            }
            AstKind::UpdateExpression(update) => {
                update.argument.get_expression().is_some_and(|target| {
                    three_renderer_expression_matches_frame_handle(target, handle, analysis, ctx)
                })
            }
            _ => false,
        }
    })
}

fn three_renderer_cleanup_cancels_animation_frame<'a>(
    allocation: &crate::AstNode<'a>,
    handle: ThreeRendererAnimationFrameHandle,
    lifecycle: &ThreeRendererLifecycle,
    effect_entries: &[ThreeRendererEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    effect_entries.iter().any(|effect| {
        if !three_renderer_effect_is_cleanup_source(allocation, lifecycle, effect, ctx)
            || matches!(
                three_renderer_dependency_status(effect, lifecycle, ctx),
                ThreeRendererDependencyStatus::Invalid
            )
        {
            return false;
        }
        let matching_returns = three_renderer_matching_animation_frame_cleanup_returns(
            effect.callback_id,
            handle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
        );
        if lifecycle.creation_kind == ThreeRendererCreationKind::Effect {
            do_nodes_cover_every_path_after_node(
                allocation,
                &matching_returns,
                ctx.nodes().get_node(effect.callback_id),
                ctx,
            )
        } else {
            three_renderer_function_returns_cleanup_on_every_path(
                effect.callback_id,
                &matching_returns,
                node_index,
                ctx,
            )
        }
    })
}

fn three_renderer_matching_animation_frame_cleanup_returns<'a, 'ctx>(
    callback_id: NodeId,
    handle: ThreeRendererAnimationFrameHandle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &'ctx LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<&'ctx crate::AstNode<'a>> {
    let mut matching_returns = Vec::new();
    for &candidate_id in node_index.node_ids(callback_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if return_statement
            .argument
            .as_ref()
            .is_some_and(|expression| {
                three_renderer_cleanup_expression_cancels_animation_frame(
                    expression,
                    handle,
                    analysis,
                    node_index,
                    ctx,
                    resolution_cache,
                )
            })
        {
            matching_returns.push(candidate);
        }
    }
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = function.get_expression()
        && three_renderer_cleanup_expression_cancels_animation_frame(
            expression,
            handle,
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

fn three_renderer_cleanup_expression_cancels_animation_frame<'a>(
    expression: &Expression<'a>,
    handle: ThreeRendererAnimationFrameHandle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Some(cleanup_id) =
        exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
    else {
        return false;
    };
    let mut did_cancel = false;
    for_each_analyzed_synchronous_execution_node(
        cleanup_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return;
            };
            if !did_cancel
                && three_renderer_is_global_browser_call(call, "cancelAnimationFrame", ctx)
                && call
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .is_some_and(|argument| {
                        three_renderer_expression_matches_frame_handle(
                            argument, handle, analysis, ctx,
                        )
                    })
            {
                did_cancel = true;
            }
        },
    );
    did_cancel
}

fn three_renderer_candidate_api_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = three_renderer_strip_parentheses(expression);
    if let Some(member) = expression.as_member_expression() {
        return three_renderer_static_member_property_name(member).map(str::to_string);
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
            return three_renderer_candidate_api_name(
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

fn three_renderer_direct_lifecycle<'a>(
    allocation: &crate::AstNode<'a>,
    effect_entries: &[ThreeRendererEffectEntry],
    ctx: &LintContext<'a>,
) -> Option<ThreeRendererLifecycle> {
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
    let allocation_effect = effect_entries.iter().find(|entry| {
        entry.callback_id == allocation_function_id && entry.is_first_callback_registration
    });
    let (owner_id, creation_kind) = if let Some(effect) = allocation_effect {
        (effect.owner_id?, ThreeRendererCreationKind::Effect)
    } else {
        let owner = find_render_phase_component_or_hook(allocation, ctx)?;
        if crate::ast_util::get_enclosing_function(ctx.symbol_declaration(source_symbol_id), ctx)
            .map(crate::AstNode::id)
            != Some(owner.id())
        {
            return None;
        }
        (owner.id(), ThreeRendererCreationKind::Render)
    };
    let symbol_ids = r3f_root_collect_alias_symbol_ids(source_symbol_id, ctx);
    Some(ThreeRendererLifecycle {
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

fn three_renderer_eager_hook_lifecycle<'a>(
    allocation: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeRendererLifecycle> {
    let allocation_root = transparent_expression_root(allocation, ctx);
    let mut current = allocation_root;
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
            let is_ref = three_renderer_react_api_matches(call_expression, "useRef", analysis, ctx);
            let is_state =
                three_renderer_react_api_matches(call_expression, "useState", analysis, ctx);
            if !is_ref && !is_state {
                current = parent;
                continue;
            }
            let owner = find_render_phase_component_or_hook(parent, ctx)?;
            if current.span() == allocation_root.span() {
                let call_root = transparent_expression_root(parent, ctx);
                let declaration = ctx.nodes().parent_node(call_root.id());
                if let AstKind::VariableDeclarator(declarator) = declaration.kind()
                    && declarator
                        .init
                        .as_ref()
                        .is_some_and(|initializer| initializer.span() == call_root.span())
                    && crate::ast_util::get_enclosing_function(declaration, ctx)
                        .map(crate::AstNode::id)
                        == Some(owner.id())
                {
                    let binding = if is_ref {
                        declarator.id.get_binding_identifier()
                    } else {
                        let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = &declarator.id
                        else {
                            return Some(three_renderer_unbound_eager_hook_lifecycle(owner.id()));
                        };
                        pattern
                            .elements
                            .first()
                            .and_then(|element| element.as_ref())
                            .and_then(oxc_ast::ast::BindingPattern::get_binding_identifier)
                    };
                    if let Some(binding) = binding {
                        let owner_symbol_ids =
                            r3f_root_collect_alias_symbol_ids(binding.symbol_id(), ctx);
                        let access_path = if is_ref {
                            R3fOwnedRootAccessPath::Object("current".to_string())
                        } else {
                            R3fOwnedRootAccessPath::Direct
                        };
                        let resource_symbol_ids = r3f_owned_root_collect_resource_aliases(
                            &owner_symbol_ids,
                            &access_path,
                            ctx,
                        );
                        return Some(ThreeRendererLifecycle {
                            access_path,
                            creation_kind: ThreeRendererCreationKind::Stable,
                            has_eager_hook_allocation: true,
                            owner_id: owner.id(),
                            owner_symbol_ids,
                            resource_symbol_ids,
                        });
                    }
                }
            }
            return Some(three_renderer_unbound_eager_hook_lifecycle(owner.id()));
        }
        current = parent;
    }
    None
}

fn three_renderer_unbound_eager_hook_lifecycle(owner_id: NodeId) -> ThreeRendererLifecycle {
    ThreeRendererLifecycle {
        access_path: R3fOwnedRootAccessPath::Direct,
        creation_kind: ThreeRendererCreationKind::Stable,
        has_eager_hook_allocation: true,
        owner_id,
        owner_symbol_ids: rustc_hash::FxHashSet::default(),
        resource_symbol_ids: rustc_hash::FxHashSet::default(),
    }
}

fn three_renderer_effect_entries<'a>(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<ThreeRendererEffectEntry> {
    let mut entries = Vec::new();
    let mut registered_callback_ids = rustc_hash::FxHashSet::default();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !THREE_RENDERER_EFFECT_HOOK_NAMES.iter().any(|hook_name| {
            three_renderer_react_api_matches(call_expression, hook_name, analysis, ctx)
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
        let owner = find_render_phase_component_or_hook(node, ctx);
        entries.push(ThreeRendererEffectEntry {
            callback_id,
            call_id: node.id(),
            owner_id: owner.map(crate::AstNode::id),
            has_unconditional_registration: owner.is_some_and(|owner| {
                three_renderer_execution_is_guaranteed(node, owner.id(), node_index, ctx)
            }),
            is_first_callback_registration: registered_callback_ids.insert(callback_id),
        });
    }
    entries
}

fn three_renderer_expression_matches(
    expression: &Expression<'_>,
    lifecycle: &ThreeRendererLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = three_renderer_strip_parentheses(expression);
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
    let Expression::Identifier(identifier) = three_renderer_strip_parentheses(member.object())
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id))
        && three_renderer_member_matches_path(member, &lifecycle.access_path)
}

fn three_renderer_expression_matches_owner(
    expression: &Expression<'_>,
    lifecycle: &ThreeRendererLifecycle,
    ctx: &LintContext<'_>,
) -> bool {
    three_renderer_expression_matches(expression, lifecycle, ctx)
        || matches!(three_renderer_strip_parentheses(expression), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
            |symbol_id| lifecycle.owner_symbol_ids.contains(&symbol_id)
        ))
}

fn three_renderer_resource_access<'a, 'b>(
    reference_node: &'b crate::AstNode<'a>,
    reference_symbol_id: SymbolId,
    lifecycle: &ThreeRendererLifecycle,
    ctx: &'b LintContext<'a>,
) -> Option<&'b crate::AstNode<'a>> {
    let reference_root = transparent_expression_root(reference_node, ctx);
    if reference_root.id() != three_renderer_parenthesized_expression_root(reference_node, ctx).id()
    {
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
        && three_renderer_member_kind_matches_path(member, &lifecycle.access_path))
    .then_some(member_node)
}

fn three_renderer_has_unstable_identity<'a>(
    lifecycle: &ThreeRendererLifecycle,
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
                three_renderer_resource_access(reference_node, symbol_id, lifecycle, ctx)
            else {
                continue;
            };
            if !three_renderer_is_defaulted_object_assignment_binding(resource_access, ctx)
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

fn three_renderer_is_defaulted_object_assignment_binding<'a>(
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

fn three_renderer_has_unknown_transfer<'a>(
    lifecycle: &ThreeRendererLifecycle,
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
                three_renderer_resource_access(reference_node, symbol_id, lifecycle, ctx);
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
                    || three_renderer_is_effect_dependency(reference_root, analysis, ctx)
                    || parent
                        .kind()
                        .as_member_expression_kind()
                        .is_some_and(|member| {
                            member.object().span() == reference_root.span()
                                && three_renderer_static_member_kind_property_name(member).is_some()
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
                || three_renderer_is_effect_dependency(resource_root, analysis, ctx)
            {
                continue;
            }
            let is_resource_member_access = parent
                .kind()
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span() == resource_root.span());
            if three_renderer_is_returned_from_owner(resource_root, lifecycle.owner_id, ctx)
                && !is_resource_member_access
            {
                return true;
            }
            if let Some((call_expression, argument_span)) =
                three_renderer_containing_call_argument(resource_root, ctx)
            {
                let method_name = three_renderer_strip_parentheses(&call_expression.callee)
                    .as_member_expression()
                    .and_then(three_renderer_static_member_property_name);
                if argument_span == resource_root.span()
                    && method_name.is_none_or(|method_name| {
                        !THREE_RENDERER_BORROWING_METHOD_NAMES.contains(&method_name)
                    })
                {
                    return true;
                }
                continue;
            }
            if is_resource_member_access {
                continue;
            }
            if three_renderer_is_retained_by_unused_local_react_ref(resource_root, analysis, ctx) {
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

fn three_renderer_is_retained_by_unused_local_react_ref<'a>(
    reference: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let reference_root = transparent_expression_root(reference, ctx);
    let assignment_node = ctx.nodes().parent_node(reference_root.id());
    let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
        return false;
    };
    if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
        || assignment.right.span() != reference_root.span()
    {
        return false;
    }
    let Some(target_member) = assignment.left.as_member_expression() else {
        return false;
    };
    let Some(ref_symbol_id) = three_renderer_react_ref_symbol(target_member, analysis, ctx) else {
        return false;
    };
    if ctx
        .scoping()
        .get_resolved_references(ref_symbol_id)
        .any(|ref_reference| {
            let ref_node = ctx.nodes().get_node(ref_reference.node_id());
            let ref_root = transparent_expression_root(ref_node, ctx);
            let member_node = ctx.nodes().parent_node(ref_root.id());
            member_node
                .kind()
                .as_member_expression_kind()
                .is_none_or(|member| {
                    member.object().span() != ref_root.span()
                        || three_renderer_static_member_kind_property_name(member)
                            != Some("current")
                })
        })
    {
        return false;
    }
    let Some(reference_function) = crate::ast_util::get_enclosing_function(reference, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(ref_symbol_id);
    let Some(ref_owner_function) = crate::ast_util::get_enclosing_function(declaration, ctx) else {
        return false;
    };
    reference_function.id() == ref_owner_function.id()
        || crate::ast_util::get_enclosing_function(reference_function, ctx)
            .is_some_and(|owner| owner.id() == ref_owner_function.id())
}

fn three_renderer_is_effect_dependency<'a>(
    reference: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((call_expression, argument_span)) =
        three_renderer_containing_call_argument(reference, ctx)
    else {
        return false;
    };
    call_expression
        .arguments
        .get(1)
        .is_some_and(|dependency| dependency.span() == argument_span)
        && THREE_RENDERER_EFFECT_HOOK_NAMES.iter().any(|hook_name| {
            three_renderer_react_api_matches(call_expression, hook_name, analysis, ctx)
        })
}

fn three_renderer_is_returned_from_owner(
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

fn three_renderer_containing_call_argument<'a, 'b>(
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
fn three_renderer_has_cleanup<'a>(
    allocation: &crate::AstNode<'a>,
    lifecycle: &ThreeRendererLifecycle,
    effect_entries: &[ThreeRendererEffectEntry],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    method_name: &str,
    requires_null_argument: bool,
) -> bool {
    let mut has_unknown_cleanup = false;
    for effect in effect_entries {
        if !three_renderer_effect_is_cleanup_source(allocation, lifecycle, effect, ctx) {
            continue;
        }
        let matching_returns = three_renderer_matching_cleanup_returns(
            effect.callback_id,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            method_name,
            requires_null_argument,
        );
        let cleanup_matches = if lifecycle.creation_kind == ThreeRendererCreationKind::Effect {
            do_nodes_cover_every_path_after_node(
                allocation,
                &matching_returns,
                ctx.nodes().get_node(effect.callback_id),
                ctx,
            )
        } else {
            three_renderer_function_returns_cleanup_on_every_path(
                effect.callback_id,
                &matching_returns,
                node_index,
                ctx,
            )
        };
        if !cleanup_matches {
            continue;
        }
        match three_renderer_dependency_status(effect, lifecycle, ctx) {
            ThreeRendererDependencyStatus::Valid => return true,
            ThreeRendererDependencyStatus::Unknown => has_unknown_cleanup = true,
            ThreeRendererDependencyStatus::Invalid => {}
        }
    }
    has_unknown_cleanup
}

fn three_renderer_effect_is_cleanup_source(
    allocation: &crate::AstNode<'_>,
    lifecycle: &ThreeRendererLifecycle,
    effect: &ThreeRendererEffectEntry,
    ctx: &LintContext<'_>,
) -> bool {
    if effect.owner_id != Some(lifecycle.owner_id) || !effect.has_unconditional_registration {
        return false;
    }
    lifecycle.creation_kind != ThreeRendererCreationKind::Effect
        || (effect.is_first_callback_registration
            && local_callback_nearest_function_id(allocation.id(), ctx) == Some(effect.callback_id))
}

fn three_renderer_dependency_status(
    effect: &ThreeRendererEffectEntry,
    lifecycle: &ThreeRendererLifecycle,
    ctx: &LintContext<'_>,
) -> ThreeRendererDependencyStatus {
    let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(effect.call_id).kind()
    else {
        return ThreeRendererDependencyStatus::Invalid;
    };
    let Some(dependency_argument) = call_expression.arguments.get(1) else {
        return ThreeRendererDependencyStatus::Valid;
    };
    let Some(dependency_expression) = dependency_argument.as_expression() else {
        return ThreeRendererDependencyStatus::Unknown;
    };
    let Expression::ArrayExpression(dependencies) =
        three_renderer_strip_parentheses(dependency_expression)
    else {
        return ThreeRendererDependencyStatus::Unknown;
    };
    if matches!(
        lifecycle.creation_kind,
        ThreeRendererCreationKind::Stable | ThreeRendererCreationKind::Effect
    ) {
        return ThreeRendererDependencyStatus::Valid;
    }
    if dependencies.elements.iter().any(|element| {
        element.as_expression().is_some_and(|expression| {
            three_renderer_expression_matches_owner(expression, lifecycle, ctx)
        })
    }) {
        ThreeRendererDependencyStatus::Valid
    } else {
        ThreeRendererDependencyStatus::Invalid
    }
}

fn three_renderer_matching_cleanup_returns<'a, 'b>(
    callback_id: NodeId,
    lifecycle: &ThreeRendererLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &'b LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    method_name: &str,
    requires_null_argument: bool,
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
        if three_renderer_cleanup_expression_matches(
            returned_expression,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            method_name,
            requires_null_argument,
        ) {
            matching_returns.push(candidate);
        }
    }
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = function.get_expression()
        && three_renderer_cleanup_expression_matches(
            expression,
            lifecycle,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            method_name,
            requires_null_argument,
        )
    {
        matching_returns.push(ctx.nodes().get_node(expression.node_id()));
    }
    matching_returns
}

fn three_renderer_cleanup_expression_matches<'a>(
    expression: &Expression<'a>,
    lifecycle: &ThreeRendererLifecycle,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    method_name: &str,
    requires_null_argument: bool,
) -> bool {
    let Some(cleanup_function_id) =
        exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
    else {
        return false;
    };
    let mut did_invoke_method = false;
    for_each_analyzed_synchronous_execution_node(
        cleanup_function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, is_conditional, _| {
            if !did_invoke_method
                && !is_conditional
                && local_callback_nearest_function_id(candidate.id(), ctx).is_some_and(
                    |function_id| {
                        three_renderer_execution_is_guaranteed(
                            candidate,
                            function_id,
                            node_index,
                            ctx,
                        )
                    },
                )
            {
                did_invoke_method = three_renderer_is_method_call(
                    candidate,
                    lifecycle,
                    method_name,
                    requires_null_argument,
                    ctx,
                );
            }
        },
    );
    did_invoke_method
}

fn three_renderer_is_method_call(
    candidate: &crate::AstNode<'_>,
    lifecycle: &ThreeRendererLifecycle,
    method_name: &str,
    requires_null_argument: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::CallExpression(call_expression) = candidate.kind() else {
        return false;
    };
    let Some(member) = call_expression.callee.as_member_expression() else {
        return false;
    };
    three_renderer_static_member_property_name(member) == Some(method_name)
        && three_renderer_expression_matches(member.object(), lifecycle, ctx)
        && (!requires_null_argument
            || matches!(
                call_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression),
                Some(Expression::NullLiteral(_))
            ))
}

fn three_renderer_function_returns_cleanup_on_every_path(
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

fn three_renderer_execution_is_guaranteed<'a>(
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

fn three_renderer_react_api_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    three_renderer_api_reference_has_canonical_wrapper_shape(
        &call_expression.callee,
        ctx,
        &mut Vec::new(),
    ) && (is_react_api_call(call_expression, api_name, ctx)
        || r3f_owned_root_react_api_matches(call_expression, api_name, analysis, ctx))
}

fn three_renderer_const_identifier_root_symbol(
    source_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let mut symbol_id = source_symbol_id;
    let mut visited_symbol_ids = rustc_hash::FxHashSet::default();
    loop {
        if !visited_symbol_ids.insert(symbol_id) {
            return None;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_id);
        };
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return Some(symbol_id);
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return None;
        }
        let Expression::Identifier(identifier) =
            three_renderer_strip_parentheses(declarator.init.as_ref()?)
        else {
            return Some(symbol_id);
        };
        symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
    }
}

fn three_renderer_static_member_property_name<'a, 'node>(
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

fn three_renderer_static_member_kind_property_name<'node>(
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

fn three_renderer_member_matches_path(
    member: &oxc_ast::ast::MemberExpression<'_>,
    access_path: &R3fOwnedRootAccessPath,
) -> bool {
    match access_path {
        R3fOwnedRootAccessPath::Direct => false,
        R3fOwnedRootAccessPath::Object(property_name) => {
            three_renderer_static_member_property_name(member) == Some(property_name.as_str())
        }
        R3fOwnedRootAccessPath::Array(index) => matches!(
            member,
            oxc_ast::ast::MemberExpression::ComputedMemberExpression(member)
                if matches!(&member.expression, Expression::NumericLiteral(literal) if literal.value == *index as f64)
        ),
    }
}

fn three_renderer_member_kind_matches_path(
    member: oxc_ast::MemberExpressionKind<'_>,
    access_path: &R3fOwnedRootAccessPath,
) -> bool {
    match access_path {
        R3fOwnedRootAccessPath::Direct => false,
        R3fOwnedRootAccessPath::Object(property_name) => {
            three_renderer_static_member_kind_property_name(member) == Some(property_name.as_str())
        }
        R3fOwnedRootAccessPath::Array(index) => matches!(
            member,
            oxc_ast::MemberExpressionKind::Computed(member)
                if matches!(&member.expression, Expression::NumericLiteral(literal) if literal.value == *index as f64)
        ),
    }
}

fn three_renderer_api_reference_has_canonical_wrapper_shape<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = three_renderer_strip_parentheses(expression);
    if let Some(member) = expression.as_member_expression() {
        return three_renderer_module_namespace_has_canonical_wrapper_shape(
            member.object(),
            ctx,
            visited_symbol_ids,
        );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return identifier.name == "React"
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none();
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
            three_renderer_api_reference_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        });
    }
    destructured_binding_provenance(&declarator.id, symbol_id, declarator.init.as_ref())
        .is_some_and(|(_, initializer)| {
            three_renderer_module_namespace_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_renderer_module_namespace_has_canonical_wrapper_shape<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = three_renderer_strip_parentheses(expression);
    if matches!(expression, Expression::CallExpression(_)) {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return identifier.name == "React"
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none();
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
            three_renderer_module_namespace_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_renderer_parenthesized_expression_root<'a, 'ctx>(
    mut node: &'ctx crate::AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> &'ctx crate::AstNode<'a> {
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        if !matches!(parent.kind(), AstKind::ParenthesizedExpression(_)) {
            return node;
        }
        node = parent;
    }
}

fn three_renderer_strip_parentheses<'a, 'node>(
    mut expression: &'node Expression<'a>,
) -> &'node Expression<'a> {
    while let Expression::ParenthesizedExpression(parenthesized) = expression {
        expression = &parenthesized.expression;
    }
    expression
}
