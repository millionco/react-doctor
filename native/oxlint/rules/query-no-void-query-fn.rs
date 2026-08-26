use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

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
const MESSAGE: &str = "This empty queryFn caches undefined, so the component never gets data.";

#[derive(Debug, Default, Clone)]
pub struct QueryNoVoidQueryFn;

declare_oxc_lint!(
    /// Disallow empty TanStack Query functions that cache undefined.
    QueryNoVoidQueryFn,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow empty TanStack Query functions that cache undefined.",
);

impl Rule for QueryNoVoidQueryFn {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = &call_expression.callee else {
            return;
        };
        if !TANSTACK_QUERY_HOOK_NAMES.contains(&callee.name.as_str()) {
            return;
        }
        let Some(Expression::ObjectExpression(options)) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some(query_function_property) = options.properties.iter().find_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            (property_key_identifier_name(&property.key) == Some("queryFn")).then_some(property)
        }) else {
            return;
        };
        let function_body = match &query_function_property.value {
            Expression::ArrowFunctionExpression(function) => {
                if function.get_expression().is_some() {
                    None
                } else {
                    function.body.as_function_body()
                }
            }
            Expression::FunctionExpression(function) => function.body.as_deref(),
            _ => None,
        };
        if function_body.is_none_or(|body| {
            !body
                .statements
                .iter()
                .all(|statement| is_no_op_statement(statement))
        }) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(query_function_property.span));
    }
}
