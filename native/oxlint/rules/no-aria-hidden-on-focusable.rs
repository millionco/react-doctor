use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXExpression,
        JSXOpeningElement, ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::LintContext,
    rule::Rule,
    utils::{get_element_type, get_string_literal_prop_value, has_jsx_prop_ignore_case},
};

const MESSAGE: &str = "Screen reader users tab to this focusable element but hear nothing because `aria-hidden` skips it, so remove `aria-hidden` or stop it being focusable.";

#[derive(Debug, Default, Clone)]
pub struct NoAriaHiddenOnFocusable;

declare_oxc_lint!(
    /// Disallow aria-hidden on focusable elements.
    NoAriaHiddenOnFocusable,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow aria-hidden on focusable elements.",
);

impl Rule for NoAriaHiddenOnFocusable {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(JSXAttributeItem::Attribute(aria_hidden_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "aria-hidden")
        else {
            return;
        };
        if !is_aria_hidden_true(aria_hidden_attribute)
            || !is_focusable_jsx_opening_element(opening_element, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(aria_hidden_attribute.span));
    }
}

fn is_aria_hidden_true(attribute: &JSXAttribute) -> bool {
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(string_literal)) => string_literal.value == "true",
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            matches!(
                &container.expression,
                JSXExpression::BooleanLiteral(boolean_literal) if boolean_literal.value
            ) || matches!(
                &container.expression,
                JSXExpression::StringLiteral(string_literal) if string_literal.value == "true"
            )
        }
        _ => false,
    }
}

fn is_focusable_jsx_opening_element<'a>(
    opening_element: &'a JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let tab_index_value = has_jsx_prop_ignore_case(opening_element, "tabIndex")
        .and_then(JSXAttributeItem::as_attribute)
        .and_then(|attribute| attribute.value.as_ref())
        .and_then(|value| parse_static_jsx_number(value));
    if tab_index_value.is_some_and(|value| value < 0.0)
        || has_jsx_prop_ignore_case(opening_element, "hidden").is_some()
        || has_static_hiding_inline_style(opening_element)
        || has_hiding_class_name(opening_element)
    {
        return false;
    }
    tab_index_value.is_some_and(|value| value >= 0.0)
        || is_natively_focusable(&resolve_element_type(opening_element, ctx), opening_element)
}

fn resolve_element_type<'a>(
    opening_element: &'a JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> String {
    let Some((base_element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return get_element_type(ctx, opening_element).into_owned();
    };
    let settings = &ctx.settings().jsx_a11y;
    let raw_element_type = settings
        .polymorphic_prop_name
        .as_ref()
        .and_then(|property_name| has_jsx_prop_ignore_case(opening_element, property_name))
        .and_then(get_string_literal_prop_value)
        .unwrap_or(base_element_type);
    settings
        .components
        .get(raw_element_type)
        .map_or_else(|| raw_element_type.to_string(), ToString::to_string)
}

fn is_natively_focusable(tag_name: &str, opening_element: &JSXOpeningElement) -> bool {
    if matches!(tag_name, "button" | "input" | "select" | "textarea")
        && has_jsx_prop_ignore_case(opening_element, "disabled")
            .and_then(JSXAttributeItem::as_attribute)
            .is_some_and(|attribute| !is_statically_false_boolean_attribute(attribute))
    {
        return false;
    }
    match tag_name {
        "button" | "embed" | "select" | "summary" | "textarea" => true,
        "input" => !has_jsx_prop_ignore_case(opening_element, "type")
            .and_then(get_string_literal_prop_value)
            .is_some_and(|value| value.eq_ignore_ascii_case("hidden")),
        "a" | "area" => has_jsx_prop_ignore_case(opening_element, "href").is_some(),
        "audio" | "video" => has_jsx_prop_ignore_case(opening_element, "controls")
            .and_then(JSXAttributeItem::as_attribute)
            .is_some_and(|attribute| !is_statically_false_boolean_attribute(attribute)),
        _ => false,
    }
}

fn is_statically_false_boolean_attribute(attribute: &JSXAttribute) -> bool {
    matches!(
        attribute.value.as_ref(),
        Some(JSXAttributeValue::ExpressionContainer(container))
            if matches!(
                &container.expression,
                JSXExpression::BooleanLiteral(boolean_literal) if !boolean_literal.value
            )
    )
}

fn has_static_hiding_inline_style(opening_element: &JSXOpeningElement) -> bool {
    let Some(JSXAttributeItem::Attribute(style_attribute)) =
        has_jsx_prop_ignore_case(opening_element, "style")
    else {
        return false;
    };
    let Some(JSXAttributeValue::ExpressionContainer(container)) = style_attribute.value.as_ref()
    else {
        return false;
    };
    let JSXExpression::ObjectExpression(object_expression) = &container.expression else {
        return false;
    };
    object_expression.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        let Some(property_name) = get_static_property_name(&property.key) else {
            return false;
        };
        let Expression::StringLiteral(string_literal) = &property.value else {
            return false;
        };
        matches!(
            (property_name, string_literal.value.as_str()),
            ("display", "none") | ("visibility", "hidden")
        )
    })
}

fn get_static_property_name<'a>(property_key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match property_key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
        _ => None,
    }
}

fn has_hiding_class_name(opening_element: &JSXOpeningElement) -> bool {
    let Some(JSXAttributeItem::Attribute(class_name_attribute)) =
        has_jsx_prop_ignore_case(opening_element, "className")
    else {
        return false;
    };
    let Some(class_name_text) = class_name_text(class_name_attribute) else {
        return false;
    };
    has_hiding_class_token(&class_name_text)
}

fn class_name_text(attribute: &JSXAttribute) -> Option<String> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(string_literal) => Some(string_literal.value.to_string()),
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(string_literal) => Some(string_literal.value.to_string()),
            JSXExpression::TemplateLiteral(template_literal) => Some(
                template_literal
                    .quasis
                    .iter()
                    .map(|quasi| {
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or("", |cooked| cooked.as_str())
                    })
                    .collect::<Vec<_>>()
                    .join(" "),
            ),
            _ => None,
        },
        _ => None,
    }
}

fn has_hiding_class_token(class_name_text: &str) -> bool {
    let mut token = String::new();
    let mut bracket_depth = 0_u32;
    let mut parenthesis_depth = 0_u32;
    let mut quote = None;
    let mut is_escaped = false;
    for character in class_name_text.chars() {
        if is_escaped {
            is_escaped = false;
            token.push(character);
            continue;
        }
        if character == '\\' {
            is_escaped = true;
            token.push(character);
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            }
            token.push(character);
            continue;
        }
        if matches!(character, '\'' | '"') {
            quote = Some(character);
            token.push(character);
            continue;
        }
        match character {
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '(' => parenthesis_depth += 1,
            ')' => parenthesis_depth = parenthesis_depth.saturating_sub(1),
            _ => {}
        }
        if bracket_depth == 0
            && parenthesis_depth == 0
            && (character.is_whitespace() || character == '\u{feff}')
        {
            if is_hiding_class_token(&token) {
                return true;
            }
            token.clear();
        } else {
            token.push(character);
        }
    }
    is_hiding_class_token(&token)
}

fn is_hiding_class_token(token: &str) -> bool {
    token == "hidden" || token.ends_with("-hidden")
}
