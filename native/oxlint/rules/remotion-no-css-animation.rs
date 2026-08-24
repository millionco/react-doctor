use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const CLASS_MESSAGE: &str = "Tailwind animations advance on browser time, so Remotion can capture inconsistent frames. Drive the property from `useCurrentFrame()` instead.";
const STYLE_MESSAGE: &str = "CSS animations advance on browser time, so Remotion can capture inconsistent frames. Drive the property from `useCurrentFrame()` instead.";
const STYLE_PROPERTY_NAMES: [&str; 2] = ["animation", "animationName"];

#[derive(Debug, Default, Clone)]
pub struct RemotionNoCssAnimation;

declare_oxc_lint!(
    /// Disallow browser-timed CSS animation in Remotion renders.
    RemotionNoCssAnimation,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow browser-timed CSS animation in Remotion renders.",
);

impl Rule for RemotionNoCssAnimation {
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
    class_token.starts_with("animate-") && class_token != "animate-none"
}
