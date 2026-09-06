use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "Shader material custom uniforms are refreshed during rendering, so setting uniformsNeedUpdate on every animation frame is redundant";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];
const THREE_SHADER_MATERIAL_CONSTRUCTOR_NAMES: [&str; 2] = ["ShaderMaterial", "RawShaderMaterial"];

#[derive(Debug, Default, Clone)]
pub struct ThreeNoRedundantUniformsNeedUpdate;

impl RuleMeta for ThreeNoRedundantUniformsNeedUpdate {
    const NAME: &'static str = "three-no-redundant-uniforms-need-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow redundant per-frame shader uniform update flags.",
    };
}

impl Rule for ThreeNoRedundantUniformsNeedUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut animation_call_ids = Vec::new();
        let mut has_uniforms_need_update_candidate = false;
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call_expression) => {
                    let callee = call_expression.callee.get_inner_expression();
                    if callee
                        .as_member_expression()
                        .is_some_and(|member_expression| {
                            static_member_expression_property_name(member_expression)
                                == Some("setAnimationLoop")
                        })
                        || is_global_request_animation_frame_call(call_expression, ctx)
                    {
                        animation_call_ids.push(node.id());
                    }
                }
                AstKind::AssignmentExpression(assignment) => {
                    if !has_uniforms_need_update_candidate {
                        has_uniforms_need_update_candidate = assignment.operator
                            == AssignmentOperator::Assign
                            && matches!(
                                &assignment.right,
                                Expression::BooleanLiteral(literal) if literal.value
                            )
                            && assignment
                                .left
                                .as_member_expression()
                                .is_some_and(|target| {
                                    static_member_expression_property_name(target)
                                        == Some("uniformsNeedUpdate")
                                });
                    }
                }
                _ => {}
            }
        }
        if animation_call_ids.is_empty() || !has_uniforms_need_update_candidate {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();
        let mut callback_renders_with_three_cache = rustc_hash::FxHashMap::default();

        for animation_call_id in animation_call_ids {
            let AstKind::CallExpression(call_expression) =
                ctx.nodes().get_node(animation_call_id).kind()
            else {
                continue;
            };
            let Some(callback_id) = three_uniform_update_animation_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut callback_renders_with_three_cache,
            ) else {
                continue;
            };
            if !analyzed_callback_ids.insert(callback_id)
                || matches!(
                    ctx.nodes().get_node(callback_id).kind(),
                    AstKind::Function(function) if function.generator
                )
            {
                continue;
            }
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, is_conditionally_executed, _| {
                    if is_conditionally_executed {
                        return;
                    }
                    let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                        return;
                    };
                    if assignment.operator != AssignmentOperator::Assign
                        || !matches!(
                            &assignment.right,
                            Expression::BooleanLiteral(literal) if literal.value
                        )
                    {
                        return;
                    }
                    let Some(target) = assignment.left.as_member_expression() else {
                        return;
                    };
                    if static_member_expression_property_name(target) != Some("uniformsNeedUpdate")
                        || !three_uniform_update_constructor_name(target.object(), &analysis, ctx)
                            .is_some_and(|constructor_name| {
                                THREE_SHADER_MATERIAL_CONSTRUCTOR_NAMES
                                    .contains(&constructor_name.as_str())
                            })
                    {
                        return;
                    }
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_uniform_update_animation_callback_id<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    callback_renders_with_three_cache: &mut rustc_hash::FxHashMap<NodeId, bool>,
) -> Option<NodeId> {
    let callee = call_expression.callee.get_inner_expression();
    if let Some(member_expression) = callee.as_member_expression()
        && static_member_expression_property_name(member_expression) == Some("setAnimationLoop")
        && three_uniform_update_constructor_name(member_expression.object(), analysis, ctx)
            .is_some_and(|constructor_name| {
                THREE_RENDERER_CONSTRUCTOR_NAMES.contains(&constructor_name.as_str())
            })
    {
        return resolve_r3f_analyzed_callback_function_id(
            call_expression.arguments.first()?.as_expression()?,
            analysis,
            ctx,
            resolution_cache,
        );
    }

    let callback_id = resolve_analyzed_recursive_animation_frame_callback_id(
        call_expression,
        false,
        node_index,
        ctx,
        resolution_cache,
    )?;
    if let Some(&does_render) = callback_renders_with_three_cache.get(&callback_id) {
        return does_render.then_some(callback_id);
    }
    let does_render = three_uniform_update_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_uniform_update_callback_renders_with_three<'a>(
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if matches!(
        ctx.nodes().get_node(callback_id).kind(),
        AstKind::Function(function) if function.generator
    ) {
        return false;
    }
    let mut does_render = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if does_render {
                return;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            let Some(callee) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return;
            };
            if static_member_expression_property_name(callee)
                .is_some_and(|method_name| THREE_RENDER_METHOD_NAMES.contains(&method_name))
                && three_uniform_update_constructor_name(callee.object(), analysis, ctx)
                    .is_some_and(|constructor_name| {
                        THREE_RENDERER_CONSTRUCTOR_NAMES.contains(&constructor_name.as_str())
                    })
            {
                does_render = true;
            }
        },
    );
    does_render
}

fn three_uniform_update_constructor_name<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    three_uniform_update_constructor_name_inner(expression, analysis, ctx, &mut Vec::new())
}

fn three_uniform_update_constructor_name_inner<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::NewExpression(allocation) => {
            three_uniform_update_api_name(&allocation.callee, analysis, ctx)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = identifier_symbol_id_with_lexical_fallback(identifier, ctx)?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
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
                return None;
            }
            three_uniform_update_constructor_name_inner(
                declarator.init.as_ref()?,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn three_uniform_update_api_name<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let api_name = three_uniform_update_api_candidate_name(expression, ctx, &mut Vec::new())?;
    (module_api_reference_matches(expression, &api_name, &THREE_MODULES, analysis, ctx)
        || type_import_module_api_reference_matches(
            expression,
            &api_name,
            &THREE_MODULES,
            analysis,
            ctx,
        ))
    .then_some(api_name)
}

fn three_uniform_update_api_candidate_name<'a>(
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
            return three_uniform_update_api_candidate_name(
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
