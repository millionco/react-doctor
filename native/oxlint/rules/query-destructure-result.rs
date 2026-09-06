use oxc_ast::{AstKind, ast::BindingPattern};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TANSTACK_QUERY_HOOK_NAMES: [&str; 4] = [
    "useQuery",
    "useInfiniteQuery",
    "useSuspenseQuery",
    "useSuspenseInfiniteQuery",
];
const TANSTACK_QUERY_MODULE_SOURCES: [&str; 2] = ["@tanstack/react-query", "react-query"];

#[derive(Debug, Default, Clone)]
pub struct QueryDestructureResult;

declare_oxc_lint!(
    /// Warns when a whole TanStack Query result is spread.
    QueryDestructureResult,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Spreading a whole query result subscribes to every field.",
);

impl Rule for QueryDestructureResult {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            return;
        };
        let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
            return;
        };
        let Some(oxc_ast::ast::Expression::CallExpression(call)) = &declarator.init else {
            return;
        };
        let oxc_ast::ast::Expression::Identifier(callee) = &call.callee else {
            return;
        };
        let Some(hook_name) = TANSTACK_QUERY_HOOK_NAMES
            .iter()
            .copied()
            .find(|hook_name| callee.name == *hook_name)
        else {
            return;
        };
        if resolve_identifier_import(callee, ctx).is_some_and(|entry| {
            !TANSTACK_QUERY_MODULE_SOURCES.contains(&entry.module_request.name())
        }) {
            return;
        }

        for reference in ctx.scoping().get_resolved_references(binding.symbol_id()) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if !query_result_reference_is_enumerating_spread(reference_node, ctx) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Spreading the whole {hook_name}() result reads every field, so TanStack Query subscribes to all of them and re-renders on each change. Spread only the fields you need."
                ))
                .with_label(reference_node.span()),
            );
        }
    }
}

fn query_result_reference_is_enumerating_spread<'a>(
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(reference_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::JSXSpreadAttribute(attribute) => {
            attribute.argument.span() == expression_root.span()
        }
        AstKind::SpreadElement(spread) if spread.argument.span() == expression_root.span() => {
            let object_node = ctx.nodes().parent_node(parent.id());
            matches!(object_node.kind(), AstKind::ObjectExpression(_))
                && !query_result_object_spread_is_hook_return_forwarding(object_node, ctx)
        }
        _ => false,
    }
}

fn query_result_object_spread_is_hook_return_forwarding<'a>(
    object_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(enclosing_function) = crate::ast_util::get_enclosing_function(object_node, ctx) else {
        return false;
    };
    let parent = ctx.nodes().parent_node(object_node.id());
    let is_returned = matches!(parent.kind(), AstKind::ReturnStatement(statement)
        if statement.argument.as_ref().is_some_and(|argument| argument.span() == object_node.span()))
        || matches!(parent.kind(), AstKind::ArrowFunctionExpression(function)
            if function.get_expression().is_some_and(|expression| expression.span() == object_node.span()));
    if !is_returned {
        return false;
    }
    component_or_hook_function_name(enclosing_function, ctx).is_some_and(|name| {
        name.starts_with("use")
            && name[3..].starts_with(|character: char| {
                character.is_ascii_uppercase() || character.is_ascii_digit()
            })
    })
}
