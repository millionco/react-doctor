use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const CLASS_MESSAGE: &str = "Tailwind transitions advance on browser time, so Remotion can capture inconsistent frames. Drive the property from `useCurrentFrame()` instead.";
const STYLE_MESSAGE: &str = "CSS transitions advance on browser time, so Remotion can capture inconsistent frames. Drive the property from `useCurrentFrame()` instead.";
const STYLE_PROPERTY_NAMES: [&str; 2] = ["transition", "transitionProperty"];

#[derive(Debug, Default, Clone)]
pub struct RemotionNoCssTransition;

declare_oxc_lint!(
    /// Disallow browser-timed CSS transitions in Remotion renders.
    RemotionNoCssTransition,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow browser-timed CSS transitions in Remotion renders.",
);

impl Rule for RemotionNoCssTransition {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        run_remotion_css_time_rule(
            node,
            ctx,
            &STYLE_PROPERTY_NAMES,
            class_token_is_forbidden,
            CLASS_MESSAGE,
            STYLE_MESSAGE,
        );
    }
}

fn class_token_is_forbidden(class_token: &str) -> bool {
    (class_token == "transition" || class_token.starts_with("transition-"))
        && class_token != "transition-none"
}
