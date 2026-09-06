use oxc_ast::{AstKind, ast::FunctionType};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "new QueryClient() inside a component wipes your cache on every render.";

#[derive(Debug, Default, Clone)]
pub struct QueryStableQueryClient;

declare_oxc_lint!(
    /// Disallow unstable QueryClient construction in component render bodies.
    QueryStableQueryClient,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unstable QueryClient construction in components.",
);

impl Rule for QueryStableQueryClient {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(allocation) = node.kind() else {
            return;
        };
        if !matches!(&allocation.callee, oxc_ast::ast::Expression::Identifier(identifier) if identifier.name == "QueryClient")
            || query_client_is_stable_hook_argument(node, ctx)
        {
            return;
        }
        let mut enclosing_function = crate::ast_util::get_enclosing_function(node, ctx);
        while enclosing_function
            .is_some_and(|function| query_client_function_is_immediately_invoked(function, ctx))
        {
            enclosing_function = enclosing_function
                .and_then(|function| crate::ast_util::get_enclosing_function(function, ctx));
        }
        let Some(function) = enclosing_function else {
            return;
        };
        if query_client_function_binding_name(function, ctx)
            .is_none_or(|name| !name.as_bytes().first().is_some_and(u8::is_ascii_uppercase))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(allocation.span));
    }
}

fn query_client_is_stable_hook_argument(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    matches!(&call.callee, oxc_ast::ast::Expression::Identifier(identifier)
        if matches!(identifier.name.as_str(), "useMemo" | "useRef" | "useState"))
        && call
            .arguments
            .iter()
            .any(|argument| argument.span() == node.span())
}

fn query_client_function_is_immediately_invoked<'a>(
    function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(function, ctx);
    matches!(ctx.nodes().parent_node(root.id()).kind(), AstKind::CallExpression(call)
        if call.callee.span() == root.span())
}

fn query_client_function_binding_name<'a, 'b>(
    function: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b str> {
    if let AstKind::Function(function) = function.kind()
        && function.r#type == FunctionType::FunctionDeclaration
        && let Some(identifier) = &function.id
    {
        return Some(identifier.name.as_str());
    }
    let root = transparent_expression_root(function, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .map(|identifier| identifier.name.as_str()),
        AstKind::AssignmentExpression(assignment) => assignment
            .left
            .get_expression()
            .and_then(oxc_ast::ast::Expression::get_identifier_reference)
            .map(|identifier| identifier.name.as_str()),
        AstKind::CallExpression(_) => {
            let call_parent = ctx.nodes().parent_node(parent.id());
            let AstKind::VariableDeclarator(declarator) = call_parent.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.name.as_str())
        }
        _ => None,
    }
}
