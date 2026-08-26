use oxc_ast::{
    AstKind,
    ast::{JSXChild, JSXElement, JSXOpeningElement, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MINIMUM_TARGET_SIZE_PX: f64 = 24.0;

#[derive(Clone, Copy)]
enum InlineTargetSize {
    NoTargetStyle,
    TargetStyle(Option<(f64, f64)>),
}

#[derive(Debug, Default, Clone)]
pub struct NoUndersizedIconButton;

declare_oxc_lint!(
    /// Disallow icon-only button targets smaller than 24px.
    NoUndersizedIconButton,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow undersized icon-only button targets.",
);

impl Rule for NoUndersizedIconButton {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(&element.opening_element, ctx).map(|(name, _)| name)
            != Some("button")
            || element.opening_element.attributes.iter().any(|attribute| {
                matches!(attribute, oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_))
            })
            || !no_undersized_icon_button_is_icon_only(element)
        {
            return;
        }

        let class_name = get_static_class_name(&element.opening_element);
        let tailwind_tokens = class_name
            .map_or_else(Vec::new, |class_name| tailwind_class_name_tokens(class_name));
        let inline_target_size =
            no_undersized_icon_button_inline_target_size(&element.opening_element);
        let target_size = if let InlineTargetSize::TargetStyle(target_size) = inline_target_size {
            target_size.filter(|_| {
                !no_undersized_icon_button_has_important_target_utility(&tailwind_tokens)
            })
        } else if has_capability_or_unspecified(ctx, "tailwind") {
            no_undersized_icon_button_tailwind_target_size(class_name, &tailwind_tokens)
        } else {
            None
        };
        let Some((width, height)) = target_size else {
            return;
        };
        if width >= MINIMUM_TARGET_SIZE_PX && height >= MINIMUM_TARGET_SIZE_PX {
            return;
        }
        let width_text = format_javascript_number(width);
        let height_text = format_javascript_number(height);
        let minimum_target_size_text = format_javascript_number(MINIMUM_TARGET_SIZE_PX);
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This icon-only button is explicitly {width_text}×{height_text}px with no padding, below the {minimum_target_size_text}×{minimum_target_size_text}px minimum target. Enlarge its hit area."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn no_undersized_icon_button_is_icon_only(element: &JSXElement<'_>) -> bool {
    let mut icon_count = 0;
    for child in &element.children {
        match child {
            JSXChild::Text(text) if text.value.trim().is_empty() => {}
            JSXChild::Element(_) => icon_count += 1,
            _ => return false,
        }
    }
    icon_count == 1
}

fn no_undersized_icon_button_has_important_target_utility(
    tokens: &[TailwindClassNameToken<'_>],
) -> bool {
    tokens.iter().any(|token| {
        token.variants.is_empty()
            && token.is_important
            && (no_undersized_icon_button_is_width_utility(token.utility)
                || no_undersized_icon_button_is_height_utility(token.utility)
                || no_undersized_icon_button_is_horizontal_padding_utility(token.utility)
                || no_undersized_icon_button_is_vertical_padding_utility(token.utility))
    })
}

fn no_undersized_icon_button_tailwind_target_size(
    class_name: Option<&str>,
    tokens: &[TailwindClassNameToken<'_>],
) -> Option<(f64, f64)> {
    if class_name.is_none_or(str::is_empty)
        || tokens.iter().any(|token| {
            token
                .variants
                .iter()
                .any(|variant| matches!(*variant, "before" | "after"))
        })
    {
        return None;
    }
    let horizontal_padding = get_effective_tailwind_class_name_token(tokens, |utility| {
        no_undersized_icon_button_is_horizontal_padding_utility(utility)
    })?;
    let vertical_padding = get_effective_tailwind_class_name_token(tokens, |utility| {
        no_undersized_icon_button_is_vertical_padding_utility(utility)
    })?;
    if !matches!(horizontal_padding, "p-0" | "px-0")
        || !matches!(vertical_padding, "p-0" | "py-0")
        || tokens.iter().any(|token| {
            token.variants.is_empty()
                && (token.utility.starts_with("min-w-")
                    || token.utility.starts_with("min-h-"))
        })
    {
        return None;
    }
    let width_utility = get_effective_tailwind_class_name_token(tokens, |utility| {
        no_undersized_icon_button_is_width_utility(utility)
    })?;
    let height_utility = get_effective_tailwind_class_name_token(tokens, |utility| {
        no_undersized_icon_button_is_height_utility(utility)
    })?;
    let width = parse_static_tailwind_length_px(width_utility, "size")
        .or_else(|| parse_static_tailwind_length_px(width_utility, "w"))?;
    let height = parse_static_tailwind_length_px(height_utility, "size")
        .or_else(|| parse_static_tailwind_length_px(height_utility, "h"))?;
    Some((width, height))
}

fn no_undersized_icon_button_inline_target_size(
    opening_element: &JSXOpeningElement<'_>,
) -> InlineTargetSize {
    let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", true)
    else {
        return InlineTargetSize::NoTargetStyle;
    };
    let Some(style) = get_inline_style_object_expression(style_attribute) else {
        return InlineTargetSize::TargetStyle(None);
    };
    let width_property = get_effective_static_style_property(style, "width");
    let height_property = get_effective_static_style_property(style, "height");
    let padding_property = get_effective_static_style_property(style, "padding");
    let has_target_style =
        width_property.is_some() || height_property.is_some() || padding_property.is_some();
    if !has_target_style {
        return if style.properties.iter().any(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => property.key.static_name().is_none(),
                ObjectPropertyKind::SpreadProperty(_) => true,
            }) {
            InlineTargetSize::TargetStyle(None)
        } else {
            InlineTargetSize::NoTargetStyle
        };
    }
    let (Some(width_property), Some(height_property), Some(padding_property)) =
        (width_property, height_property, padding_property)
    else {
        return InlineTargetSize::TargetStyle(None);
    };
    let target_size = get_static_style_property_number_value(width_property)
        .zip(get_static_style_property_number_value(height_property))
        .zip(get_static_style_property_number_value(padding_property))
        .and_then(|((width, height), padding)| (padding == 0.0).then_some((width, height)));
    InlineTargetSize::TargetStyle(target_size)
}

fn no_undersized_icon_button_is_width_utility(utility: &str) -> bool {
    utility.starts_with("size-") || utility.starts_with("w-")
}

fn no_undersized_icon_button_is_height_utility(utility: &str) -> bool {
    utility.starts_with("h-") || utility.starts_with("size-")
}

fn no_undersized_icon_button_is_horizontal_padding_utility(utility: &str) -> bool {
    utility.starts_with("p-")
        || utility.starts_with("px-")
        || utility.starts_with("pl-")
        || utility.starts_with("pr-")
}

fn no_undersized_icon_button_is_vertical_padding_utility(utility: &str) -> bool {
    utility.starts_with("p-")
        || utility.starts_with("py-")
        || utility.starts_with("pt-")
        || utility.starts_with("pb-")
}
