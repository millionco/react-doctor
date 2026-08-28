use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const CONSTRUCTOR_MESSAGE: &str = "This Three.js constructor allocates on every pointer movement. Reuse an object created outside the handler";
const CLONE_MESSAGE: &str = "This clone allocates a Three.js object on every pointer movement. Copy into a reusable object instead";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];

#[derive(Debug, Default, Clone)]
pub struct ThreeNoAllocationInPointerMove;

impl RuleMeta for ThreeNoAllocationInPointerMove {
    const NAME: &'static str = "three-no-allocation-in-pointer-move";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow Three.js allocations inside pointer-move handlers.",
    };
}

impl Rule for ThreeNoAllocationInPointerMove {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let has_pointer_move_candidate = ctx.nodes().iter().any(|node| match node.kind() {
            AstKind::CallExpression(call_expression) => call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .is_some_and(|expression| {
                    matches!(
                        expression.get_inner_expression(),
                        Expression::StringLiteral(literal) if literal.value == "pointermove"
                    )
                }),
            AstKind::JSXOpeningElement(opening_element) => {
                get_authoritative_jsx_attribute(opening_element, "onPointerMove", true).is_some()
            }
            _ => false,
        });
        if !has_pointer_move_candidate {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();
        let mut callback_executes_three_work_cache = rustc_hash::FxHashMap::default();

        for node in ctx.nodes().iter() {
            let callback_id = match node.kind() {
                AstKind::CallExpression(call_expression) => {
                    three_pointer_move_listener_callback_id(
                        call_expression,
                        &analysis,
                        ctx,
                        &mut resolution_cache,
                    )
                }
                AstKind::JSXOpeningElement(opening_element) => {
                    three_pointer_move_canvas_callback_id(
                        opening_element,
                        &analysis,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                        &mut callback_executes_three_work_cache,
                    )
                }
                _ => None,
            };
            let Some(callback_id) = callback_id else {
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
                    if let AstKind::NewExpression(allocation) = candidate.kind() {
                        if three_pointer_move_api_name(&allocation.callee, &analysis, ctx).is_some()
                        {
                            ctx.diagnostic(
                                OxcDiagnostic::warn(CONSTRUCTOR_MESSAGE)
                                    .with_label(candidate.span()),
                            );
                        }
                        return;
                    }
                    let AstKind::CallExpression(call_expression) = candidate.kind() else {
                        return;
                    };
                    let Some(callee) = call_expression.callee.as_member_expression() else {
                        return;
                    };
                    if static_member_expression_property_name(callee) == Some("clone")
                        && three_pointer_move_has_object_provenance(callee.object(), &analysis, ctx)
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(CLONE_MESSAGE).with_label(candidate.span()),
                        );
                    }
                },
            );
        }
    }
}

fn three_pointer_move_listener_callback_id<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<NodeId> {
    let callee = call_expression.callee.as_member_expression()?;
    if static_member_expression_property_name(callee) != Some("addEventListener") {
        return None;
    }
    let event_name = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)?;
    if !matches!(
        event_name.get_inner_expression(),
        Expression::StringLiteral(literal) if literal.value == "pointermove"
    ) {
        return None;
    }
    let listener_target = callee
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    if static_member_expression_property_name(listener_target) != Some("domElement")
        || !three_pointer_move_constructor_name(listener_target.object(), analysis, ctx)
            .is_some_and(|constructor_name| {
                THREE_RENDERER_CONSTRUCTOR_NAMES.contains(&constructor_name.as_str())
            })
    {
        return None;
    }
    resolve_r3f_analyzed_callback_function_id(
        call_expression.arguments.get(1)?.as_expression()?,
        analysis,
        ctx,
        resolution_cache,
    )
}

#[allow(clippy::too_many_arguments)]
fn three_pointer_move_canvas_callback_id<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    callback_executes_three_work_cache: &mut rustc_hash::FxHashMap<NodeId, bool>,
) -> Option<NodeId> {
    if resolve_jsx_element_type(opening_element, ctx).map(|(element_type, _)| element_type)
        != Some("canvas")
    {
        return None;
    }
    let handler_expression =
        get_authoritative_jsx_attribute(opening_element, "onPointerMove", true)
            .and_then(jsx_attribute_expression)?;
    let callback_id = resolve_r3f_analyzed_callback_function_id(
        handler_expression,
        analysis,
        ctx,
        resolution_cache,
    )?;
    if let Some(&executes_three_work) = callback_executes_three_work_cache.get(&callback_id) {
        return executes_three_work.then_some(callback_id);
    }
    let executes_three_work = three_pointer_move_callback_executes_three_work(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_executes_three_work_cache.insert(callback_id, executes_three_work);
    executes_three_work.then_some(callback_id)
}

fn three_pointer_move_callback_executes_three_work<'a>(
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
    let mut executes_three_work = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if executes_three_work {
                return;
            }
            match candidate.kind() {
                AstKind::NewExpression(allocation) => {
                    executes_three_work =
                        three_pointer_move_api_name(&allocation.callee, analysis, ctx).is_some();
                }
                AstKind::CallExpression(call_expression) => {
                    executes_three_work = call_expression
                        .callee
                        .as_member_expression()
                        .is_some_and(|callee| {
                            three_pointer_move_has_object_provenance(callee.object(), analysis, ctx)
                        });
                }
                AstKind::AssignmentExpression(assignment) => {
                    executes_three_work = assignment
                        .left
                        .get_expression()
                        .and_then(|target| target.get_inner_expression().as_member_expression())
                        .is_some_and(|target| {
                            three_pointer_move_has_object_provenance(target.object(), analysis, ctx)
                        });
                }
                AstKind::UpdateExpression(update) => {
                    executes_three_work = update
                        .argument
                        .get_expression()
                        .and_then(|target| target.get_inner_expression().as_member_expression())
                        .is_some_and(|target| {
                            three_pointer_move_has_object_provenance(target.object(), analysis, ctx)
                        });
                }
                _ => {}
            }
        },
    );
    executes_three_work
}

fn three_pointer_move_has_object_provenance<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let mut root = expression.get_inner_expression();
    while let Some(member_expression) = root.as_member_expression() {
        root = member_expression.object().get_inner_expression();
    }
    three_pointer_move_constructor_name(root, analysis, ctx).is_some()
}

fn three_pointer_move_constructor_name<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    three_pointer_move_constructor_name_inner(expression, analysis, ctx, &mut Vec::new())
}

fn three_pointer_move_constructor_name_inner<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::NewExpression(allocation) => {
            three_pointer_move_api_name(&allocation.callee, analysis, ctx)
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
            three_pointer_move_constructor_name_inner(
                declarator.init.as_ref()?,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn three_pointer_move_api_name<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let api_name = three_pointer_move_api_candidate_name(expression, ctx, &mut Vec::new())?;
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

fn three_pointer_move_api_candidate_name<'a>(
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
            return three_pointer_move_api_candidate_name(
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
