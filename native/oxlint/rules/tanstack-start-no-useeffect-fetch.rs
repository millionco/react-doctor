use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];

#[derive(Debug, Default, Clone)]
pub struct TanstackStartNoUseeffectFetch;

declare_oxc_lint!(
    /// Detect route fetch calls that run from effects.
    TanstackStartNoUseeffectFetch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Detect route fetch calls that run from effects.",
);

impl Rule for TanstackStartNoUseeffectFetch {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !is_in_project_directory(ctx, "routes") {
            return;
        }
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let callee_name = match &call_expression.callee {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            expression => expression
                .as_member_expression()
                .and_then(member_expression_identifier_property_name),
        };
        if !callee_name.is_some_and(|callee_name| EFFECT_HOOK_NAMES.contains(&callee_name)) {
            return;
        }
        let Some(callback) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        if !effect_execution_contains_fetch_call(callback, ctx, &["fetch"], &[]) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(
                "fetch() inside useEffect makes your users wait through a loading spinner after render.",
            )
            .with_label(call_expression.span),
        );
    }
}
