use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES: [&str; 11] = [
    "BufferAttribute",
    "Float16BufferAttribute",
    "Float32BufferAttribute",
    "InstancedBufferAttribute",
    "Int16BufferAttribute",
    "Int32BufferAttribute",
    "Int8BufferAttribute",
    "Uint16BufferAttribute",
    "Uint32BufferAttribute",
    "Uint8BufferAttribute",
    "Uint8ClampedBufferAttribute",
];
const DYNAMIC_BUFFER_USAGE_NAMES: [&str; 6] = [
    "DynamicCopyUsage",
    "DynamicDrawUsage",
    "DynamicReadUsage",
    "StreamCopyUsage",
    "StreamDrawUsage",
    "StreamReadUsage",
];
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];
const THREE_RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const MESSAGE: &str = "This BufferAttribute uploads every animation frame without a prior dynamic or stream usage hint, so Three.js keeps the default StaticDrawUsage allocation strategy";

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireDynamicBufferUsage;

impl RuleMeta for ThreeRequireDynamicBufferUsage {
    const NAME: &'static str = "three-require-dynamic-buffer-usage";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require dynamic usage for buffers uploaded every animation frame.",
    };
}

struct ThreeBufferUsageConfiguration {
    attribute_key: String,
    is_dynamic: bool,
    start: u32,
}

impl Rule for ThreeRequireDynamicBufferUsage {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut usage_call_ids = Vec::new();
        let mut animation_call_ids = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if call_expression
                .callee
                .as_member_expression()
                .is_some_and(|member_expression| {
                    static_member_expression_property_name(member_expression) == Some("setUsage")
                })
            {
                usage_call_ids.push(node.id());
            }
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
        if animation_call_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let usage_configurations = usage_call_ids
            .into_iter()
            .filter_map(|call_id| {
                let node = ctx.nodes().get_node(call_id);
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                let member_expression = call_expression.callee.as_member_expression()?;
                if !three_dynamic_buffer_resolves_to_attribute(
                    member_expression.object(),
                    &analysis,
                    ctx,
                    &mut Vec::new(),
                ) {
                    return None;
                }
                let usage_expression = call_expression.arguments.first()?.as_expression()?;
                let attribute_key =
                    resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())?;
                Some(ThreeBufferUsageConfiguration {
                    attribute_key,
                    is_dynamic: three_dynamic_buffer_is_dynamic_usage(
                        usage_expression,
                        &analysis,
                        ctx,
                    ),
                    start: node.span().start,
                })
            })
            .collect::<Vec<_>>();

        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();
        let mut callback_renders_with_three_cache = rustc_hash::FxHashMap::default();
        for animation_call_id in animation_call_ids {
            let animation_call_node = ctx.nodes().get_node(animation_call_id);
            let AstKind::CallExpression(call_expression) = animation_call_node.kind() else {
                continue;
            };
            let Some(callback_id) = three_dynamic_buffer_animation_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut callback_renders_with_three_cache,
            ) else {
                continue;
            };
            if matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) || !analyzed_callback_ids.insert(callback_id)
            {
                continue;
            }
            let animation_start = animation_call_node.span().start;
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
                    let Some(receiver) = three_dynamic_buffer_needs_update_receiver(candidate)
                    else {
                        return;
                    };
                    if !three_dynamic_buffer_resolves_to_attribute(
                        receiver,
                        &analysis,
                        ctx,
                        &mut Vec::new(),
                    ) {
                        return;
                    }
                    let Some(attribute_key) =
                        resolve_expression_key(receiver, ctx, &mut Vec::new())
                    else {
                        return;
                    };
                    if usage_configurations.iter().any(|configuration| {
                        configuration.attribute_key == attribute_key
                            && configuration.is_dynamic
                            && configuration.start < animation_start
                    }) {
                        return;
                    }
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_dynamic_buffer_animation_callback_id<'a>(
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
        && three_dynamic_buffer_resolves_to_renderer(
            member_expression.object(),
            analysis,
            ctx,
            &mut Vec::new(),
        )
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
    let does_render = three_dynamic_buffer_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_dynamic_buffer_callback_renders_with_three<'a>(
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
            let Some(member_expression) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return;
            };
            if static_member_expression_property_name(member_expression)
                .is_some_and(|method_name| THREE_RENDER_METHOD_NAMES.contains(&method_name))
                && three_dynamic_buffer_resolves_to_renderer(
                    member_expression.object(),
                    analysis,
                    ctx,
                    &mut Vec::new(),
                )
            {
                does_render = true;
            }
        },
    );
    does_render
}

fn three_dynamic_buffer_is_dynamic_usage<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    DYNAMIC_BUFFER_USAGE_NAMES.iter().any(|usage_name| {
        module_api_reference_matches(expression, usage_name, &THREE_MODULES, analysis, ctx)
            || type_import_module_api_reference_matches(
                expression,
                usage_name,
                &THREE_MODULES,
                analysis,
                ctx,
            )
    })
}

fn three_dynamic_buffer_needs_update_receiver<'a>(
    node: &crate::AstNode<'a>,
) -> Option<&'a Expression<'a>> {
    let AstKind::AssignmentExpression(assignment) = node.kind() else {
        return None;
    };
    if assignment.operator != AssignmentOperator::Assign
        || !matches!(
            assignment.right.get_inner_expression(),
            Expression::BooleanLiteral(literal) if literal.value
        )
    {
        return None;
    }
    let target = assignment.left.as_member_expression().or_else(|| {
        assignment
            .left
            .get_expression()?
            .get_inner_expression()
            .as_member_expression()
    })?;
    (static_member_expression_property_name(target) == Some("needsUpdate")).then(|| target.object())
}

fn three_dynamic_buffer_resolves_to_attribute<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    three_dynamic_buffer_resolves_to_constructor(
        expression,
        &BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES,
        analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn three_dynamic_buffer_resolves_to_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    three_dynamic_buffer_resolves_to_constructor(
        expression,
        &THREE_RENDERER_CONSTRUCTOR_NAMES,
        analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn three_dynamic_buffer_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    constructor_names: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        return constructor_names.iter().any(|constructor_name| {
            module_api_reference_matches(
                &new_expression.callee,
                constructor_name,
                &THREE_MODULES,
                analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &new_expression.callee,
                constructor_name,
                &THREE_MODULES,
                analysis,
                ctx,
            )
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
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            three_dynamic_buffer_resolves_to_constructor(
                initializer,
                constructor_names,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}
