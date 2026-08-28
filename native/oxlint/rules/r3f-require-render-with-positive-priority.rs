use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const EXTERNAL_RENDER_OWNER_MODULE: &str = "@react-three/postprocessing";
const NON_RENDERER_RENDER_MODULES: [&str; 6] = [
    "ejs",
    "handlebars",
    "markdown-it",
    "marked",
    "mermaid",
    "mustache",
];
const R3F_POSITIVE_PRIORITY_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const MESSAGE: &str = "A positive useFrame priority disables R3F's automatic render. No gl.render, renderer.render, or composer.render call is visible in this module's positive-priority subscriptions";

#[derive(Debug, Default, Clone)]
pub struct R3FRequireRenderWithPositivePriority;

impl RuleMeta for R3FRequireRenderWithPositivePriority {
    const NAME: &'static str = "r3f-require-render-with-positive-priority";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require positive-priority frame subscriptions to render.",
    };
}

impl Rule for R3FRequireRenderWithPositivePriority {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut positive_subscription_ids = Vec::new();
        let mut has_render_sink = false;
        let mut has_unresolved_callback = false;

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_POSITIVE_PRIORITY_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_POSITIVE_PRIORITY_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) {
                continue;
            }
            let Some(priority) = call_expression
                .arguments
                .get(1)
                .and_then(oxc_ast::ast::Argument::as_expression)
                .and_then(|expression| resolve_static_number(expression, ctx))
            else {
                continue;
            };
            if priority <= 0.0 {
                continue;
            }
            let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                has_unresolved_callback = true;
                continue;
            };
            let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                callback_expression,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) else {
                has_unresolved_callback = true;
                continue;
            };
            if r3f_positive_priority_is_explicit_null_noop_callback(callback_id, ctx) {
                continue;
            }
            positive_subscription_ids.push(node.id());
            if !has_render_sink
                && r3f_positive_priority_callback_has_render_sink(
                    callback_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                )
            {
                has_render_sink = true;
            }
        }

        if has_render_sink
            || has_unresolved_callback
            || positive_subscription_ids.is_empty()
            || r3f_positive_priority_has_external_render_owner(&analysis, ctx)
        {
            return;
        }
        for subscription_id in positive_subscription_ids {
            let subscription = ctx.nodes().get_node(subscription_id);
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(subscription.span()));
        }
    }
}

fn r3f_positive_priority_is_explicit_null_noop_callback(
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    match ctx.nodes().get_node(callback_id).kind() {
        AstKind::ArrowFunctionExpression(function) => {
            if function.r#async {
                return false;
            }
            if let Some(expression) = function.get_expression() {
                return matches!(
                    expression.get_inner_expression(),
                    Expression::NullLiteral(_)
                );
            }
            r3f_positive_priority_body_returns_only_explicit_null(
                function
                    .body
                    .as_function_body()
                    .map(|body| body.statements.as_slice()),
            )
        }
        AstKind::Function(function) => {
            !function.r#async
                && !function.generator
                && r3f_positive_priority_body_returns_only_explicit_null(
                    function
                        .body
                        .as_ref()
                        .map(|body| body.statements.as_slice()),
                )
        }
        _ => false,
    }
}

fn r3f_positive_priority_body_returns_only_explicit_null(
    statements: Option<&[oxc_ast::ast::Statement<'_>]>,
) -> bool {
    let Some([oxc_ast::ast::Statement::ReturnStatement(statement)]) = statements else {
        return false;
    };
    matches!(
        statement
            .argument
            .as_ref()
            .map(Expression::get_inner_expression),
        Some(Expression::NullLiteral(_))
    )
}

fn r3f_positive_priority_callback_has_render_sink<'a>(
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
    let mut has_render_sink = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if has_render_sink {
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
            if !matches!(
                static_member_expression_property_name(member_expression),
                Some("render" | "renderAsync")
            ) || r3f_positive_priority_is_proven_non_renderer_render_receiver(
                member_expression.object(),
                ctx,
            ) {
                return;
            }
            has_render_sink = true;
        },
    );
    has_render_sink
}

fn r3f_positive_priority_is_proven_non_renderer_render_receiver<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    r3f_positive_priority_imported_receiver_module_source(expression, ctx, &mut Vec::new())
        .is_some_and(|module_source| NON_RENDERER_RENDER_MODULES.contains(&module_source.as_str()))
}

fn r3f_positive_priority_imported_receiver_module_source<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if matches!(expression, Expression::CallExpression(_))
        && let Some(module_source) = global_require_module_source(expression, ctx)
    {
        return Some(module_source.to_string());
    }
    let Expression::Identifier(identifier) = expression else {
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
    if let Some(import_entry) = ctx.module_record().import_entries.iter().find(|entry| {
        ctx.scoping()
            .get_root_binding(entry.local_name.name().into())
            == Some(symbol_id)
    }) {
        return Some(import_entry.module_request.name().to_string());
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::ExternalModuleReference(reference) =
            &import_equals.module_reference
        else {
            return None;
        };
        return Some(reference.expression.value.to_string());
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
    r3f_positive_priority_imported_receiver_module_source(
        declarator.init.as_ref()?,
        ctx,
        visited_symbol_ids,
    )
}

fn r3f_positive_priority_has_external_render_owner<'a>(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|node| {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return false;
        };
        jsx_module_api_reference_matches(
            &opening_element.name,
            "EffectComposer",
            &[EXTERNAL_RENDER_OWNER_MODULE],
            analysis,
            ctx,
        )
    })
}
