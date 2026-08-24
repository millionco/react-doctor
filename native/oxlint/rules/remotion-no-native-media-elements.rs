use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct RemotionNoNativeMediaElements;

declare_oxc_lint!(
    /// Disallow native media elements in Remotion renders.
    RemotionNoNativeMediaElements,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow native media elements in Remotion renders.",
);

impl Rule for RemotionNoNativeMediaElements {
    fn run_once(&self, ctx: &LintContext<'_>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let oxc_ast::ast::JSXElementName::Identifier(identifier) = &opening_element.name else {
                continue;
            };
            let replacement = match identifier.name.as_str() {
                "audio" => "`Audio` from `@remotion/media`",
                "iframe" => "`IFrame` from `remotion`",
                "img" => "`Img` from `remotion`",
                "video" => "`Video` from `@remotion/media`",
                _ => continue,
            };
            if !remotion_render_function_has_evidence(node, ctx) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Native <{}> does not let Remotion reliably wait for and synchronize the asset. Use {replacement} instead.",
                    identifier.name
                ))
                .with_label(opening_element.span),
            );
        }
    }
}
