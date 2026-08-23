use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::node::NodeId;
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DUPLICATE_STORAGE_READ_THRESHOLD: usize = 2;
const STORAGE_OBJECT_NAMES: [&str; 2] = ["localStorage", "sessionStorage"];
const ARRAY_ITERATION_CALLBACK_METHOD_NAMES: [&str; 6] =
    ["forEach", "map", "filter", "reduce", "some", "every"];

#[derive(Debug, Default, Clone)]
pub struct JsCacheStorage;

declare_oxc_lint!(
    /// Disallow repeated reads from web storage within one function.
    JsCacheStorage,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow repeated reads from web storage within one function.",
);

impl Rule for JsCacheStorage {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut storage_read_counts = FxHashMap::<(Option<NodeId>, String), usize>::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                continue;
            };
            if member_expression_identifier_property_name(member_expression) != Some("getItem") {
                continue;
            }
            let Expression::Identifier(receiver) =
                member_expression.object().get_inner_expression()
            else {
                continue;
            };
            if !STORAGE_OBJECT_NAMES.contains(&receiver.name.as_str()) {
                continue;
            }
            let Some(storage_key) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .and_then(static_storage_key)
            else {
                continue;
            };
            let function_owner_id = effective_function_owner_id(node, ctx);
            let read_count = storage_read_counts
                .entry((function_owner_id, storage_key.clone()))
                .or_default();
            *read_count += 1;
            if *read_count != DUPLICATE_STORAGE_READ_THRESHOLD {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This is slow because {}.getItem(\"{storage_key}\") runs several times & re-parses the data each call, so read it once & reuse the value",
                    receiver.name
                ))
                .with_label(call_expression.span),
            );
        }
    }
}

fn static_storage_key(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(string_literal) => Some(string_literal.value.to_string()),
        Expression::NumericLiteral(number_literal) => Some(number_literal.value.to_string()),
        Expression::BooleanLiteral(boolean_literal) => Some(boolean_literal.value.to_string()),
        Expression::NullLiteral(_) => Some("null".to_string()),
        _ => None,
    }
}

fn effective_function_owner_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node.id())
        .filter(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find(|function_node| !is_inline_iteration_callback(function_node, ctx))
        .map(AstNode::id)
}

fn is_inline_iteration_callback<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let callback_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(callback_root.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    if !call_expression.arguments.first().is_some_and(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == callback_root.span())
    }) {
        return false;
    }
    call_expression
        .callee
        .as_member_expression()
        .and_then(member_expression_identifier_property_name)
        .is_some_and(|method_name| ARRAY_ITERATION_CALLBACK_METHOD_NAMES.contains(&method_name))
}
