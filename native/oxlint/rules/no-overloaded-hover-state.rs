use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const OVERLOADED_HOVER_PROPERTY_MIN_COUNT: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct NoOverloadedHoverState;

declare_oxc_lint!(
    /// Disallow hover states that combine too many effects.
    NoOverloadedHoverState,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow hover states that combine too many effects.",
);

impl Rule for NoOverloadedHoverState {
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
        let mut property_groups = Vec::new();
        for token in tailwind_class_name_tokens(class_name) {
            if !token.variants.contains(&"hover") {
                continue;
            }
            let Some(property_group) = hover_property_group(token.utility) else {
                continue;
            };
            if !property_groups.contains(&property_group) {
                property_groups.push(property_group);
            }
        }
        if property_groups.len() < OVERLOADED_HOVER_PROPERTY_MIN_COUNT {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This hover state combines {}. Keep one clear feedback mechanism so the component feels stable.",
                property_groups.join(", ")
            ))
            .with_label(opening_element.span),
        );
    }
}

fn hover_property_group(utility: &str) -> Option<&'static str> {
    let unsigned_utility = utility.strip_prefix('-').unwrap_or(utility);
    if ["translate-", "scale-", "rotate-", "skew-"]
        .iter()
        .any(|prefix| unsigned_utility.starts_with(prefix))
    {
        return Some("transform");
    }
    if ["bg-", "text-", "border-", "fill-", "stroke-"]
        .iter()
        .any(|prefix| utility.starts_with(prefix))
    {
        return Some("color");
    }
    if utility == "shadow" || utility.starts_with("shadow-") {
        return Some("shadow");
    }
    if utility.starts_with("opacity-") {
        return Some("opacity");
    }
    if [
        "blur-",
        "brightness-",
        "contrast-",
        "grayscale-",
        "hue-rotate-",
        "invert-",
        "saturate-",
        "sepia-",
    ]
    .iter()
    .any(|prefix| utility.starts_with(prefix))
    {
        return Some("filter");
    }
    None
}
