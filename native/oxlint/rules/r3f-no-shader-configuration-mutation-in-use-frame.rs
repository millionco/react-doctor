use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_SHADER_CONFIGURATION_MATERIAL_NAMES: [&str; 2] = ["rawShaderMaterial", "shaderMaterial"];
const R3F_SHADER_CONFIGURATION_PROPERTY_NAMES: [&str; 6] = [
    "defines",
    "extensions",
    "fragmentShader",
    "glslVersion",
    "uniforms",
    "vertexShader",
];
const R3F_SHADER_CONFIGURATION_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const MESSAGE: &str = "This useFrame callback rewrites shader program configuration every frame. Keep it stable and update existing uniform values instead";

#[derive(Debug, Default, Clone)]
pub struct R3FNoShaderConfigurationMutationInUseFrame;

impl RuleMeta for R3FNoShaderConfigurationMutationInUseFrame {
    const NAME: &'static str = "r3f-no-shader-configuration-mutation-in-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow shader program configuration mutation inside useFrame.",
    };
}

impl Rule for R3FNoShaderConfigurationMutationInUseFrame {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let managed_ref_symbol_ids = r3f_shader_configuration_managed_ref_symbol_ids(ctx);
        if managed_ref_symbol_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_SHADER_CONFIGURATION_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_SHADER_CONFIGURATION_PUBLIC_MODULES,
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
            ) || !analyzed_callback_ids.insert(callback_id)
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
                    let AstKind::AssignmentExpression(assignment_expression) = candidate.kind()
                    else {
                        return;
                    };
                    let Some(receiver) =
                        r3f_shader_configuration_mutation_receiver(assignment_expression)
                    else {
                        return;
                    };
                    if r3f_shader_configuration_managed_ref_current_symbol(receiver, ctx)
                        .is_some_and(|symbol_id| managed_ref_symbol_ids.contains(&symbol_id))
                    {
                        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(candidate.span()));
                    }
                },
            );
        }
    }
}

fn r3f_shader_configuration_managed_ref_symbol_ids(
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
        if !R3F_SHADER_CONFIGURATION_MATERIAL_NAMES.contains(&element_name.name.as_str())
            || !is_r3f_host_intrinsic(opening_element, ctx)
        {
            continue;
        }
        let Some(Expression::Identifier(identifier)) =
            get_authoritative_jsx_attribute(opening_element, "ref", true)
                .and_then(jsx_attribute_expression)
        else {
            continue;
        };
        if let Some(symbol_id) =
            r3f_shader_configuration_const_identifier_alias_symbol(identifier, ctx)
        {
            managed_ref_symbol_ids.insert(symbol_id);
        }
    }
    managed_ref_symbol_ids
}

fn r3f_shader_configuration_mutation_receiver<'a>(
    assignment_expression: &'a oxc_ast::ast::AssignmentExpression<'a>,
) -> Option<&'a Expression<'a>> {
    let target = assignment_expression
        .left
        .as_member_expression()
        .or_else(|| {
            assignment_expression
                .left
                .get_expression()?
                .get_inner_expression()
                .as_member_expression()
        })?;
    if static_member_expression_property_name(target).is_some_and(|property_name| {
        R3F_SHADER_CONFIGURATION_PROPERTY_NAMES.contains(&property_name)
    }) {
        return Some(target.object());
    }
    let parent_member = target
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    (static_member_expression_property_name(parent_member) == Some("defines"))
        .then(|| parent_member.object())
}

fn r3f_shader_configuration_managed_ref_current_symbol(
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
    r3f_shader_configuration_const_identifier_alias_symbol(identifier, ctx)
}

fn r3f_shader_configuration_const_identifier_alias_symbol(
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
