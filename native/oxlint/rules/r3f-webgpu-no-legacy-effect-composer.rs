use oxc_ast::{
    AstKind,
    ast::{Expression, FunctionType, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const EFFECT_COMPOSER_MODULES: [&str; 1] = ["@react-three/postprocessing"];
const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const THREE_WEBGPU_MODULES: [&str; 2] = ["three", "three/"];
const MESSAGE: &str = "@react-three/postprocessing EffectComposer targets the legacy WebGL pipeline and cannot render this WebGPU Canvas. Use the node-based render pipeline";

#[derive(Debug, Default, Clone)]
pub struct R3FWebgpuNoLegacyEffectComposer;

impl RuleMeta for R3FWebgpuNoLegacyEffectComposer {
    const NAME: &'static str = "r3f-webgpu-no-legacy-effect-composer";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow legacy EffectComposer in R3F WebGPU roots.",
    };
}

impl Rule for R3FWebgpuNoLegacyEffectComposer {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !program_references_r3f(ctx) {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        let composer_node_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                    return None;
                };
                jsx_module_api_reference_matches(
                    &opening_element.name,
                    "EffectComposer",
                    &EFFECT_COMPOSER_MODULES,
                    &analysis,
                    ctx,
                )
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if composer_node_ids.is_empty() {
            return;
        }

        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        let mut webgpu_canvas_cache = FxHashMap::default();
        for composer_node_id in composer_node_ids {
            if !r3f_webgpu_is_inside_canvas(
                composer_node_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut assigned_expression_cache,
                &mut webgpu_canvas_cache,
            ) && !r3f_webgpu_is_inside_local_component(
                composer_node_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut assigned_expression_cache,
                &mut webgpu_canvas_cache,
            ) {
                continue;
            }
            let opening_element = ctx.nodes().get_node(composer_node_id);
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(opening_element.span()));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn r3f_webgpu_is_inside_canvas<'a>(
    node_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    webgpu_canvas_cache: &mut FxHashMap<NodeId, bool>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        let AstKind::JSXElement(canvas) = ancestor.kind() else {
            continue;
        };
        let Some(canvas_module) =
            r3f_webgpu_canvas_module(&canvas.opening_element.name, analysis, ctx)
        else {
            continue;
        };
        if let Some(&is_webgpu) = webgpu_canvas_cache.get(&ancestor.id()) {
            return is_webgpu;
        }
        let is_webgpu = canvas_module == "@react-three/fiber/webgpu"
            || r3f_webgpu_canvas_creates_renderer(
                canvas,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
            );
        webgpu_canvas_cache.insert(ancestor.id(), is_webgpu);
        return is_webgpu;
    }
    false
}

fn r3f_webgpu_canvas_module<'a>(
    element_name: &JSXElementName<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    R3F_PUBLIC_MODULES.into_iter().find(|module_source| {
        jsx_module_api_reference_matches(element_name, "Canvas", &[*module_source], analysis, ctx)
    })
}

fn r3f_webgpu_canvas_creates_renderer<'a>(
    canvas: &oxc_ast::ast::JSXElement<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    let Some(factory_expression) =
        get_authoritative_jsx_attribute(&canvas.opening_element, "gl", true)
            .and_then(jsx_attribute_expression)
    else {
        return false;
    };
    if r3f_webgpu_is_renderer_expression(factory_expression, analysis, ctx) {
        return true;
    }
    let Some(factory_id) = resolve_r3f_analyzed_callback_function_id(
        factory_expression,
        analysis,
        ctx,
        resolution_cache,
    ) else {
        return false;
    };
    r3f_webgpu_function_returns_renderer_on_every_path(
        factory_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        assigned_expression_cache,
        &mut Vec::new(),
    )
}

fn r3f_webgpu_is_renderer_expression<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::NewExpression(constructor) = expression.get_inner_expression() else {
        return false;
    };
    module_api_reference_matches(
        &constructor.callee,
        "WebGPURenderer",
        &THREE_WEBGPU_MODULES,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        &constructor.callee,
        "WebGPURenderer",
        &THREE_WEBGPU_MODULES,
        analysis,
        ctx,
    )
}

