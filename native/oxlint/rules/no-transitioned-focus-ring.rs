use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const FOCUS_TRANSITION_UTILITIES: [&str; 5] = [
    "transition-shadow",
    "transition-[box-shadow]",
    "transition-[outline]",
    "transition-[box-shadow,outline]",
    "transition-[outline,box-shadow]",
];

#[derive(Debug, Default, Clone)]
pub struct NoTransitionedFocusRing;

declare_oxc_lint!(
    /// Disallow transitions that delay keyboard focus indicators.
    NoTransitionedFocusRing,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow transitions that delay keyboard focus indicators.",
);

impl Rule for NoTransitionedFocusRing {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        if !tokens.iter().any(|token| {
            token.variants.contains(&"focus-visible") && is_tailwind_focus_indicator(token.utility)
        }) {
            return;
        }
        let Some(transition_utility) = tokens
            .iter()
            .filter(|token| token.variants.is_empty())
            .map(|token| token.utility)
            .find(|utility| FOCUS_TRANSITION_UTILITIES.contains(utility))
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "The {transition_utility} utility delays the focus indicator. Keyboard focus must appear immediately."
            ))
            .with_label(opening_element.span),
        );
    }
}

fn is_tailwind_focus_indicator(utility: &str) -> bool {
    if utility == "ring" {
        return true;
    }
    if let Some(ring_width) = utility.strip_prefix("ring-") {
        return ring_width.starts_with(|character: char| ('1'..='9').contains(&character));
    }
    utility
        .strip_prefix("outline-")
        .is_some_and(|outline| !outline.starts_with("none") && !outline.starts_with('0'))
}
