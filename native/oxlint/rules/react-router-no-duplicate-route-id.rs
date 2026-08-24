use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::node::NodeId;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoDuplicateRouteId;

declare_oxc_lint!(
    /// Disallow duplicate explicit route IDs within one router.
    ReactRouterNoDuplicateRouteId,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow duplicate React Router route IDs.",
);

impl Rule for ReactRouterNoDuplicateRouteId {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut route_ids_by_config = FxHashMap::<NodeId, FxHashSet<String>>::default();
        for node in ctx.nodes().iter() {
            let AstKind::ObjectExpression(route_object) = node.kind() else {
                continue;
            };
            if !is_static_react_router_route_object(route_object, ctx) {
                continue;
            }
            let Some(id_property) = get_static_route_property(route_object, "id") else {
                continue;
            };
            let Some(route_id) = get_static_string_expression(&id_property.value) else {
                continue;
            };
            let Some(route_config_id) = find_route_config_call_id(node, ctx) else {
                continue;
            };
            let seen_route_ids = route_ids_by_config.entry(route_config_id).or_default();
            if !seen_route_ids.insert(route_id.to_string()) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Route ID '{route_id}' is already used by another route in this router."
                    ))
                    .with_label(id_property.span),
                );
            }
        }
    }
}

fn find_route_config_call_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(ancestor.kind(), AstKind::CallExpression(_)).then_some(ancestor.id())
    })
}
