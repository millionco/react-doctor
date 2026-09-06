use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, PropertyKey},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This useFrame callback binds an offscreen render target without restoring the default framebuffer on every path, so R3F or later subscribers can render to the wrong target";
const R3F_RENDER_TARGET_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const R3F_RENDERER_STATE_PROPERTY_NAMES: [&str; 2] = ["gl", "renderer"];
const RENDER_TARGET_CONSTRUCTOR_NAMES: [&str; 3] =
    ["RenderTarget", "WebGLCubeRenderTarget", "WebGLRenderTarget"];
const THREE_RENDER_TARGET_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct R3FRequireRenderTargetReset;

impl RuleMeta for R3FRequireRenderTargetReset {
    const NAME: &'static str = "r3f-require-render-target-reset";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require restoring R3F's default render target on every path.",
    };
}

struct R3fRenderTargetBinding {
    node_id: NodeId,
    renderer_key: String,
}

struct R3fRenderTargetReset {
    node_id: NodeId,
    renderer_key: String,
}

impl Rule for R3FRequireRenderTargetReset {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !program_references_r3f(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_RENDER_TARGET_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_RENDER_TARGET_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) {
                continue;
            }
            let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                callback_expression,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) else {
                continue;
            };
            for binding in r3f_render_target_uncovered_bindings(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
            ) {
                ctx.diagnostic(
                    OxcDiagnostic::error(MESSAGE)
                        .with_label(ctx.nodes().get_node(binding.node_id).span()),
                );
            }
        }
    }
}

fn r3f_render_target_uncovered_bindings<'a>(
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<R3fRenderTargetBinding> {
    let mut bindings = Vec::new();
    let mut resets = Vec::new();
    for &candidate_id in node_index.node_ids(callback_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        let callee = call_expression.callee.get_inner_expression();
        if let Some(member_expression) = callee.as_member_expression()
            && static_member_expression_property_name(member_expression) == Some("setRenderTarget")
            && r3f_render_target_is_frame_renderer_expression(
                member_expression.object(),
                callback_id,
                ctx,
            )
        {
            let renderer_key =
                resolve_expression_key(member_expression.object(), ctx, &mut Vec::new());
            let target = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression);
            if let (Some(renderer_key), Some(target)) = (renderer_key, target) {
                if matches!(target.get_inner_expression(), Expression::NullLiteral(_)) {
                    resets.push(R3fRenderTargetReset {
                        node_id: candidate_id,
                        renderer_key,
                    });
                } else if r3f_render_target_resolves_to_constructor(
                    target,
                    analysis,
                    ctx,
                    &mut Vec::new(),
                ) {
                    bindings.push(R3fRenderTargetBinding {
                        node_id: candidate_id,
                        renderer_key,
                    });
                }
            }
            continue;
        }
        if !is_imported_or_stable_parameter_call(call_expression, ctx, resolution_cache) {
            continue;
        }
        for argument in &call_expression.arguments {
            let Some(argument_expression) = argument.as_expression() else {
                continue;
            };
            if !r3f_render_target_is_frame_renderer_expression(
                argument_expression,
                callback_id,
                ctx,
            ) {
                continue;
            }
            if let Some(renderer_key) =
                resolve_expression_key(argument_expression, ctx, &mut Vec::new())
            {
                resets.push(R3fRenderTargetReset {
                    node_id: candidate_id,
                    renderer_key,
                });
            }
        }
    }

    let callback = ctx.nodes().get_node(callback_id);
    bindings
        .into_iter()
        .filter(|binding| {
            let binding_node = ctx.nodes().get_node(binding.node_id);
            let matching_reset_nodes = resets
                .iter()
                .filter(|reset| reset.renderer_key == binding.renderer_key)
                .map(|reset| ctx.nodes().get_node(reset.node_id))
                .collect::<Vec<_>>();
            !do_nodes_cover_every_path_after_node(
                binding_node,
                &matching_reset_nodes,
                callback,
                ctx,
            )
        })
        .collect()
}

fn r3f_render_target_is_frame_renderer_expression<'a>(
    expression: &Expression<'a>,
    callback_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let state_parameter = match ctx.nodes().get_node(callback_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .first()
            .map(|parameter| &parameter.pattern),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .first()
            .map(|parameter| &parameter.pattern),
        _ => None,
    };
    let Some(state_parameter) = state_parameter else {
        return false;
    };
    let expression = expression.get_inner_expression();
    if let BindingPattern::BindingIdentifier(state_identifier) = state_parameter {
        let Some(member_expression) = expression.as_member_expression() else {
            return false;
        };
        if !static_member_expression_property_name(member_expression)
            .is_some_and(|property_name| R3F_RENDERER_STATE_PROPERTY_NAMES.contains(&property_name))
        {
            return false;
        }
        let Expression::Identifier(object_identifier) =
            member_expression.object().get_inner_expression()
        else {
            return false;
        };
        return ctx
            .scoping()
            .get_reference(object_identifier.reference_id())
            .symbol_id()
            == Some(state_identifier.symbol_id());
    }
    let BindingPattern::ObjectPattern(state_pattern) = state_parameter else {
        return false;
    };
    let Expression::Identifier(candidate_identifier) = expression else {
        return false;
    };
    let Some(candidate_symbol_id) = ctx
        .scoping()
        .get_reference(candidate_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    state_pattern.properties.iter().any(|property| {
        r3f_render_target_property_key_matches(property)
            && matches!(
                &property.value,
                BindingPattern::BindingIdentifier(binding_identifier)
                    if binding_identifier.symbol_id() == candidate_symbol_id
            )
    })
}

fn r3f_render_target_property_key_matches(property: &oxc_ast::ast::BindingProperty<'_>) -> bool {
    let property_name = if property.computed {
        match &property.key {
            PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            PropertyKey::TemplateLiteral(template) if template.expressions.is_empty() => {
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
    } else {
        match &property.key {
            PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
            PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
            PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            _ => None,
        }
    };
    property_name
        .is_some_and(|property_name| R3F_RENDERER_STATE_PROPERTY_NAMES.contains(&property_name))
}

fn r3f_render_target_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        return RENDER_TARGET_CONSTRUCTOR_NAMES
            .iter()
            .any(|constructor_name| {
                module_api_reference_matches(
                    &new_expression.callee,
                    constructor_name,
                    &THREE_RENDER_TARGET_MODULES,
                    analysis,
                    ctx,
                ) || type_import_module_api_reference_matches(
                    &new_expression.callee,
                    constructor_name,
                    &THREE_RENDER_TARGET_MODULES,
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
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            r3f_render_target_resolves_to_constructor(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}
