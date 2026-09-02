use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashSet;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_ROUTER_RUNTIME_MODULE_SOURCES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];
const MESSAGE: &str = "This component registers more than one unconditional navigation blocker.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoMultipleBlockers;

declare_oxc_lint!(
    /// Disallow multiple unconditional React Router blockers in one component.
    ReactRouterNoMultipleBlockers,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow multiple unconditional navigation blockers.",
);

impl Rule for ReactRouterNoMultipleBlockers {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let has_stable_blocker = has_capability(ctx, "react-router:6.19");
        let mut blocker_owner_function_ids = FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Expression::Identifier(callee) = &call_expression.callee else {
                continue;
            };
            let is_blocker = direct_named_import_matches(
                callee,
                &["unstable_useBlocker"],
                &REACT_ROUTER_RUNTIME_MODULE_SOURCES,
                ctx,
            ) || (has_stable_blocker
                && direct_named_import_matches(
                    callee,
                    &["useBlocker"],
                    &REACT_ROUTER_RUNTIME_MODULE_SOURCES,
                    ctx,
                ));
            if !is_blocker {
                continue;
            }
            let Some(owner_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
                continue;
            };
            if is_node_conditionally_executed(node, owner_function.id(), ctx) {
                continue;
            }
            if blocker_owner_function_ids.insert(owner_function.id()) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call_expression.span));
        }
    }
}
