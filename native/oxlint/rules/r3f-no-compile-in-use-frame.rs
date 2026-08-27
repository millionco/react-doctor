use oxc_ast::{AstKind, ast::BindingPattern};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "Renderer shader precompilation runs inside useFrame. Compile once before display instead of rechecking the scene every frame";
const R3F_PUBLIC_MODULE_SOURCES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoCompileInUseFrame;

impl RuleMeta for R3FNoCompileInUseFrame {
    const NAME: &'static str = "r3f-no-compile-in-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow renderer shader compilation inside useFrame.",
    };
}

impl Rule for R3FNoCompileInUseFrame {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut analyzed_callback_ids = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(use_frame_call) = node.kind() else {
                continue;
            };
            if !module_api_path_matches(
                &use_frame_call.callee,
                &["useFrame"],
                &R3F_PUBLIC_MODULE_SOURCES,
                false,
                ctx,
            ) {
                continue;
            }
            let Some(callback_expression) = use_frame_call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some((_, callback_span)) = resolve_local_react_callback(callback_expression, ctx)
            else {
                continue;
            };
            let Some(callback_id) = ctx.nodes().iter().find_map(|candidate| {
                (candidate.span() == callback_span
                    && matches!(
                        candidate.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    ))
                .then_some(candidate.id())
            }) else {
                continue;
            };
            if analyzed_callback_ids.contains(&callback_id) {
                continue;
            }
            analyzed_callback_ids.push(callback_id);
            report_callback_compilation(callback_id, ctx);
        }
    }
}

fn report_callback_compilation(callback_id: NodeId, ctx: &LintContext<'_>) {
    let mut execution_function_ids = vec![callback_id];
    let mut execution_index = 0;
    while execution_index < execution_function_ids.len() {
        let execution_function_id = execution_function_ids[execution_index];
        execution_index += 1;
        for candidate in ctx.nodes().iter() {
            if nearest_function_id(candidate.id(), ctx) != Some(execution_function_id) {
                continue;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                continue;
            };
            if call_expression
                .callee
                .as_member_expression()
                .is_some_and(|member_expression| {
                    matches!(
                        member_expression.static_property_name(),
                        Some("compile" | "compileAsync")
                    ) && resolves_to_callback_renderer(
                        member_expression.object(),
                        callback_id,
                        ctx,
                        &mut Vec::new(),
                    )
                })
            {
                ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(candidate.span()));
            }
            if let Some(called_function_id) =
                exact_local_function_id(&call_expression.callee, ctx, &mut Vec::new())
                && !execution_function_ids.contains(&called_function_id)
            {
                execution_function_ids.push(called_function_id);
            }
        }
    }
}

fn nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn exact_local_function_id<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        oxc_ast::ast::Expression::FunctionExpression(function) if !function.generator => {
            Some(function.node_id.get())
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) if !function.generator => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) && declarator.id.get_binding_identifier().is_some_and(
                        |binding_identifier| binding_identifier.symbol_id() == symbol_id,
                    ) =>
                {
                    exact_local_function_id(declarator.init.as_ref()?, ctx, visited_symbol_ids)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn resolves_to_callback_renderer<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    callback_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return matches!(
            member_expression.static_property_name(),
            Some("gl" | "renderer")
        ) && resolves_to_callback_state(
            member_expression.object(),
            callback_id,
            ctx,
            visited_symbol_ids,
        );
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if callback_parameter_property_symbol_matches(callback_id, symbol_id, ctx) {
        return true;
    }
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
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            resolves_to_callback_renderer(initializer, callback_id, ctx, visited_symbol_ids)
        });
    }
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        (property_key_matches_name(&property.key, "gl")
            || property_key_matches_name(&property.key, "renderer"))
            && property
                .value
                .get_binding_identifier()
                .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
    }) && declarator.init.as_ref().is_some_and(|initializer| {
        resolves_to_callback_state(initializer, callback_id, ctx, visited_symbol_ids)
    })
}

fn resolves_to_callback_state<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    callback_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if callback_parameter_symbol(callback_id, ctx) == Some(symbol_id) {
        return true;
    }
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
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            resolves_to_callback_state(initializer, callback_id, ctx, visited_symbol_ids)
        })
}

fn callback_parameter_symbol(callback_id: NodeId, ctx: &LintContext<'_>) -> Option<SymbolId> {
    callback_first_parameter(callback_id, ctx)?
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
}

fn callback_parameter_property_symbol_matches(
    callback_id: NodeId,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(BindingPattern::ObjectPattern(pattern)) = callback_first_parameter(callback_id, ctx)
    else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        (property_key_matches_name(&property.key, "gl")
            || property_key_matches_name(&property.key, "renderer"))
            && property
                .value
                .get_binding_identifier()
                .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
    })
}

fn callback_first_parameter<'a, 'b>(
    callback_id: NodeId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b BindingPattern<'a>> {
    match ctx.nodes().get_node(callback_id).kind() {
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
    }
}
