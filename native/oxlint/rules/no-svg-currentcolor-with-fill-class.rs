use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const NON_COLOR_PAINT_VALUE_PREFIXES: [&str; 8] = [
    "dasharray-",
    "dashoffset-",
    "linecap-",
    "linejoin-",
    "miterlimit-",
    "opacity-",
    "rule-",
    "width-",
];

#[derive(Debug, Default, Clone)]
pub struct NoSvgCurrentcolorWithFillClass;

declare_oxc_lint!(
    /// Disallow currentColor paint attributes that conflict with paint color classes.
    NoSvgCurrentcolorWithFillClass,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow currentColor and paint class conflicts.",
);

impl Rule for NoSvgCurrentcolorWithFillClass {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &opening_element.name else {
            return;
        };
        if identifier.name == "a" || !is_svg_tag_name(identifier.name.as_str()) {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        for paint in ["fill", "stroke"] {
            let Some(attribute) = find_jsx_attribute(opening_element, paint) else {
                continue;
            };
            if !get_string_literal_attribute_value(attribute)
                .is_some_and(|value| value.trim().eq_ignore_ascii_case("currentcolor"))
                || !has_color_paint_utility(&tokens, paint)
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "`{paint}=\"currentColor\"` and a `{paint}-*` color class on the same element conflict — the class wins. Remove one, or use `{paint}-current` to inherit the text color."
                ))
                .with_label(attribute.span),
            );
            return;
        }
    }
}

fn has_color_paint_utility(tokens: &[TailwindClassNameToken<'_>], paint: &str) -> bool {
    let prefix = if paint == "fill" { "fill-" } else { "stroke-" };
    get_effective_tailwind_class_name_token(tokens, |utility| {
        is_paint_property_utility(utility, prefix)
    })
    .is_some_and(|utility| is_color_paint_utility(utility, prefix))
}

fn is_paint_property_utility(utility: &str, prefix: &str) -> bool {
    let Some(value) = utility.strip_prefix(prefix) else {
        return false;
    };
    !value.is_empty()
        && !NON_COLOR_PAINT_VALUE_PREFIXES
            .iter()
            .any(|value_prefix| value.starts_with(value_prefix))
        && !value.as_bytes().first().is_some_and(u8::is_ascii_digit)
        && !value.strip_prefix('[').is_some_and(|arbitrary_value| {
            let bytes = arbitrary_value.as_bytes();
            bytes.first().is_some_and(u8::is_ascii_digit)
                || bytes.first() == Some(&b'.')
                    && bytes.get(1).is_some_and(u8::is_ascii_digit)
        })
}

fn is_color_paint_utility(utility: &str, prefix: &str) -> bool {
    let raw_value = utility.strip_prefix(prefix).unwrap_or_default();
    let value = raw_value.strip_prefix('[').unwrap_or(raw_value);
    let value = value.strip_suffix(']').unwrap_or(value).trim();
    !["current", "currentcolor", "none"]
        .iter()
        .any(|non_color| value.eq_ignore_ascii_case(non_color))
}