#[allow(clippy::too_many_arguments)]
fn r3f_webgpu_function_returns_renderer_on_every_path<'a>(
    function_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    if visited_function_ids.contains(&function_id) {
        return false;
    }
    visited_function_ids.push(function_id);
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        let matches = r3f_webgpu_return_expression_matches(
            expression,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            visited_function_ids,
            &mut Vec::new(),
        );
        visited_function_ids.pop();
        return matches;
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
    let Some(body_statements) = body_statements else {
        visited_function_ids.pop();
        return false;
    };
    let mut returned_expressions = Vec::new();
    let mut has_bare_return = false;
    for &candidate_id in node_index.node_ids(function_id) {
        let AstKind::ReturnStatement(statement) = ctx.nodes().get_node(candidate_id).kind() else {
            continue;
        };
        if let Some(argument) = statement.argument.as_ref() {
            returned_expressions.push(argument);
        } else {
            has_bare_return = true;
        }
    }
    let matches = !has_bare_return
        && body_statements.iter().any(statement_always_exits)
        && !returned_expressions.is_empty()
        && returned_expressions.into_iter().all(|expression| {
            r3f_webgpu_return_expression_matches(
                expression,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut Vec::new(),
            )
        });
    visited_function_ids.pop();
    matches
}

#[allow(clippy::too_many_arguments)]
fn r3f_webgpu_return_expression_matches<'a>(
    expression: &'a Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if r3f_webgpu_is_renderer_expression(expression, analysis, ctx) {
        return true;
    }
    match expression {
        Expression::Identifier(identifier) => {
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
            let assigned_expressions = r3f_analyzed_possible_assigned_expressions(
                identifier,
                symbol_id,
                ctx,
                assigned_expression_cache,
            );
            let matches = !assigned_expressions.is_empty()
                && assigned_expressions.into_iter().all(|assigned_expression| {
                    !matches!(
                        assigned_expression.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) && r3f_webgpu_return_expression_matches(
                        assigned_expression,
                        analysis,
                        node_index,
                        ctx,
                        resolution_cache,
                        assigned_expression_cache,
                        visited_function_ids,
                        &mut visited_symbol_ids.clone(),
                    )
                });
            visited_symbol_ids.pop();
            matches
        }
        Expression::CallExpression(call_expression)
            if call_expression.arguments.is_empty()
                && matches!(&call_expression.callee, Expression::Identifier(_)) =>
        {
            r3f_webgpu_zero_argument_function_id(call_expression, ctx).is_some_and(
                |called_function_id| {
                    r3f_webgpu_function_returns_renderer_on_every_path(
                        called_function_id,
                        analysis,
                        node_index,
                        ctx,
                        resolution_cache,
                        assigned_expression_cache,
                        visited_function_ids,
                    )
                },
            )
        }
        Expression::ConditionalExpression(conditional) => {
            r3f_webgpu_return_expression_matches(
                &conditional.consequent,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) && r3f_webgpu_return_expression_matches(
                &conditional.alternate,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::LogicalExpression(logical) => {
            r3f_webgpu_return_expression_matches(
                &logical.left,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) && r3f_webgpu_return_expression_matches(
                &logical.right,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            )
        }
        _ => false,
    }
}

fn r3f_webgpu_zero_argument_function_id(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let Expression::Identifier(identifier) = &call_expression.callee else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_id = match declaration.kind() {
        AstKind::Function(function) => {
            (!function.r#async && !function.generator && function.params.items.is_empty())
                .then_some(declaration.id())
        }
        AstKind::VariableDeclarator(declarator) => {
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
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            match initializer {
                Expression::ArrowFunctionExpression(function)
                    if !function.r#async && function.params.items.is_empty() =>
                {
                    Some(function.node_id.get())
                }
                Expression::FunctionExpression(function)
                    if !function.r#async
                        && !function.generator
                        && function.params.items.is_empty() =>
                {
                    Some(function.node_id.get())
                }
                _ => None,
            }
        }
        _ => None,
    }?;
    Some(function_id)
}

#[allow(clippy::too_many_arguments)]
fn r3f_webgpu_is_inside_local_component<'a>(
    node_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    webgpu_canvas_cache: &mut FxHashMap<NodeId, bool>,
) -> bool {
    let Some(component_function_id) = local_callback_nearest_function_id(node_id, ctx) else {
        return false;
    };
    let Some(component_symbol_id) = r3f_webgpu_local_component_symbol(component_function_id, ctx)
    else {
        return false;
    };
    r3f_webgpu_component_is_rendered_inside_canvas(
        component_symbol_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        assigned_expression_cache,
        webgpu_canvas_cache,
        &mut FxHashSet::default(),
    )
}

fn r3f_webgpu_local_component_symbol(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::Function(function) = function_node.kind()
        && function.r#type == FunctionType::FunctionDeclaration
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    let mut expression_root = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            break;
        };
        if !call_expression.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == expression_root.span())
        }) || !r3f_webgpu_is_react_hoc_call(call_expression)
        {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    let declaration = ctx.nodes().parent_node(expression_root.id());
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != expression_root.span())
    {
        return None;
    }
    declarator
        .id
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
}

