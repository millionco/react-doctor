use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This compact purple-to-blue gradient tile is a common generated icon treatment. Use a visual tied to the product instead.";
const TAILWIND_DISPLAY_TOKENS: [&str; 21] = [
    "block",
    "inline-block",
    "inline",
    "flex",
    "inline-flex",
    "table",
    "inline-table",
    "table-caption",
    "table-cell",
    "table-column",
    "table-column-group",
    "table-footer-group",
    "table-header-group",
    "table-row-group",
    "table-row",
    "flow-root",
    "grid",
    "inline-grid",
    "contents",
    "list-item",
    "hidden",
];

#[derive(Debug, Default, Clone)]
pub struct NoGenericPurpleBlueIconGradient;

declare_oxc_lint!(
    /// Disallow generic purple-to-blue gradients on compact icon tiles.
    NoGenericPurpleBlueIconGradient,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow generic purple-to-blue icon gradients.",
);

impl Rule for NoGenericPurpleBlueIconGradient {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !is_proven_intrinsic_jsx_element(opening_element, ctx)
            || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            })
        {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let background_image = get_effective_tailwind_class_name_token(&tokens, |utility| {
            utility == "bg-none" || is_gradient_utility(utility)
        });
        let rounding = get_effective_tailwind_class_name_token(&tokens, is_whole_element_rounding);
        let display = get_effective_tailwind_class_name_token(&tokens, |utility| {
            TAILWIND_DISPLAY_TOKENS.contains(&utility)
        });
        if !background_image.is_some_and(is_gradient_utility)
            || !has_purple_and_blue_stops(&tokens)
            || !rounding.is_some_and(|utility| utility != "rounded-none")
            || !display.is_some_and(|utility| {
                matches!(utility, "flex" | "inline-flex" | "grid" | "inline-grid")
            })
            || !has_compact_square_size(&tokens)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn is_gradient_utility(utility: &str) -> bool {
    utility.starts_with("bg-gradient-to-")
        || utility.strip_prefix("bg-linear-").is_some_and(|suffix| {
            suffix.starts_with("to-")
                || suffix.starts_with(|character: char| character.is_ascii_digit())
                || suffix.starts_with('[')
                || suffix.starts_with('(')
        })
        || matches!(utility, "bg-radial" | "bg-conic")
        || utility.starts_with("bg-radial-")
        || utility.starts_with("bg-conic-")
        || utility.starts_with("-bg-linear-")
        || utility.starts_with("-bg-conic-")
}

fn has_purple_and_blue_stops(tokens: &[TailwindClassNameToken<'_>]) -> bool {
    let mut has_purple = false;
    let mut has_blue = false;
    for stop_name in ["from", "via", "to"] {
        let Some(utility) = get_effective_tailwind_class_name_token(tokens, |utility| {
            utility.starts_with(stop_name) && utility.as_bytes().get(stop_name.len()) == Some(&b'-')
        }) else {
            continue;
        };
        let Some(color) = gradient_stop_color(utility, stop_name) else {
            continue;
        };
        has_purple |= matches!(color, "indigo" | "purple" | "violet");
        has_blue |= matches!(color, "blue" | "cyan" | "sky");
    }
    has_purple && has_blue
}

fn gradient_stop_color<'a>(utility: &'a str, stop_name: &str) -> Option<&'a str> {
    let remainder = utility.strip_prefix(stop_name)?.strip_prefix('-')?;
    let (color, _) = remainder.split_once('-')?;
    (!color.is_empty() && color.bytes().all(|byte| byte.is_ascii_lowercase())).then_some(color)
}

fn is_whole_element_rounding(utility: &str) -> bool {
    if utility == "rounded" {
        return true;
    }
    let Some(value) = utility.strip_prefix("rounded-") else {
        return false;
    };
    matches!(
        value,
        "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full"
    ) || value.starts_with('[') && value.ends_with(']') && value.len() > 2
}

fn has_compact_square_size(tokens: &[TailwindClassNameToken<'_>]) -> bool {
    let width = get_effective_tailwind_class_name_token(tokens, |utility| {
        is_numeric_size_utility(utility, &["size", "w"])
    })
    .and_then(parse_size_utility);
    let height = get_effective_tailwind_class_name_token(tokens, |utility| {
        is_numeric_size_utility(utility, &["h", "size"])
    })
    .and_then(parse_size_utility);
    matches!((width, height), (Some(width), Some(height)) if width == height && width <= 16.0)
}

fn is_numeric_size_utility(utility: &str, names: &[&str]) -> bool {
    names.iter().any(|name| {
        utility
            .strip_prefix(name)
            .and_then(|suffix| suffix.strip_prefix('-'))
            .is_some_and(|value| {
                !value.is_empty()
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || byte == b'.')
            })
    })
}

fn parse_size_utility(utility: &str) -> Option<f64> {
    let value = utility.split_once('-')?.1;
    let mut has_digit = false;
    let mut has_decimal_point = false;
    let prefix_end = value.char_indices().find_map(|(index, character)| {
        if character.is_ascii_digit() {
            has_digit = true;
            return None;
        }
        if character == '.' && !has_decimal_point {
            has_decimal_point = true;
            return None;
        }
        Some(index)
    });
    if !has_digit {
        return None;
    }
    value[..prefix_end.unwrap_or(value.len())].parse().ok()
}
