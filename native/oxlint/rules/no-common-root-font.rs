use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ROOT_LAYOUT_CLASS_NAMES: [&str; 4] = ["h-dvh", "h-screen", "min-h-dvh", "min-h-screen"];
const COMMON_FONT_CLASS_NAMES: [&str; 11] = [
    "font-sans",
    "font-arial",
    "font-geist",
    "font-helvetica",
    "font-inter",
    "font-lato",
    "font-montserrat",
    "font-open-sans",
    "font-plus-jakarta-sans",
    "font-roboto",
    "font-space-grotesk",
];
const COMMON_UI_FONT_FAMILIES: [&str; 10] = [
    "arial",
    "geist",
    "helvetica",
    "inter",
    "lato",
    "montserrat",
    "open sans",
    "plus jakarta sans",
    "roboto",
    "space grotesk",
];

#[derive(Debug, Default, Clone)]
pub struct NoCommonRootFont;

declare_oxc_lint!(
    /// Disallow common font choices on page roots.
    NoCommonRootFont,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow common font choices on page roots.",
);

impl Rule for NoCommonRootFont {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let class_name = get_static_class_name(opening_element);
        let tokens = class_name
            .map(|class_name| tailwind_class_name_tokens(class_name))
            .unwrap_or_default();
        let unvariant_utilities = tokens
            .iter()
            .filter(|token| token.variants.is_empty())
            .map(|token| token.utility)
            .collect::<Vec<_>>();
        let is_main_element = matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "main"
        );
        if !is_main_element
            && !ROOT_LAYOUT_CLASS_NAMES
                .iter()
                .any(|class_name| unvariant_utilities.contains(class_name))
        {
            return;
        }
        if let Some(common_font_class) = unvariant_utilities
            .iter()
            .find(|utility| COMMON_FONT_CLASS_NAMES.contains(utility))
        {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "The page root explicitly selects {common_font_class}. Choose typography that contributes a more specific voice."
                ))
                .with_label(opening_element.span),
            );
            return;
        }
        for attribute in &opening_element.attributes {
            let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let Some(style) = get_inline_style_object_expression(attribute) else {
                continue;
            };
            let Some((property, font_family)) =
                get_effective_static_style_property_string_value(style, "fontFamily")
            else {
                continue;
            };
            if font_family.contains("var(") {
                continue;
            }
            let primary_font = font_family
                .split(',')
                .next()
                .unwrap_or("")
                .trim_matches(|character| is_js_whitespace(character));
            let primary_font = primary_font
                .strip_prefix('\'')
                .or_else(|| primary_font.strip_prefix('"'))
                .unwrap_or(primary_font);
            let primary_font = primary_font
                .strip_suffix('\'')
                .or_else(|| primary_font.strip_suffix('"'))
                .unwrap_or(primary_font)
                .to_lowercase();
            if !COMMON_UI_FONT_FAMILIES.contains(&primary_font.as_str()) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "The page root defaults to {primary_font}, a very common UI font. Choose typography that contributes a more specific voice."
                ))
                .with_label(property.span),
            );
        }
    }
}
