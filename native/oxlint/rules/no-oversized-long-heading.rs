use oxc_ast::{ast::JSXElementName, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const LONG_DISPLAY_HEADING_MIN_CHARACTERS: usize = 40;
const OVERSIZED_DISPLAY_HEADING_MIN_PX: f64 = 64.0;
const MESSAGE: &str = "This sentence-length headline is set at a hero display scale and can dominate the viewport. Reduce the size or shorten the copy.";

#[derive(Debug, Default, Clone)]
pub struct NoOversizedLongHeading;

declare_oxc_lint!(
    /// Disallow sentence-length headlines at a hero display scale.
    NoOversizedLongHeading,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow oversized sentence-length headlines.",
);

impl Rule for NoOversizedLongHeading {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if identifier.name != "h1" {
            return;
        }
        let heading_text = normalize_heading_text(&get_static_jsx_text(element));
        if heading_text.encode_utf16().count() < LONG_DISPLAY_HEADING_MIN_CHARACTERS {
            return;
        }
        let has_tailwind = has_capability_or_unspecified(ctx, "tailwind");
        let Some(font_size_px) =
            get_static_effective_font_size(&element.opening_element, has_tailwind)
        else {
            return;
        };
        if font_size_px < OVERSIZED_DISPLAY_HEADING_MIN_PX {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn normalize_heading_text(value: &str) -> String {
    value
        .split(|character| is_js_whitespace(character))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
