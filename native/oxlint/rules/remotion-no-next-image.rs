use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "Next.js <Image> does not expose a reliable loading signal to Remotion, so rendered frames can flicker. Use <Img> from `remotion` instead.";

#[derive(Debug, Default, Clone)]
pub struct RemotionNoNextImage;

declare_oxc_lint!(
    /// Disallow Next.js Image in Remotion renders.
    RemotionNoNextImage,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow Next.js Image in Remotion renders.",
);

impl Rule for RemotionNoNextImage {
    fn run_once(&self, ctx: &LintContext<'_>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if remotion_render_function_has_evidence(node, ctx)
                && resolve_imported_jsx_component_name(opening_element, "next/image", ctx)
                    == Some("default")
            {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
            }
        }
    }
}
