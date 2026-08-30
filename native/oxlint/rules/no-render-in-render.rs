use oxc_ast::{
    AstKind,
    ast::{Argument, ChainElement, Expression, FunctionType},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::{is_es5_component, is_es6_component},
};

#[derive(Debug, Default, Clone)]
pub struct NoRenderInRender;

declare_oxc_lint!(
    /// Warns when a hook-calling render helper is invoked inline from JSX.
    NoRenderInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a hook-calling render helper is invoked inline from JSX.",
);

impl Rule for NoRenderInRender {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut helper_hook_cache = rustc_hash::FxHashMap::default();
        let mut function_resolution_cache = LocalFunctionResolutionCache::default();
        for container_node in ctx.nodes().iter() {
            let AstKind::JSXExpressionContainer(container) = container_node.kind() else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            let Some(call_expression) = render_in_render_direct_call(expression) else {
                continue;
            };
            let Expression::Identifier(callee) = &call_expression.callee else {
                continue;
            };
            if !render_in_render_name_matches(callee.name.as_str())
                || !render_in_render_is_inside_component(container_node, ctx)
            {
                continue;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(callee.reference_id())
                .symbol_id()
            else {
                continue;
            };
            let Some(helper_function_id) =
                render_in_render_declared_helper_function(symbol_id, ctx)
            else {
                continue;
            };
            let root_span = ctx.nodes().get_node(helper_function_id).span();
            let reaches_hook = *helper_hook_cache
                .entry(helper_function_id)
                .or_insert_with(|| {
                    render_in_render_function_reaches_hook(
                        helper_function_id,
                        root_span,
                        ctx,
                        &mut rustc_hash::FxHashSet::default(),
                        &mut function_resolution_cache,
                    )
                });
            if !reaches_hook {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "\"{}()\" hides a component behind an inline call, so pull it into its own component and render it as JSX so React can track it.",
                    callee.name
                ))
                .with_label(call_expression.span),
            );
        }
    }
}

fn render_in_render_direct_call<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    match expression {
        Expression::CallExpression(call_expression) => Some(call_expression),
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::CallExpression(call_expression) => Some(call_expression),
            _ => None,
        },
        _ => None,
    }
}

fn render_in_render_name_matches(name: &str) -> bool {
    name.strip_prefix("render")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}

fn render_in_render_is_inside_component(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        render_in_render_is_component_function(ancestor, ctx)
            || is_es5_component(ancestor)
            || is_es6_component(ancestor)
    })
}

fn render_in_render_is_component_function(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    match node.kind() {
        AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration => {
            function.id.as_ref().is_none_or(|identifier| {
                identifier.name == "default"
                    || render_in_render_is_uppercase_name(identifier.name.as_str())
            }) || matches!(
                ctx.nodes().parent_node(node.id()).kind(),
                AstKind::ExportDefaultDeclaration(_)
            )
        }
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            render_in_render_is_component_expression(node, ctx)
        }
        _ => false,
    }
}

fn render_in_render_is_component_expression(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current = ctx.nodes().parent_node(node.id());
    loop {
        match current.kind() {
            AstKind::CallExpression(_) => current = ctx.nodes().parent_node(current.id()),
            AstKind::VariableDeclarator(declarator) => {
                return declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|identifier| {
                        render_in_render_is_uppercase_name(identifier.name.as_str())
                    });
            }
            AstKind::ExportDefaultDeclaration(_) => return true,
            _ => return false,
        }
    }
}

