use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeValue, JSXChild},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

#[derive(Debug, Default, Clone)]
pub struct NoPulsingStatusDot;
declare_oxc_lint!(
    /// Disallow decorative pulsing status dots.
    NoPulsingStatusDot,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow decorative pulsing status dots."
);

impl Rule for NoPulsingStatusDot {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let opening = &element.opening_element;
        if !has_capability_or_unspecified(ctx, "tailwind")
            || !is_proven_intrinsic_jsx_element(opening, ctx)
            || get_authoritative_jsx_attribute(opening, "style", true).is_some()
            || !element
                .children
                .iter()
                .all(|child| matches!(child, JSXChild::Text(text) if text.value.trim().is_empty()))
            || no_pulsing_status_has_live_semantics(node, ctx)
            || is_statically_hidden_opening_element(opening, ctx)
            || is_inside_statically_hidden_jsx_subtree(node, ctx)
            || !no_pulsing_status_has_context(node, ctx)
        {
            return;
        }
        let Some(class_name) = get_static_class_name(opening) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let animation = get_effective_tailwind_class_name_token(&tokens, |utility| {
            utility.starts_with("animate-")
        });
        if !matches!(animation, Some("animate-ping" | "animate-pulse")) {
            return;
        }
        if get_effective_tailwind_class_name_token(&tokens, |utility| {
            utility == "rounded" || utility.starts_with("rounded-")
        }) != Some("rounded-full")
        {
            return;
        }
        let width = get_effective_tailwind_class_name_token(&tokens, |utility| {
            utility.starts_with("size-") || utility.starts_with("w-")
        });
        let height = get_effective_tailwind_class_name_token(&tokens, |utility| {
            utility.starts_with("size-") || utility.starts_with("h-")
        });
        let width_px = width.and_then(|utility| {
            parse_static_tailwind_length_px(utility, "size")
                .or_else(|| parse_static_tailwind_length_px(utility, "w"))
        });
        let height_px = height.and_then(|utility| {
            parse_static_tailwind_length_px(utility, "size")
                .or_else(|| parse_static_tailwind_length_px(utility, "h"))
        });
        if !matches!((width_px, height_px), (Some(width), Some(height)) if width == height && (2.0..=16.0).contains(&width))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn("This tiny status dot pulses continuously without representing work in progress. Use a static indicator for passive availability or decoration.").with_label(opening.span));
    }
}

fn no_pulsing_status_static_boolean(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> Option<bool> {
    if attribute.value.is_none() {
        return Some(true);
    }
    let value = match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(value) => {
            return match value.value.to_ascii_lowercase().as_str() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            };
        }
        JSXAttributeValue::ExpressionContainer(container) => {
            container.expression.as_expression()?.get_inner_expression()
        }
        _ => return None,
    };
    match value {
        Expression::BooleanLiteral(value) => Some(value.value),
        Expression::StringLiteral(value) => match value.value.to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}
fn no_pulsing_status_has_live_semantics(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    std::iter::once(node)
        .chain(ctx.nodes().ancestors(node.id()))
        .any(|candidate| {
            let AstKind::JSXElement(element) = candidate.kind() else {
                return false;
            };
            let opening = &element.opening_element;
            if opening
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
            {
                return true;
            }
            if let Some(attribute) = get_authoritative_jsx_attribute(opening, "aria-busy", false)
                && no_pulsing_status_static_boolean(attribute) != Some(false)
            {
                return true;
            }
            if let Some(attribute) = get_authoritative_jsx_attribute(opening, "aria-live", false) {
                let value = get_string_literal_attribute_value(attribute);
                if value.is_none_or(|value| !value.trim().eq_ignore_ascii_case("off")) {
                    return true;
                }
            }
            if let Some(attribute) = get_authoritative_jsx_attribute(opening, "role", false) {
                let Some(value) = get_string_literal_attribute_value(attribute) else {
                    return true;
                };
                if value.is_empty()
                    || value.split_whitespace().any(|role| {
                        matches!(
                            role.to_ascii_lowercase().as_str(),
                            "alert" | "progressbar" | "status"
                        )
                    })
                {
                    return true;
                }
            }
            false
        })
}
fn no_pulsing_status_has_context(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut nearest_section_has_heading = None;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        match &element.opening_element.name {
            oxc_ast::ast::JSXElementName::Identifier(identifier)
                if matches!(identifier.name.as_str(), "header" | "nav") =>
            {
                return true;
            }
            oxc_ast::ast::JSXElementName::Identifier(identifier)
                if identifier.name == "section" && nearest_section_has_heading.is_none() =>
            {
                nearest_section_has_heading = Some(
                    get_static_jsx_descendant_opening_elements(element, false)
                        .iter()
                        .any(|opening| matches!(&opening.name, oxc_ast::ast::JSXElementName::Identifier(identifier) if identifier.name == "h1")),
                );
            }
            _ => {}
        }
        if get_authoritative_jsx_attribute(&element.opening_element, "role", false)
            .and_then(|attribute| get_string_literal_attribute_value(attribute))
            .is_some_and(|value| {
                value
                    .split_whitespace()
                    .any(|role| role.eq_ignore_ascii_case("navigation"))
            })
        {
            return true;
        }
    }
    nearest_section_has_heading.unwrap_or(false)
}
