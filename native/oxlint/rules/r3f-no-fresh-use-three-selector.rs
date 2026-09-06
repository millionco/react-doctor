use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const MESSAGE: &str = "This selector creates a new object or array whenever the R3F store updates, defeating reference equality and causing avoidable React renders. Select a stable field or provide equality";

#[derive(Debug, Default, Clone)]
pub struct R3FNoFreshUseThreeSelector;

impl RuleMeta for R3FNoFreshUseThreeSelector {
    const NAME: &'static str = "r3f-no-fresh-use-three-selector";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow fresh object or array results from useThree selectors.",
    };
}

impl Rule for R3FNoFreshUseThreeSelector {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let selector_call_nodes = ctx
            .nodes()
            .iter()
            .filter(|node| {
                matches!(node.kind(), AstKind::CallExpression(call_expression)
                if call_expression.arguments.len() <= 1
                    && module_api_reference_might_match(
                        &call_expression.callee,
                        "useThree",
                        &R3F_PUBLIC_MODULES,
                        ctx,
                    ))
            })
            .collect::<Vec<_>>();
        if selector_call_nodes.is_empty() {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut selector_ids = Vec::new();
        for node in selector_call_nodes {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useThree",
                &R3F_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) {
                continue;
            }
            let Some(selector_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(selector_id) = fresh_selector_callback_node_id(
                selector_expression,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) else {
                continue;
            };
            selector_ids.push(selector_id);
        }
        if selector_ids.is_empty() {
            return;
        }
        let fresh_return_spans = fresh_selector_return_spans_by_id(&selector_ids, ctx);
        for selector_id in selector_ids {
            let Some(returned_expression_span) =
                fresh_return_spans.get(&selector_id).copied().flatten()
            else {
                continue;
            };
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(returned_expression_span));
        }
    }
}

fn fresh_selector_callback_node_id<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    if let Some(function_id) =
        fresh_selector_exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
    {
        return Some(function_id);
    }
    let wrapper_call = fresh_selector_wrapper_call(expression, ctx, &mut Vec::new())?;
    if !fresh_selector_react_use_callback_matches(wrapper_call, analysis, ctx) {
        return None;
    }
    let callback = wrapper_call.arguments.first()?.as_expression()?;
    fresh_selector_exact_local_function_id(callback, ctx, &mut Vec::new(), resolution_cache)
}

fn fresh_selector_exact_local_function_id<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    let expression = expression.get_inner_expression();
    match expression {
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        oxc_ast::ast::Expression::FunctionExpression(function) => Some(function.node_id.get()),
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            if let AstKind::Function(_) = declaration.kind() {
                return (!cached_symbol_has_write(symbol_id, ctx, resolution_cache))
                    .then_some(declaration.id());
            }
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
            fresh_selector_exact_local_function_id(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
                resolution_cache,
            )
        }
        _ => exact_local_function_id(expression, ctx, visited_symbol_ids, resolution_cache),
    }
}

fn fresh_selector_wrapper_call<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::CallExpression(call_expression) = expression {
        return Some(call_expression);
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
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
    fresh_selector_wrapper_call(declarator.init.as_ref()?, ctx, visited_symbol_ids)
}

fn fresh_selector_react_use_callback_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    fresh_selector_direct_react_use_callback_matches(call_expression, ctx)
        || module_api_reference_matches(
            &call_expression.callee,
            "useCallback",
            &REACT_RUNTIME_MODULES,
            analysis,
            ctx,
        )
}

fn fresh_selector_direct_react_use_callback_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if callee.as_member_expression().is_some() {
        return is_react_api_call(call_expression, "useCallback", ctx)
            && !fresh_selector_is_global_react_namespace_call(call_expression, ctx);
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = callee else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && REACT_RUNTIME_MODULES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "useCallback"
            )
    })
}

fn fresh_selector_is_global_react_namespace_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let oxc_ast::ast::Expression::Identifier(identifier) =
        member_expression.object().get_inner_expression()
    else {
        return false;
    };
    identifier.name == "React"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn fresh_selector_return_spans_by_id<'a>(
    selector_ids: &[oxc_semantic::NodeId],
    ctx: &LintContext<'a>,
) -> rustc_hash::FxHashMap<oxc_semantic::NodeId, Option<oxc_span::Span>> {
    let mut fresh_return_spans = rustc_hash::FxHashMap::default();
    for selector_id in selector_ids {
        if fresh_return_spans.contains_key(selector_id) {
            continue;
        }
        let fresh_return_span = if let AstKind::ArrowFunctionExpression(function) =
            ctx.nodes().get_node(*selector_id).kind()
            && let Some(expression) = function.get_expression()
            && resolve_r3f_fresh_value(expression, ctx, &[])
                .is_some_and(|fresh_kind| matches!(fresh_kind, "object" | "array"))
        {
            Some(strip_parenthesized_expression(expression).span())
        } else {
            None
        };
        fresh_return_spans.insert(*selector_id, fresh_return_span);
    }
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        let Some(selector_id) = local_callback_nearest_function_id(candidate.id(), ctx) else {
            continue;
        };
        let Some(fresh_return_span) = fresh_return_spans.get_mut(&selector_id) else {
            continue;
        };
        if fresh_return_span.is_some() {
            continue;
        }
        let Some(expression) = return_statement.argument.as_ref() else {
            continue;
        };
        if resolve_r3f_fresh_value(expression, ctx, &[])
            .is_some_and(|fresh_kind| matches!(fresh_kind, "object" | "array"))
        {
            *fresh_return_span = Some(strip_parenthesized_expression(expression).span());
        }
    }
    fresh_return_spans
}
