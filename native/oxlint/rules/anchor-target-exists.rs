use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::get_element_type,
};

#[derive(Debug, Default, Clone)]
pub struct AnchorTargetExists;

declare_oxc_lint!(
    /// Require static fragment links to reference a static project DOM id.
    AnchorTargetExists,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require fragment link targets to exist.",
);

impl Rule for AnchorTargetExists {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let href_attribute_names = ctx.settings().jsx_a11y.attributes.get("href").map_or_else(
            || vec!["href".to_string()],
            |names| names.iter().map(ToString::to_string).collect(),
        );
        let mut pending_fragment_links = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if get_element_type(ctx, opening_element) != "a" {
                continue;
            }
            let href_attribute = href_attribute_names.iter().find_map(|attribute_name| {
                get_authoritative_jsx_attribute(opening_element, attribute_name, false)
            });
            let Some(href_attribute) = href_attribute else {
                continue;
            };
            let Some(href) = get_string_literal_attribute_value(href_attribute) else {
                continue;
            };
            if !href.starts_with('#')
                || href.len() == 1
                || href.starts_with("#/")
                || href.starts_with("#!")
            {
                continue;
            }
            let directive_index = href.find(":~:").unwrap_or(href.len());
            let target_id = &href[1..directive_index];
            if target_id.is_empty() || target_id.eq_ignore_ascii_case("top") {
                continue;
            }
            pending_fragment_links.push((href_attribute, target_id.to_string()));
        }
        if pending_fragment_links.is_empty() {
            return;
        }
        let Some(static_project_dom_ids) = get_static_project_dom_ids(ctx) else {
            return;
        };
        for (href_attribute, target_id) in pending_fragment_links {
            if static_project_dom_ids.contains(&target_id) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This fragment link points to \"#{target_id}\", but no matching static id was found in the project."
                ))
                .with_label(href_attribute.span),
            );
        }
    }
}
