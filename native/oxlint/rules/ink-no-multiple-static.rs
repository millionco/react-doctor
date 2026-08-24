use std::collections::HashMap;

use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str =
    "Ink tracks one `<Static>` node per root; combine these unconditional regions.";

#[derive(Debug, Default, Clone)]
pub struct InkNoMultipleStatic;

declare_oxc_lint!(
    /// Disallow multiple unconditional Ink Static regions in one render root.
    InkNoMultipleStatic,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow multiple unconditional Ink Static regions.",
);

impl Rule for InkNoMultipleStatic {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut unconditional_static_counts = HashMap::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if resolve_imported_jsx_component_name(opening_element, "ink", ctx) != Some("Static") {
                continue;
            }
            let Some((owner_node_id, render_root_node_id)) = static_render_root(node, ctx) else {
                continue;
            };
            if is_node_conditionally_executed(node, render_root_node_id, ctx) {
                continue;
            }
            let static_count = unconditional_static_counts
                .entry((owner_node_id, render_root_node_id))
                .or_insert(0_u32);
            *static_count += 1;
            if *static_count > 1 {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
            }
        }
    }
}

fn static_render_root(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<(oxc_semantic::NodeId, oxc_semantic::NodeId)> {
    let mut render_root_node_id = None;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXAttribute(_) => return None,
            AstKind::JSXElement(_) | AstKind::JSXFragment(_) => {
                render_root_node_id = Some(ancestor.id());
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                return render_root_node_id.map(|root_node_id| (ancestor.id(), root_node_id));
            }
            _ => {}
        }
    }
    None
}
