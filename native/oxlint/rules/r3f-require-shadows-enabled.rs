use oxc_ast::{AstKind, ast::JSXAttributeItem};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::NodeId;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This object enables castShadow or receiveShadow, but its Canvas leaves shadow maps disabled. Add the Canvas shadows prop";
const UNSUPPORTED_SHADOW_LIGHT_NAMES: [&str; 3] =
    ["ambientLight", "hemisphereLight", "rectAreaLight"];

#[derive(Debug, Default, Clone)]
pub struct R3FRequireShadowsEnabled;

impl RuleMeta for R3FRequireShadowsEnabled {
    const NAME: &'static str = "r3f-require-shadows-enabled";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require Canvas shadow maps for React Three Fiber shadow users.",
    };
}

impl Rule for R3FRequireShadowsEnabled {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        let mut shadow_users_by_canvas = Vec::<(NodeId, oxc_span::Span)>::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !is_r3f_host_intrinsic(opening_element, ctx)
                || matches!(
                    &opening_element.name,
                    oxc_ast::ast::JSXElementName::Identifier(identifier)
                        if UNSUPPORTED_SHADOW_LIGHT_NAMES.contains(&identifier.name.as_str())
                )
                || opening_element
                    .attributes
                    .iter()
                    .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
                || !["castShadow", "receiveShadow"]
                    .iter()
                    .any(|attribute_name| {
                        get_authoritative_jsx_attribute(opening_element, attribute_name, true)
                            .is_some_and(|attribute| {
                                read_static_jsx_boolean_attribute(attribute) == Some(true)
                            })
                    })
            {
                continue;
            }
            let Some(canvas_node_id) = ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
                let AstKind::JSXElement(element) = ancestor.kind() else {
                    return None;
                };
                r3f_canvas_has_public_provenance(&element.opening_element, ctx)
                    .then_some(ancestor.id())
            }) else {
                continue;
            };
            if let Some((_, shadow_user_span)) = shadow_users_by_canvas
                .iter_mut()
                .find(|(candidate_canvas_id, _)| *candidate_canvas_id == canvas_node_id)
            {
                *shadow_user_span = opening_element.span;
            } else {
                shadow_users_by_canvas.push((canvas_node_id, opening_element.span));
            }
        }
        for (canvas_node_id, shadow_user_span) in shadow_users_by_canvas {
            let AstKind::JSXElement(canvas) = ctx.nodes().get_node(canvas_node_id).kind() else {
                continue;
            };
            let opening_element = &canvas.opening_element;
            if opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
                || get_authoritative_jsx_attribute(opening_element, "gl", true).is_some()
                || get_authoritative_jsx_attribute(opening_element, "onCreated", true).is_some()
                || get_authoritative_jsx_attribute(opening_element, "shadows", true).is_some_and(
                    |attribute| read_static_jsx_boolean_attribute(attribute) != Some(false),
                )
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(shadow_user_span));
        }
    }
}
