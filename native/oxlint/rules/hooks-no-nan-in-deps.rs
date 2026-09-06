use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const HOOKS_WITH_DEPENDENCY_ARRAYS: [&str; 6] = [
    "useEffect",
    "useLayoutEffect",
    "useInsertionEffect",
    "useCallback",
    "useMemo",
    "useImperativeHandle",
];
const MESSAGE: &str = "`NaN` in a dependency array never compares as changed with `Object.is`, so normalize the value before passing it as a dependency.";

#[derive(Debug, Default, Clone)]
pub struct HooksNoNanInDeps;

declare_oxc_lint!(
    /// Disallow global NaN values in React hook dependency arrays.
    HooksNoNanInDeps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow global NaN values in React hook dependency arrays.",
);

impl Rule for HooksNoNanInDeps {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !is_react_hook_call(call_expression, &HOOKS_WITH_DEPENDENCY_ARRAYS, ctx) {
            return;
        }
        let dependency_index = usize::from(is_react_hook_call(
            call_expression,
            &["useImperativeHandle"],
            ctx,
        )) + 1;
        let Some(Expression::ArrayExpression(dependency_array)) = call_expression
            .arguments
            .get(dependency_index)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        for dependency in dependency_array
            .elements
            .iter()
            .filter_map(oxc_ast::ast::ArrayExpressionElement::as_expression)
        {
            if is_global_nan_value(dependency, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(dependency.span()));
            }
        }
    }
}
