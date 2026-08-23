use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const HOOKS_WITH_DEPENDENCIES: [&str; 4] =
    ["useEffect", "useLayoutEffect", "useMemo", "useCallback"];

#[derive(Debug, Default, Clone)]
pub struct RerenderDependencies;

declare_oxc_lint!(
    /// Warns when a React dependency array contains a value recreated on every render.
    RerenderDependencies,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when a React dependency array contains a value recreated on every render.",
);

impl Rule for RerenderDependencies {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !is_react_hook_call(call_expression, &HOOKS_WITH_DEPENDENCIES, ctx) {
            return;
        }
        let Some(Expression::ArrayExpression(dependencies)) = call_expression
            .arguments
            .get(1)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        for dependency in dependencies
            .elements
            .iter()
            .filter_map(oxc_ast::ast::ArrayExpressionElement::as_expression)
        {
            let value_description = match dependency {
                Expression::ObjectExpression(_) => "a new object",
                Expression::ArrayExpression(_) => "a new array",
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                    "the Inline function"
                }
                _ => continue,
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your effect re-runs every render because {value_description} in its useEffect deps is rebuilt each time."
                ))
                .with_label(dependency.span()),
            );
        }
    }
}
