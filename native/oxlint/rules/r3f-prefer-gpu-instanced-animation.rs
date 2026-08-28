use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This useFrame loop recomputes instance matrices on the CPU every frame. Encode repeated transform motion in instanced attributes, a vertex shader, or GPU simulation";
const R3F_GPU_INSTANCED_ANIMATION_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const THREE_GPU_INSTANCED_ANIMATION_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct R3FPreferGpuInstancedAnimation;

impl RuleMeta for R3FPreferGpuInstancedAnimation {
    const NAME: &'static str = "r3f-prefer-gpu-instanced-animation";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Per-instance CPU transform animation in R3F useFrame.",
    };
}

impl Rule for R3FPreferGpuInstancedAnimation {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_r3f_runtime_import(ctx) {
            return;
        }

        let managed_ref_symbol_ids = r3f_gpu_instanced_animation_managed_ref_symbol_ids(ctx);
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut callback_ids = Vec::new();
        let mut seen_callback_ids = rustc_hash::FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_GPU_INSTANCED_ANIMATION_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_GPU_INSTANCED_ANIMATION_PUBLIC_MODULES,
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
            if matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) || !seen_callback_ids.insert(callback_id)
            {
                continue;
            }
            callback_ids.push(callback_id);
        }

        for callback_id in callback_ids {
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, _, _| {
                    let AstKind::CallExpression(candidate_call) = candidate.kind() else {
                        return;
                    };
                    let Some(member_expression) = candidate_call.callee.as_member_expression()
                    else {
                        return;
                    };
                    if static_member_expression_property_name(member_expression)
                        != Some("setMatrixAt")
                        || !node_is_inside_repeated_execution(candidate, ctx)
                        || !r3f_gpu_instanced_animation_receiver_is_instanced_mesh(
                            member_expression.object(),
                            &managed_ref_symbol_ids,
                            &analysis,
                            ctx,
                        )
                    {
                        return;
                    }
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}

fn r3f_gpu_instanced_animation_managed_ref_symbol_ids(
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashSet<oxc_semantic::SymbolId> {
    let mut managed_ref_symbol_ids = rustc_hash::FxHashSet::default();
    for node in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        let oxc_ast::ast::JSXElementName::Identifier(element_name) = &opening_element.name else {
            continue;
        };
        if element_name.name != "instancedMesh" || !is_r3f_host_intrinsic(opening_element, ctx) {
            continue;
        }
        let Some(Expression::Identifier(identifier)) =
            get_authoritative_jsx_attribute(opening_element, "ref", true)
                .and_then(|attribute| jsx_attribute_expression(attribute))
        else {
            continue;
        };
        if let Some(symbol_id) =
            r3f_gpu_instanced_animation_const_identifier_alias_symbol(identifier, ctx)
        {
            managed_ref_symbol_ids.insert(symbol_id);
        }
    }
    managed_ref_symbol_ids
}

fn r3f_gpu_instanced_animation_receiver_is_instanced_mesh<'a>(
    expression: &'a Expression<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    r3f_gpu_instanced_animation_resolves_to_constructor(expression, analysis, ctx, &mut Vec::new())
        || r3f_gpu_instanced_animation_react_ref_symbol(expression, ctx)
            .is_some_and(|symbol_id| managed_ref_symbol_ids.contains(&symbol_id))
}

fn r3f_gpu_instanced_animation_resolves_to_constructor<'a>(
    expression: &'a Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        return module_api_reference_matches(
            &new_expression.callee,
            "InstancedMesh",
            &THREE_GPU_INSTANCED_ANIMATION_MODULES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            &new_expression.callee,
            "InstancedMesh",
            &THREE_GPU_INSTANCED_ANIMATION_MODULES,
            analysis,
            ctx,
        );
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
    declarator.init.as_ref().is_some_and(|initializer| {
        r3f_gpu_instanced_animation_resolves_to_constructor(
            initializer,
            analysis,
            ctx,
            visited_symbol_ids,
        )
    })
}

fn r3f_gpu_instanced_animation_react_ref_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let current_member = expression.get_inner_expression().as_member_expression()?;
    if static_member_expression_property_name(current_member) != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = current_member.object().get_inner_expression() else {
        return None;
    };
    let symbol_id = r3f_gpu_instanced_animation_const_identifier_alias_symbol(identifier, ctx)?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let Some(Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return None;
    };
    (is_react_api_call(call_expression, "useRef", ctx)
        || is_react_api_call(call_expression, "createRef", ctx))
    .then_some(symbol_id)
}

fn r3f_gpu_instanced_animation_const_identifier_alias_symbol(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
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
        let initializer = declarator.init.as_ref()?.get_inner_expression();
        let Expression::Identifier(next_identifier) = initializer else {
            return Some(symbol_id);
        };
        symbol_id = ctx
            .scoping()
            .get_reference(next_identifier.reference_id())
            .symbol_id()?;
    }
}
