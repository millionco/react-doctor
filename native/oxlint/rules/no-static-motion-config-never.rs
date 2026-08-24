use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This MotionConfig hard-codes reducedMotion=\"never\", so transform and layout motion ignores the user's operating-system preference.";

#[derive(Debug, Default, Clone)]
pub struct NoStaticMotionConfigNever;

declare_oxc_lint!(
    /// Disallow root MotionConfig policies that ignore reduced motion.
    NoStaticMotionConfigNever,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow root MotionConfig policies that ignore reduced motion.",
);

impl Rule for NoStaticMotionConfigNever {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_root_motion_config_filename(&ctx.file_path().to_string_lossy())
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !motion_react_component_matches(&opening_element.name, "MotionConfig", ctx) {
            return;
        }
        let Some(reduced_motion_attribute) =
            get_authoritative_jsx_attribute(opening_element, "reducedMotion", true)
        else {
            return;
        };
        if get_string_literal_attribute_value(reduced_motion_attribute) != Some("never") {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(reduced_motion_attribute.span));
    }
}

fn is_root_motion_config_filename(filename: &str) -> bool {
    let normalized_filename = filename.replace('\\', "/").to_lowercase();
    let basename = normalized_filename
        .rsplit('/')
        .next()
        .unwrap_or(normalized_filename.as_str());
    matches!(
        basename,
        "app.jsx" | "app.tsx" | "main.jsx" | "main.tsx" | "root.jsx" | "root.tsx"
    ) || normalized_filename.ends_with("/app/layout.jsx")
        || normalized_filename.ends_with("/app/layout.tsx")
        || normalized_filename.ends_with("/pages/_app.jsx")
        || normalized_filename.ends_with("/pages/_app.tsx")
}
