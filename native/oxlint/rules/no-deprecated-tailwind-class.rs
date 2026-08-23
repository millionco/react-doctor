use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const GRADIENT_DIRECTIONS: [&str; 8] = ["t", "tr", "r", "br", "b", "bl", "l", "tl"];

#[derive(Debug, Default, Clone)]
pub struct NoDeprecatedTailwindClass;

declare_oxc_lint!(
    /// Disallow deprecated Tailwind v4 utility names.
    NoDeprecatedTailwindClass,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow deprecated Tailwind v4 utility names.",
);

impl Rule for NoDeprecatedTailwindClass {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        for token in tailwind_class_name_tokens(class_name) {
            let Some(replacement) = deprecated_tailwind_replacement(token.utility) else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "`{}` is a legacy Tailwind name — use the canonical v4 utility `{replacement}`.",
                    token.utility
                ))
                .with_label(opening_element.span),
            );
        }
    }
}

fn deprecated_tailwind_replacement(token: &str) -> Option<String> {
    if token == "overflow-ellipsis" {
        return Some("text-ellipsis".to_string());
    }
    if token == "flex-shrink" || token.starts_with("flex-shrink-") {
        return Some(token.replacen("flex-shrink", "shrink", 1));
    }
    if token == "flex-grow" || token.starts_with("flex-grow-") {
        return Some(token.replacen("flex-grow", "grow", 1));
    }
    let direction = token.strip_prefix("bg-gradient-to-")?;
    GRADIENT_DIRECTIONS
        .contains(&direction)
        .then(|| format!("bg-linear-to-{direction}"))
}
