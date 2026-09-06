use std::collections::HashSet;

use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct DesignNoRedundantPaddingAxes;

declare_oxc_lint!(
    /// Disallow matching horizontal and vertical padding utilities.
    DesignNoRedundantPaddingAxes,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow matching horizontal and vertical padding utilities.",
);

impl Rule for DesignNoRedundantPaddingAxes {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            return;
        };
        if attribute_name.name != "className" {
            return;
        }
        let Some(class_name_value) = get_string_literal_attribute_value(attribute) else {
            return;
        };
        if !class_name_value.contains("px-") || !class_name_value.contains("py-") {
            return;
        }
        if has_responsive_axis_prefix(class_name_value, "px")
            || has_responsive_axis_prefix(class_name_value, "py")
        {
            return;
        }
        let horizontal_values: HashSet<String> =
            collect_axis_shorthand_values(class_name_value, "px")
                .into_iter()
                .collect();
        for vertical_value in collect_axis_shorthand_values(class_name_value, "py") {
            if !horizontal_values.contains(&vertical_value) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "px-{vertical_value} and py-{vertical_value} duplicate p-{vertical_value}, so the class list is noisier without changing spacing."
                ))
                .with_label(attribute.span),
            );
        }
    }
}
