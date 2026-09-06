use std::collections::HashSet;

use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct DesignNoRedundantSizeAxes;

declare_oxc_lint!(
    /// Disallow matching width and height utilities.
    DesignNoRedundantSizeAxes,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow matching width and height utilities.",
);

impl Rule for DesignNoRedundantSizeAxes {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        for node in ctx.nodes().iter() {
            let AstKind::JSXAttribute(attribute) = node.kind() else {
                continue;
            };
            let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if attribute_name.name != "className" {
                continue;
            }
            let Some(class_name_value) = get_string_literal_attribute_value(attribute) else {
                continue;
            };
            if !class_name_value.contains("w-") || !class_name_value.contains("h-") {
                continue;
            }
            if has_responsive_axis_prefix(class_name_value, "w")
                || has_responsive_axis_prefix(class_name_value, "h")
            {
                continue;
            }
            let width_values: HashSet<String> =
                collect_axis_shorthand_values(class_name_value, "w")
                    .into_iter()
                    .collect();
            let Some(matched_value) = collect_axis_shorthand_values(class_name_value, "h")
                .into_iter()
                .find(|height_value| width_values.contains(height_value))
            else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "w-{matched_value} and h-{matched_value} duplicate size-{matched_value}, so the class list is noisier without changing layout."
                ))
                .with_label(attribute.span),
            );
            return;
        }
    }
}
