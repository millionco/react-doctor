use oxc_ast::{ast::JSXElementName, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const LAYOUT_TRANSITION_PROPERTIES: [&str; 27] = [
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "top",
    "right",
    "bottom",
    "left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "border-width",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "line-height",
    "column-width",
];
const SVG_LAYOUT_TRANSITION_EXEMPT_ELEMENT_NAMES: [&str; 24] = [
    "svg",
    "g",
    "rect",
    "circle",
    "ellipse",
    "image",
    "line",
    "path",
    "polygon",
    "polyline",
    "text",
    "tspan",
    "textPath",
    "use",
    "marker",
    "mask",
    "pattern",
    "symbol",
    "defs",
    "clipPath",
    "linearGradient",
    "radialGradient",
    "stop",
    "filter",
];

#[derive(Debug, Default, Clone)]
pub struct NoTailwindLayoutTransition;

declare_oxc_lint!(
    /// Disallow Tailwind transitions of layout properties.
    NoTailwindLayoutTransition,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow Tailwind transitions of layout properties.",
);

impl Rule for NoTailwindLayoutTransition {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier)
                if SVG_LAYOUT_TRANSITION_EXEMPT_ELEMENT_NAMES.contains(&identifier.name.as_str())
        ) {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        for token in tailwind_class_name_tokens(class_name) {
            let Some(animated_properties) = token
                .utility
                .strip_prefix("transition-[")
                .and_then(|value| value.strip_suffix(']'))
                .filter(|value| !value.contains(']'))
            else {
                continue;
            };
            let Some(layout_property) = animated_properties
                .split(',')
                .map(|property| property.trim_matches(is_js_whitespace))
                .find(|property| LAYOUT_TRANSITION_PROPERTIES.contains(property))
            else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users see janky animation because `transition-[{animated_properties}]` animates \"{layout_property}\", a layout property the browser recomputes every frame, so animate transform & opacity instead."
                ))
                .with_label(opening_element.span),
            );
        }
    }
}
