use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_RECURSIVE_RAF_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const R3F_RECURSIVE_RAF_REACT_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const R3F_RECURSIVE_RAF_EFFECT_HOOK_NAMES: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const R3F_RECURSIVE_RAF_MESSAGE: &str = "This component starts a recursive requestAnimationFrame loop while also subscribing to R3F useFrame. Move the repeated work into useFrame so R3F owns frame scheduling";
const R3F_RECURSIVE_RENDERER_LOOP_MESSAGE: &str = "This component starts setAnimationLoop on R3F's renderer while also subscribing to useFrame. Move the repeated work into useFrame so R3F remains the only frame scheduler";

#[derive(Debug, Default, Clone)]
pub struct R3FNoRecursiveRafWithUseFrame;

impl RuleMeta for R3FNoRecursiveRafWithUseFrame {
    const NAME: &'static str = "r3f-no-recursive-raf-with-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow competing animation loops alongside R3F useFrame.",
    };
}

impl Rule for R3FNoRecursiveRafWithUseFrame {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !program_references_r3f(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        let mut owner_uses_frame_by_id = rustc_hash::FxHashMap::default();
        let mut reported_start_ids = rustc_hash::FxHashSet::default();

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(owner) = find_render_phase_component_or_hook(node, ctx) else {
                continue;
            };
            let owner_id = owner.id();
            let owner_uses_frame =
                if let Some(owner_uses_frame) = owner_uses_frame_by_id.get(&owner_id) {
                    *owner_uses_frame
                } else {
                    let owner_uses_frame = r3f_recursive_raf_owner_uses_frame(
                        owner_id,
                        &analysis,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                    );
                    owner_uses_frame_by_id.insert(owner_id, owner_uses_frame);
                    if owner_uses_frame {
                        r3f_recursive_raf_report_starts(
                            owner_id,
                            &analysis,
                            &node_index,
                            ctx,
                            &mut resolution_cache,
                            &mut assigned_expression_cache,
                            &mut reported_start_ids,
                        );
                    }
                    owner_uses_frame
                };
            if !owner_uses_frame
                || !r3f_recursive_raf_react_effect_matches(call_expression, &analysis, ctx)
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
            let Some(callback_id) = exact_local_function_id(
                callback_expression,
                ctx,
                &mut Vec::new(),
                &mut resolution_cache,
            ) else {
                continue;
            };
            r3f_recursive_raf_report_starts(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut assigned_expression_cache,
                &mut reported_start_ids,
            );
        }
    }
}

fn r3f_recursive_raf_owner_uses_frame<'a>(
    owner_id: oxc_semantic::NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if matches!(
        ctx.nodes().get_node(owner_id).kind(),
        AstKind::Function(function) if function.generator
    ) {
        return false;
    }
    let mut owner_uses_frame = false;
    for_each_analyzed_synchronous_execution_node(
        owner_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if owner_uses_frame {
                return;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            owner_uses_frame = r3f_recursive_raf_module_api_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_RECURSIVE_RAF_PUBLIC_MODULES,
                analysis,
                ctx,
            );
        },
    );
    owner_uses_frame
}

fn r3f_recursive_raf_report_starts<'a>(
    executed_function_id: oxc_semantic::NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    reported_start_ids: &mut rustc_hash::FxHashSet<oxc_semantic::NodeId>,
) {
    let mut recursive_animation_frame_start_ids = Vec::new();
    let mut renderer_animation_loop_start_ids = Vec::new();
    for_each_analyzed_synchronous_execution_node(
        executed_function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, execution_resolution_cache| {
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            if resolve_analyzed_recursive_animation_frame_callback_id(
                call_expression,
                false,
                node_index,
                ctx,
                execution_resolution_cache,
            )
            .is_some()
            {
                recursive_animation_frame_start_ids.push(candidate.id());
            }
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                return;
            };
            if static_member_expression_property_name(member_expression) != Some("setAnimationLoop")
                || !["gl", "renderer"].iter().any(|property_name| {
                    r3f_analyzed_use_three_state_property_matches(
                        member_expression.object(),
                        property_name,
                        analysis,
                        node_index,
                        ctx,
                        execution_resolution_cache,
                        assigned_expression_cache,
                    )
                })
            {
                return;
            }
            let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                return;
            };
            if resolve_r3f_analyzed_callback_function_id(
                callback_expression,
                analysis,
                ctx,
                execution_resolution_cache,
            )
            .is_some()
                || r3f_recursive_raf_callback_has_import_provenance(
                    callback_expression,
                    analysis,
                    ctx,
                    &mut Vec::new(),
                )
            {
                renderer_animation_loop_start_ids.push(candidate.id());
            }
        },
    );

    for start_id in recursive_animation_frame_start_ids {
        if reported_start_ids.insert(start_id) {
            ctx.diagnostic(
                OxcDiagnostic::warn(R3F_RECURSIVE_RAF_MESSAGE)
                    .with_label(ctx.nodes().get_node(start_id).span()),
            );
        }
    }
    for start_id in renderer_animation_loop_start_ids {
        if reported_start_ids.insert(start_id) {
            ctx.diagnostic(
                OxcDiagnostic::warn(R3F_RECURSIVE_RENDERER_LOOP_MESSAGE)
                    .with_label(ctx.nodes().get_node(start_id).span()),
            );
        }
    }
}

