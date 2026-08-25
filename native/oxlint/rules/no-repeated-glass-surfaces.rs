use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REPEATED_GLASS_SURFACE_MIN_COUNT: usize = 3;
static TRANSLUCENT_ARBITRARY_BACKGROUND_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> = lazy_regex::lazy_regex!(
    r"(?i)^bg-\[(?:hsla|rgba)\([^\]]+[,/][\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]*(?:0?\.\d+|\d+%)\)\]$"
);

#[derive(Debug, Default, Clone)]
pub struct NoRepeatedGlassSurfaces;

declare_oxc_lint!(
    /// Disallow pages built from repeated glass panels.
    NoRepeatedGlassSurfaces,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow repeated glass surfaces.",
);

impl Rule for NoRepeatedGlassSurfaces {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_top_level_page_copy_root(element, node, ctx) {
            return;
        }
        let mut opening_elements = vec![element.opening_element.as_ref()];
        collect_static_jsx_opening_elements(&element.children, &mut opening_elements);
        let glass_surface_count = opening_elements
            .into_iter()
            .filter(|opening_element| is_glass_surface(opening_element))
            .count();
        if glass_surface_count < REPEATED_GLASS_SURFACE_MIN_COUNT {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This page applies the same translucent, blurred, bordered treatment to {glass_surface_count} surfaces. Keep glass effects rare so the hierarchy stays clear."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn is_glass_surface(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(class_name) = get_static_class_name(opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    let utilities = tokens
        .iter()
        .filter(|token| token.variants.is_empty())
        .map(|token| token.utility)
        .collect::<Vec<_>>();
    let has_backdrop_blur = utilities.iter().any(|utility| {
        utility.starts_with("backdrop-blur")
            && !matches!(*utility, "backdrop-blur-0" | "backdrop-blur-none")
    });
    let has_translucent_background = utilities.iter().any(|utility| {
        is_translucent_tailwind_background(utility)
            || TRANSLUCENT_ARBITRARY_BACKGROUND_PATTERN.is_match(utility)
    });
    let has_rounding = !utilities.contains(&"rounded-none")
        && utilities
            .iter()
            .any(|utility| is_complete_tailwind_rounding(utility));
    has_backdrop_blur
        && has_translucent_background
        && has_rounding
        && has_visible_tailwind_border(&utilities)
}

fn is_translucent_tailwind_background(utility: &str) -> bool {
    let Some(value) = utility.strip_prefix("bg-") else {
        return false;
    };
    let Some((color, opacity)) = value.rsplit_once('/') else {
        return false;
    };
    !color.is_empty()
        && !color.contains('/')
        && !color.chars().any(is_js_whitespace)
        && matches!(opacity.len(), 1 | 2)
        && opacity.as_bytes()[0].is_ascii_digit()
        && opacity.as_bytes()[0] != b'0'
        && opacity.as_bytes().iter().all(u8::is_ascii_digit)
}

fn is_complete_tailwind_rounding(utility: &str) -> bool {
    if matches!(
        utility,
        "rounded"
            | "rounded-full"
            | "rounded-lg"
            | "rounded-md"
            | "rounded-sm"
            | "rounded-xl"
            | "rounded-xs"
    ) {
        return true;
    }
    if let Some(size) = utility
        .strip_prefix("rounded-")
        .and_then(|value| value.strip_suffix("xl"))
        && size.len() == 1
        && matches!(size.as_bytes()[0], b'2'..=b'9')
    {
        return true;
    }
    utility
        .strip_prefix("rounded-[")
        .and_then(|value| value.strip_suffix(']'))
        .is_some_and(|value| !value.is_empty() && !value.contains(']'))
}
