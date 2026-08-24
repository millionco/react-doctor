use oxc_ast::{AstKind, ast::JSXAttributeItem};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This textarea disables user resizing, which can make long input difficult to review. Allow vertical or block-axis resizing unless the field auto-grows.";

#[derive(Debug, Default, Clone)]
pub struct NoNonresizableTextarea;

declare_oxc_lint!(
    /// Disallow textareas that users cannot resize.
    NoNonresizableTextarea,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow textareas that users cannot resize.",
);

impl Rule for NoNonresizableTextarea {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type_name(opening_element, ctx) != "textarea"
            || opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let class_name_tokens = get_static_class_name(opening_element)
            .map(|class_name| tailwind_class_name_tokens(class_name))
            .unwrap_or_default();
        let has_resize_none_class = class_name_tokens
            .iter()
            .any(|token| token.variants.is_empty() && token.utility == "resize-none")
            && !class_name_tokens.iter().any(|token| {
                token.variants.is_empty() && token.utility == "field-sizing-content"
            });
        let style = find_jsx_attribute(opening_element, "style")
            .and_then(|attribute| get_inline_style_object_expression(attribute));
        let resize_property =
            style.and_then(|style| get_effective_static_style_property(style, "resize"));
        let field_sizing_property =
            style.and_then(|style| get_effective_static_style_property(style, "fieldSizing"));
        let has_inline_resize_none = resize_property.is_some_and(|property| {
            static_style_property_value(property) == Some("none")
                && field_sizing_property
                    .and_then(static_style_property_value)
                    != Some("content")
        });
        if !has_resize_none_class && !has_inline_resize_none {
            return;
        }
        let diagnostic_span = resize_property.map_or(opening_element.span, GetSpan::span);
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(diagnostic_span));
    }
}

fn static_style_property_value<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    let oxc_ast::ast::Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    Some(string_literal.value.as_str())
}
