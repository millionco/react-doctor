use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_UNIFORM_SOURCE_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const R3F_UNIFORM_SOURCE_MATERIAL_NAMES: [&str; 2] = ["rawShaderMaterial", "shaderMaterial"];
const MESSAGE: &str = "R3F copied this uniforms prop into the material, so mutating the source object in useFrame does not update the shader. Mutate the material ref's uniforms instead";

#[derive(Debug, Default, Clone)]
pub struct R3FNoMutateUniformPropSourceInUseFrame;

impl RuleMeta for R3FNoMutateUniformPropSourceInUseFrame {
    const NAME: &'static str = "r3f-no-mutate-uniform-prop-source-in-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow mutating copied R3F uniform prop sources in useFrame.",
    };
}

impl Rule for R3FNoMutateUniformPropSourceInUseFrame {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut source_symbol_ids = rustc_hash::FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let oxc_ast::ast::JSXElementName::Identifier(element_name) = &opening_element.name
            else {
                continue;
            };
            if !R3F_UNIFORM_SOURCE_MATERIAL_NAMES.contains(&element_name.name.as_str()) {
                continue;
            }
            let Some(uniforms_expression) =
                get_authoritative_jsx_attribute(opening_element, "uniforms", true)
                    .and_then(jsx_attribute_expression)
            else {
                continue;
            };
            if let Some(source_symbol_id) = r3f_uniform_source_root_symbol_id(
                uniforms_expression,
                ctx,
                &mut rustc_hash::FxHashSet::default(),
            ) {
                source_symbol_ids.insert(source_symbol_id);
            }
        }
        if source_symbol_ids.is_empty() {
            return;
        }

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
                &R3F_UNIFORM_SOURCE_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_UNIFORM_SOURCE_PUBLIC_MODULES,
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
            ) {
                continue;
            }
            if seen_callback_ids.insert(callback_id) {
                callback_ids.push(callback_id);
            }
        }

        for callback_id in callback_ids {
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, _, _| {
                    let root_identifier = match candidate.kind() {
                        AstKind::AssignmentExpression(assignment_expression) => {
                            r3f_uniform_assignment_target_root_identifier(
                                &assignment_expression.left,
                            )
                        }
                        AstKind::UpdateExpression(update_expression) => {
                            r3f_uniform_simple_assignment_target_root_identifier(
                                &update_expression.argument,
                            )
                        }
                        _ => None,
                    };
                    let Some(root_identifier) = root_identifier else {
                        return;
                    };
                    let Some(root_symbol_id) = r3f_uniform_source_root_identifier_symbol_id(
                        root_identifier,
                        ctx,
                        &mut rustc_hash::FxHashSet::default(),
                    ) else {
                        return;
                    };
                    if source_symbol_ids.contains(&root_symbol_id) {
                        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(candidate.span()));
                    }
                },
            );
        }
    }
}

fn r3f_uniform_source_root_symbol_id(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::SymbolId> {
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    r3f_uniform_source_root_identifier_symbol_id(identifier, ctx, visited_symbol_ids)
}

fn r3f_uniform_source_root_identifier_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::SymbolId> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
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
    let Some(initializer) =
        binding_pattern_initializer_for_symbol(&declarator.id, symbol_id, declarator.init.as_ref())
    else {
        return Some(symbol_id);
    };
    let oxc_ast::ast::Expression::Identifier(next_identifier) = initializer.get_inner_expression()
    else {
        return Some(symbol_id);
    };
    r3f_uniform_source_root_identifier_symbol_id(next_identifier, ctx, visited_symbol_ids)
}

fn r3f_uniform_assignment_target_root_identifier<'a>(
    target: &'a oxc_ast::ast::AssignmentTarget<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match target {
        oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) => Some(identifier),
        _ => r3f_uniform_member_root_identifier(target.as_member_expression()?.object()),
    }
}

fn r3f_uniform_simple_assignment_target_root_identifier<'a>(
    target: &'a oxc_ast::ast::SimpleAssignmentTarget<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match target {
        oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => {
            Some(identifier)
        }
        _ => r3f_uniform_member_root_identifier(target.as_member_expression()?.object()),
    }
}

fn r3f_uniform_member_root_identifier<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::Identifier(identifier) => Some(identifier),
        expression => {
            r3f_uniform_member_root_identifier(expression.as_member_expression()?.object())
        }
    }
}
