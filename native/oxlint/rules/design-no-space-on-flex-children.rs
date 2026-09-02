use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

static SPACE_AXIS_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?:^|\s)(?:-)?space-(x|y)-(\d+(?:\.\d+)?|\[[^\]]+\])(?:$|[\s:])"
);

#[derive(Debug, Default, Clone)]
pub struct DesignNoSpaceOnFlexChildren;

declare_oxc_lint!(
    /// Disallow space utilities on flex and grid parents.
    DesignNoSpaceOnFlexChildren,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow space utilities on flex and grid parents.",
);

impl Rule for DesignNoSpaceOnFlexChildren {
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
        if !class_name_value.contains("space-") || !has_flex_or_grid_class(class_name_value) {
            return;
        }
        let Some(space_match) = SPACE_AXIS_PATTERN.captures(class_name_value) else {
            return;
        };
        let (Some(space_axis), Some(space_value)) = (space_match.get(1), space_match.get(2)) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "space-{}-{} on a flex or grid parent can leave uneven gaps when children hide, wrap, or render in RTL layouts.",
                space_axis.as_str(),
                space_value.as_str()
            ))
            .with_label(attribute.span),
        );
    }
}

fn has_flex_or_grid_class(class_name_value: &str) -> bool {
    class_name_value.split_whitespace().any(|class_token| {
        matches!(
            class_token.rsplit(':').next(),
            Some("flex" | "inline-flex" | "grid" | "inline-grid")
        )
    })
}