fn render_in_render_is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn render_in_render_declared_helper_function(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function)
            if function
                .id
                .as_ref()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id) =>
        {
            Some(declaration.id())
        }
        AstKind::VariableDeclarator(declarator)
            if declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id) =>
        {
            match declarator.init.as_ref()? {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn render_in_render_function_reaches_hook(
    function_id: NodeId,
    root_span: oxc_span::Span,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut rustc_hash::FxHashSet<NodeId>,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if !visited_function_ids.insert(function_id) {
        return false;
    }
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
            continue;
        }
        match candidate.kind() {
            AstKind::CallExpression(call_expression) => {
                if render_in_render_is_hook_callee(&call_expression.callee) {
                    return true;
                }
                if render_in_render_called_local_reaches_hook(
                    &call_expression.callee,
                    root_span,
                    ctx,
                    visited_function_ids,
                    function_resolution_cache,
                ) {
                    return true;
                }
                if render_in_render_synchronous_argument_reaches_hook(
                    &call_expression.arguments,
                    root_span,
                    ctx,
                    visited_function_ids,
                    function_resolution_cache,
                ) {
                    return true;
                }
            }
            AstKind::NewExpression(new_expression) => {
                if render_in_render_synchronous_argument_reaches_hook(
                    &new_expression.arguments,
                    root_span,
                    ctx,
                    visited_function_ids,
                    function_resolution_cache,
                ) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn render_in_render_is_hook_callee(callee: &Expression<'_>) -> bool {
    match callee {
        Expression::Identifier(identifier) => {
            crate::utils::is_react_hook_name(identifier.name.as_str())
        }
        Expression::StaticMemberExpression(member) => {
            matches!(
                &member.object,
                Expression::Identifier(identifier)
                    if render_in_render_is_uppercase_name(identifier.name.as_str())
            ) && crate::utils::is_react_hook_name(member.property.name.as_str())
        }
        _ => false,
    }
}

fn render_in_render_called_local_reaches_hook<'a>(
    callee: &Expression<'a>,
    root_span: oxc_span::Span,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut rustc_hash::FxHashSet<NodeId>,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Some(function_id) = exact_local_function_id_including_generators(
        callee,
        ctx,
        &mut Vec::new(),
        function_resolution_cache,
    ) else {
        return false;
    };
    render_in_render_descendant_function_reaches_hook(
        function_id,
        root_span,
        ctx,
        visited_function_ids,
        function_resolution_cache,
    )
}

fn render_in_render_synchronous_argument_reaches_hook<'a>(
    arguments: &[Argument<'a>],
    root_span: oxc_span::Span,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut rustc_hash::FxHashSet<NodeId>,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    arguments
        .iter()
        .filter_map(Argument::as_expression)
        .any(|argument| {
            let argument_node = ctx.nodes().get_node(argument.node_id());
            if !render_in_render_function_executes_during_render(argument_node, ctx) {
                return false;
            }
            let Some(function_id) = exact_local_function_id_including_generators(
                argument,
                ctx,
                &mut Vec::new(),
                function_resolution_cache,
            ) else {
                return false;
            };
            render_in_render_descendant_function_reaches_hook(
                function_id,
                root_span,
                ctx,
                visited_function_ids,
                function_resolution_cache,
            )
        })
}

fn render_in_render_function_executes_during_render<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !function_executes_during_render(function_node, ctx) {
        return false;
    }
    let expression_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return true;
    };
    if !expression_is_argument_at(&call_expression.arguments, 0, expression_root.span()) {
        return true;
    }
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
        return true;
    };
    if !["useMemo", "useState", "startTransition"]
        .iter()
        .any(|api_name| is_react_api_call(call_expression, api_name, ctx))
    {
        return true;
    }
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| {
            matches!(
                ctx.symbol_declaration(symbol_id).kind(),
                AstKind::ImportSpecifier(_)
            )
        })
}

fn render_in_render_descendant_function_reaches_hook(
    function_id: NodeId,
    root_span: oxc_span::Span,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut rustc_hash::FxHashSet<NodeId>,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let function_span = ctx.nodes().get_node(function_id).span();
    function_span != root_span
        && root_span.contains_inclusive(function_span)
        && render_in_render_function_reaches_hook(
            function_id,
            root_span,
            ctx,
            visited_function_ids,
            function_resolution_cache,
        )
}
