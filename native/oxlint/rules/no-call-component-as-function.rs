use oxc_ast::ast::{Expression, JSXElementName, MemberExpression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NoCallComponentAsFunction;

declare_oxc_lint!(
    /// Disallow calling React components as plain functions.
    NoCallComponentAsFunction,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow calling React components as plain functions.",
);

impl Rule for NoCallComponentAsFunction {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let rendered_component_symbols = collect_rendered_component_symbols(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Expression::Identifier(callee) = call_expression.callee.get_inner_expression()
            else {
                continue;
            };
            if !callee
                .name
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_uppercase)
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
            let is_rendered = rendered_component_symbols.contains(&symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let local_component =
                local_component_function(symbol_id, ctx).is_some_and(|component_function| {
                    function_contains_react_render_output(component_function, ctx)
                        && (declaration_is_module_scoped(declaration, ctx)
                            || is_rendered
                            || function_contains_hook_call(component_function, ctx))
                });
            if !local_component && !(symbol_is_import(symbol_id, ctx) && is_rendered) {
                continue;
            }
            if local_component_function(symbol_id, ctx).is_none()
                && call_is_returned_from_use_callback_adapter(node, ctx)
            {
                continue;
            }
            let Some(component_function) = local_component_function(symbol_id, ctx) else {
                if symbol_is_import(symbol_id, ctx) {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(component_called_as_function_message(
                            callee.name.as_str(),
                        ))
                        .with_label(call_expression.span),
                    );
                }
                continue;
            };
            if function_parameter_count(component_function) >= 2
                || function_is_async(component_function)
                || (!function_contains_hook_call(component_function, ctx)
                    && call_is_returned_from_use_callback_adapter(node, ctx))
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(component_called_as_function_message(callee.name.as_str()))
                    .with_label(call_expression.span),
            );
        }
    }
}

fn component_called_as_function_message(name: &str) -> String {
    format!(
        "`{name}` is a component, so calling it as a plain function (`{name}(...)`) runs it outside React: its hooks break, it gets no fiber/state, and memoization is lost. Render it as `<{name} />` instead."
    )
}

fn collect_rendered_component_symbols(ctx: &LintContext<'_>) -> FxHashSet<SymbolId> {
    let mut symbols = FxHashSet::default();
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::JSXOpeningElement(opening_element) => {
                let JSXElementName::IdentifierReference(identifier) = &opening_element.name else {
                    continue;
                };
                if !identifier
                    .name
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_uppercase)
                {
                    continue;
                }
                if let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                {
                    symbols.insert(symbol_id);
                }
            }
            AstKind::CallExpression(call_expression)
                if is_create_element_like_call(call_expression) =>
            {
                let Some(Expression::Identifier(identifier)) = call_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .map(Expression::get_inner_expression)
                else {
                    continue;
                };
                if let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                {
                    symbols.insert(symbol_id);
                }
            }
            _ => {}
        }
    }
    symbols
}

fn is_create_element_like_call(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == "createElement",
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression.static_property_name() == Some("createElement")
                    && !member_chain_contains_document(member_expression)
            }),
    }
}

fn member_chain_contains_document(member_expression: &MemberExpression<'_>) -> bool {
    let mut current = member_expression.object().get_inner_expression();
    loop {
        match current {
            Expression::Identifier(identifier) => return identifier.name == "document",
            expression => {
                let Some(member) = expression.as_member_expression() else {
                    return false;
                };
                if member.static_property_name() == Some("document") {
                    return true;
                }
                current = member.object().get_inner_expression();
            }
        }
    }
}

fn symbol_is_import(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    matches!(
        ctx.symbol_declaration(symbol_id).kind(),
        AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
    )
}

fn local_component_function<'a, 'b>(
    symbol_id: SymbolId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function)
            if function
                .id
                .as_ref()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id) =>
        {
            Some(declaration)
        }
        AstKind::VariableDeclarator(declarator)
            if declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id) =>
        {
            match declarator.init.as_ref()? {
                Expression::ArrowFunctionExpression(function) => {
                    Some(ctx.nodes().get_node(function.node_id.get()))
                }
                Expression::FunctionExpression(function) => {
                    Some(ctx.nodes().get_node(function.node_id.get()))
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn declaration_is_module_scoped(declaration: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    !ctx.nodes().ancestors(declaration.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    })
}

fn function_contains_hook_call(function_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let function_span = function_node.span();
    ctx.nodes().iter().any(|candidate| {
        function_span.contains_inclusive(candidate.span())
            && matches!(
                candidate.kind(),
                AstKind::CallExpression(call_expression)
                    if call_expression
                        .callee_name()
                        .is_some_and(crate::utils::is_react_hook_name)
            )
    })
}

fn function_parameter_count(function_node: &AstNode<'_>) -> usize {
    match function_node.kind() {
        AstKind::Function(function) => function.params.items.len(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.len(),
        _ => 0,
    }
}

fn function_is_async(function_node: &AstNode<'_>) -> bool {
    match function_node.kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn call_is_returned_from_use_callback_adapter<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = call_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ArrowFunctionExpression(function) => {
                if function
                    .get_expression()
                    .is_none_or(|body| body.span() != current.span())
                {
                    return false;
                }
                let grandparent = ctx.nodes().parent_node(parent.id());
                let AstKind::CallExpression(use_callback_call) = grandparent.kind() else {
                    return false;
                };
                return use_callback_call.callee_name() == Some("useCallback")
                    && use_callback_call.arguments.iter().any(|argument| {
                        argument
                            .as_expression()
                            .is_some_and(|expression| expression.span() == parent.span())
                    });
            }
            AstKind::ConditionalExpression(_) | AstKind::LogicalExpression(_) => {
                current = parent;
            }
            _ => return false,
        }
    }
}
