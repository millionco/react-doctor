use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const METHOD_ORDER: [&str; 5] = ["middleware", "validator", "client", "server", "handler"];

#[derive(Debug, Default, Clone)]
pub struct TanstackStartServerFnMethodOrder;

declare_oxc_lint!(
    /// Enforce the TanStack Start server-function chain order required for type inference.
    TanstackStartServerFnMethodOrder,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Enforce TanStack Start server-function method order.",
);

impl Rule for TanstackStartServerFnMethodOrder {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let chain_info = walk_tanstack_server_fn_chain(call_expression);
        if !chain_info.is_server_fn_chain {
            return;
        }

        let mut last_method_index = None;
        for method_name in chain_info.method_names {
            let order_token = if method_name == "inputValidator" {
                "validator"
            } else {
                method_name
            };
            let Some(current_method_index) = METHOD_ORDER
                .iter()
                .position(|candidate| *candidate == order_token)
            else {
                continue;
            };
            if let Some(last_method_index) = last_method_index
                && current_method_index < last_method_index
            {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Chaining .{method_name}() after .{}() breaks type inference.",
                        METHOD_ORDER[last_method_index],
                    ))
                    .with_label(call_expression.span),
                );
                return;
            }
            last_method_index = Some(current_method_index);
        }
    }
}
