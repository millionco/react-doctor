use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CENTERED_HERO_MAX_STATIC_ELEMENTS: usize = 12;
const FULL_VIEWPORT_HEIGHT_TOKENS: [&str; 4] = ["h-dvh", "h-screen", "min-h-dvh", "min-h-screen"];
const MESSAGE: &str = "This hero fills the viewport only to center an H1, a common generic landing-page scaffold. Use content-led height and a more specific composition.";

#[derive(Debug, Default, Clone)]
pub struct NoFullViewportCenteredHero;

declare_oxc_lint!(
    /// Disallow generic full-viewport centered hero sections.
    NoFullViewportCenteredHero,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow full-viewport centered heroes.",
);

impl Rule for NoFullViewportCenteredHero {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && !is_error_surface_path(&ctx.file_path().to_string_lossy())
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if !matches!(identifier.name.as_str(), "header" | "section") {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let has_full_viewport_height = tokens.iter().any(|token| {
            token.variants.is_empty() && FULL_VIEWPORT_HEIGHT_TOKENS.contains(&token.utility)
        });
        let has_flex_centering = has_unvariant_utility(&tokens, "flex")
            && has_unvariant_utility(&tokens, "items-center")
            && has_unvariant_utility(&tokens, "justify-center");
        let has_grid_centering = has_unvariant_utility(&tokens, "grid")
            && (has_unvariant_utility(&tokens, "place-items-center")
                || (has_unvariant_utility(&tokens, "items-center")
                    && has_unvariant_utility(&tokens, "justify-center")));
        if !has_full_viewport_height || (!has_flex_centering && !has_grid_centering) {
            return;
        }
        let mut descendants = Vec::new();
        collect_static_jsx_opening_elements(&element.children, &mut descendants);
        if descendants.len() > CENTERED_HERO_MAX_STATIC_ELEMENTS
            || !descendants.iter().any(|opening_element| {
                matches!(
                    &opening_element.name,
                    JSXElementName::Identifier(identifier) if identifier.name == "h1"
                )
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn has_unvariant_utility(tokens: &[TailwindClassNameToken], utility: &str) -> bool {
    tokens
        .iter()
        .any(|token| token.variants.is_empty() && token.utility == utility)
}

fn is_error_surface_path(path: &str) -> bool {
    let lowercase_path = path.to_ascii_lowercase();
    ["404", "notfound", "not-found", "not_found", "not.found"]
        .iter()
        .any(|pattern| {
            lowercase_path
                .match_indices(pattern)
                .any(|(start, matched)| {
                    let end = start + matched.len();
                    (start == 0 || is_error_surface_separator(lowercase_path.as_bytes()[start - 1]))
                        && (end == lowercase_path.len()
                            || is_error_surface_separator(lowercase_path.as_bytes()[end]))
                })
        })
}

fn is_error_surface_separator(byte: u8) -> bool {
    matches!(byte, b'/' | b'.' | b'_' | b'-')
}