fn r3f_webgpu_is_react_hoc_call(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            matches!(identifier.name.as_str(), "memo" | "forwardRef")
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name().is_some_and(|property_name| {
                matches!(property_name, "memo" | "forwardRef")
                    && matches!(
                        member.object().get_inner_expression(),
                        Expression::Identifier(identifier) if identifier.name == "React"
                    )
            })
        }),
    }
}

#[allow(clippy::too_many_arguments)]
fn r3f_webgpu_component_is_rendered_inside_canvas<'a>(
    component_symbol_id: SymbolId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    webgpu_canvas_cache: &mut FxHashMap<NodeId, bool>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&component_symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(component_symbol_id)
            .any(|reference| !reference.is_read() || reference.is_write())
    {
        return false;
    }
    visited_symbol_ids.insert(component_symbol_id);
    let reference_node_ids = ctx
        .scoping()
        .get_resolved_references(component_symbol_id)
        .map(|reference| reference.node_id())
        .collect::<Vec<_>>();
    for reference_node_id in reference_node_ids {
        let reference_node = ctx.nodes().get_node(reference_node_id);
        let opening_element_node = ctx.nodes().parent_node(reference_node.id());
        let AstKind::JSXOpeningElement(opening_element) = opening_element_node.kind() else {
            continue;
        };
        if !matches!(
            &opening_element.name,
            JSXElementName::IdentifierReference(identifier)
                if identifier.node_id.get() == reference_node_id
        ) {
            continue;
        }
        if r3f_webgpu_is_inside_canvas(
            opening_element_node.id(),
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            webgpu_canvas_cache,
        ) {
            visited_symbol_ids.remove(&component_symbol_id);
            return true;
        }
        let Some(enclosing_component_id) =
            r3f_webgpu_enclosing_component_without_canvas(opening_element_node.id(), analysis, ctx)
        else {
            continue;
        };
        let Some(enclosing_component_symbol_id) =
            r3f_webgpu_local_component_symbol(enclosing_component_id, ctx)
        else {
            continue;
        };
        if r3f_webgpu_component_is_rendered_inside_canvas(
            enclosing_component_symbol_id,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            webgpu_canvas_cache,
            visited_symbol_ids,
        ) {
            visited_symbol_ids.remove(&component_symbol_id);
            return true;
        }
    }
    visited_symbol_ids.remove(&component_symbol_id);
    false
}

fn r3f_webgpu_enclosing_component_without_canvas(
    node_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if let AstKind::JSXElement(element) = ancestor.kind()
            && r3f_webgpu_canvas_module(&element.opening_element.name, analysis, ctx).is_some()
        {
            return None;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return Some(ancestor.id());
        }
    }
    None
}