fn r3f_recursive_raf_react_effect_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    R3F_RECURSIVE_RAF_EFFECT_HOOK_NAMES.iter().any(|hook_name| {
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
                identifier_symbol_id_with_lexical_fallback(identifier, ctx)
            })
            .is_some();
        (has_bound_namespace_receiver && is_react_api_call(call_expression, hook_name, ctx))
            || r3f_recursive_raf_module_api_matches(
                &call_expression.callee,
                hook_name,
                &R3F_RECURSIVE_RAF_REACT_MODULES,
                analysis,
                ctx,
            )
    })
}

fn r3f_recursive_raf_module_api_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    api_name: &str,
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(expression, api_name, module_sources, analysis, ctx)
        || type_import_module_api_reference_matches(
            expression,
            api_name,
            module_sources,
            analysis,
            ctx,
        )
}

fn r3f_recursive_raf_callback_has_import_provenance<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        let Some(property_name) = member_expression.static_property_name() else {
            return false;
        };
        if let oxc_ast::ast::Expression::Identifier(receiver) =
            member_expression.object().get_inner_expression()
            && has_possible_static_property_write_before(
                receiver,
                property_name,
                ctx.nodes().get_node(expression.node_id()),
                analysis,
                ctx,
            )
        {
            return false;
        }
        return r3f_recursive_raf_module_namespace_matches(
            member_expression.object(),
            ctx,
            visited_symbol_ids,
        );
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
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
    if matches!(
        declaration.kind(),
        AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
    ) {
        return true;
    }
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return false;
        };
        let oxc_ast::ast::TSTypeName::IdentifierReference(namespace_identifier) =
            &qualified_name.left
        else {
            return false;
        };
        return !has_possible_static_property_write_before(
            namespace_identifier,
            qualified_name.right.name.as_str(),
            declaration,
            analysis,
            ctx,
        ) && r3f_recursive_raf_module_namespace_identifier_matches(
            namespace_identifier,
            ctx,
            &mut visited_symbol_ids.clone(),
        );
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            r3f_recursive_raf_callback_has_import_provenance(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        });
    }
    let Some((property_name, initializer)) =
        destructured_binding_provenance(&declarator.id, symbol_id, declarator.init.as_ref())
    else {
        return false;
    };
    if let oxc_ast::ast::Expression::Identifier(namespace_identifier) =
        initializer.get_inner_expression()
        && has_possible_static_property_write_before(
            namespace_identifier,
            property_name.as_str(),
            declaration,
            analysis,
            ctx,
        )
    {
        return false;
    }
    r3f_recursive_raf_module_namespace_matches(initializer, ctx, visited_symbol_ids)
}

fn r3f_recursive_raf_module_namespace_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(expression, oxc_ast::ast::Expression::CallExpression(_))
        && global_require_module_source(expression, ctx).is_some()
    {
        return true;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return false;
    };
    r3f_recursive_raf_module_namespace_identifier_matches(identifier, ctx, visited_symbol_ids)
}

fn r3f_recursive_raf_module_namespace_identifier_matches(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(declaration.kind(), AstKind::ImportNamespaceSpecifier(_)) {
        return true;
    }
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        return matches!(
            &import_equals.module_reference,
            oxc_ast::ast::TSModuleReference::ExternalModuleReference(_)
        );
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(initializer) = declarator.init.as_ref() else {
        return false;
    };
    if matches!(
        initializer.get_inner_expression(),
        oxc_ast::ast::Expression::CallExpression(_)
    ) && global_require_module_source(initializer, ctx).is_some()
    {
        return true;
    }
    let oxc_ast::ast::Expression::Identifier(next_identifier) = initializer.get_inner_expression()
    else {
        return false;
    };
    r3f_recursive_raf_module_namespace_identifier_matches(next_identifier, ctx, visited_symbol_ids)
}
