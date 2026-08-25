use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const INLINE_STYLE_MESSAGE: &str = "Ease-in delays the visible response and makes this interaction feel sluggish. Use ease-out or a responsive custom curve.";
const MOTION_MESSAGE: &str = "Ease-in makes the first part of this UI motion feel unresponsive. Prefer ease-out for state changes users trigger.";
const TAILWIND_MESSAGE: &str = "This ease-in utility back-loads the visible response. Use ease-out or a purpose-built timing curve for UI motion.";
const TIMING_PROPERTY_NAMES: [&str; 4] = [
    "transition",
    "transitionTimingFunction",
    "animation",
    "animationTimingFunction",
];
static EASE_IN_TOKEN_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|[,\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}])ease-in(?:$|[,\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}])"
);

#[derive(Debug, Default, Clone)]
pub struct NoEaseInMotion;

declare_oxc_lint!(
    /// Disallow ease-in timing for interface motion.
    NoEaseInMotion,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow ease-in timing for interface motion.",
);

impl Rule for NoEaseInMotion {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let Some(style) = get_inline_style_object_expression(attribute) else {
                    return;
                };
                for property_name in TIMING_PROPERTY_NAMES {
                    let Some((property, value)) =
                        get_effective_static_style_property_string_value(style, property_name)
                    else {
                        continue;
                    };
                    if EASE_IN_TOKEN_PATTERN.is_match(value) {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(INLINE_STYLE_MESSAGE)
                                .with_label(property.span()),
                        );
                    }
                }
            }
            AstKind::JSXOpeningElement(opening_element) => {
                for transition_object in
                    get_static_motion_transition_objects(opening_element, ctx)
                {
                    let Some((ease_property, ease_value)) =
                        get_effective_static_style_property_string_value(transition_object, "ease")
                    else {
                        continue;
                    };
                    if matches!(ease_value, "easeIn" | "ease-in") {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(MOTION_MESSAGE)
                                .with_label(ease_property.span()),
                        );
                    }
                }
                let Some(class_name) = get_static_class_name(opening_element) else {
                    return;
                };
                if tailwind_class_name_tokens(class_name)
                    .iter()
                    .any(|token| token.utility == "ease-in")
                {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(TAILWIND_MESSAGE)
                            .with_label(opening_element.span),
                    );
                }
            }
            _ => {}
        }
    }
}
