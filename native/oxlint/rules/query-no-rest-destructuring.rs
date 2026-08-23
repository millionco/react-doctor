use oxc_ast::{AstKind, ast::BindingPattern};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TANSTACK_QUERY_MODULE_SOURCES: [&str; 2] = ["@tanstack/react-query", "react-query"];
const TANSTACK_QUERY_HOOK_NAMES: [&str; 4] = [
    "useQuery",
    "useInfiniteQuery",
    "useSuspenseQuery",
    "useSuspenseInfiniteQuery",
];

#[derive(Debug, Default, Clone)]
pub struct QueryNoRestDestructuring;

declare_oxc_lint!(
    /// Disallow rest destructuring TanStack Query results.
    QueryNoRestDestructuring,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow rest destructuring TanStack Query results.",
);

impl Rule for QueryNoRestDestructuring {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            return;
        };
        let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
            return;
        };
        if pattern.rest.is_none() {
            return;
        }
        let Some(initializer) = &declarator.init else {
            return;
        };
        let Some(hook_name) = query_hook_name_from_initializer(initializer, ctx, &mut Vec::new())
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Rest-destructuring {hook_name}() subscribes to every field, so it re-renders on each change."
            ))
            .with_label(pattern.span),
        );
    }
}

fn query_hook_name_from_initializer<'a>(
    initializer: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'static str> {
    let initializer = initializer.get_inner_expression();
    if let oxc_ast::ast::Expression::CallExpression(call_expression) = initializer {
        return TANSTACK_QUERY_HOOK_NAMES.iter().copied().find(|hook_name| {
            module_api_path_matches(
                &call_expression.callee,
                &[*hook_name],
                &TANSTACK_QUERY_MODULE_SOURCES,
                false,
                ctx,
            )
        });
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = initializer else {
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
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return None;
    };
    if !variable_declaration.kind.is_const()
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return None;
    }
    query_hook_name_from_initializer(declarator.init.as_ref()?, ctx, visited_symbol_ids)
}
