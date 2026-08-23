use std::collections::HashSet;

use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EXCESSIVE_FONT_FAMILY_MIN_COUNT: usize = 4;
const FONT_WEIGHT_CLASS_NAMES: [&str; 9] = [
    "font-black",
    "font-bold",
    "font-extrabold",
    "font-extralight",
    "font-light",
    "font-medium",
    "font-normal",
    "font-semibold",
    "font-thin",
];

#[derive(Debug, Default, Clone)]
pub struct NoExcessiveFontFamilies;

declare_oxc_lint!(
    /// Disallow too many literal font families on one page.
    NoExcessiveFontFamilies,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow excessive font-family variation.",
);

impl Rule for NoExcessiveFontFamilies {
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
        let mut font_families = HashSet::new();
        for opening_element in opening_elements {
            collect_font_families(opening_element, &mut font_families);
        }
        if font_families.len() < EXCESSIVE_FONT_FAMILY_MIN_COUNT {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This page uses {} literal font families. Reduce the palette so typography communicates a coherent hierarchy.",
                font_families.len()
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn collect_font_families(
    opening_element: &oxc_ast::ast::JSXOpeningElement,
    font_families: &mut HashSet<String>,
) {
    if let Some(class_name) = get_static_class_name(opening_element) {
        for token in tailwind_class_name_tokens(class_name) {
            if token.variants.is_empty() && is_font_family_utility(token.utility) {
                font_families.insert(token.utility.to_lowercase());
            }
        }
    }
    for attribute in &opening_element.attributes {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            continue;
        };
        let Some(style) = get_inline_style_object_expression(attribute) else {
            continue;
        };
        let Some(property) = get_effective_static_style_property(style, "fontFamily") else {
            continue;
        };
        let oxc_ast::ast::Expression::StringLiteral(string_literal) = &property.value else {
            continue;
        };
        let font_family = string_literal
            .value
            .trim_matches(|character| is_js_whitespace(character));
        if font_family.is_empty() || font_family.contains("var(") {
            continue;
        }
        let primary_font_family = font_family
            .split(',')
            .next()
            .unwrap_or(font_family)
            .replace(['"', '\''], "")
            .trim_matches(|character| is_js_whitespace(character))
            .to_lowercase();
        font_families.insert(primary_font_family);
    }
}

fn is_font_family_utility(utility: &str) -> bool {
    if !utility.starts_with("font-")
        || FONT_WEIGHT_CLASS_NAMES.contains(&utility)
        || utility.starts_with("font-stretch-")
        || utility.starts_with("font-width-")
    {
        return false;
    }
    let Some(arbitrary_value) = utility.strip_prefix("font-[") else {
        return true;
    };
    !arbitrary_value
        .as_bytes()
        .first()
        .is_some_and(|byte| byte.is_ascii_digit())
        && !arbitrary_value.starts_with("weight:")
        && !arbitrary_value.starts_with("font-weight:")
        && !(arbitrary_value.starts_with("var(--")
            && arbitrary_value
                .split(']')
                .next()
                .is_some_and(|value| value.contains("weight")))
}
