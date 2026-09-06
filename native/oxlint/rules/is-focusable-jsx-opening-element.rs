use oxc_ast::ast::{
    Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXExpression,
    JSXOpeningElement, ObjectPropertyKind, PropertyKey,
};

use crate::utils::{get_string_literal_prop_value, has_jsx_prop_ignore_case};

fn is_focusable_jsx_opening_element(
    opening_element: &JSXOpeningElement,
    tag_name: &str,
    include_negative_tab_index: bool,
) -> bool {
    let tab_index_value = has_jsx_prop_ignore_case(opening_element, "tabIndex")
        .and_then(JSXAttributeItem::as_attribute)
        .and_then(|attribute| attribute.value.as_ref())
        .and_then(|value| parse_static_jsx_number(value));
    if (tab_index_value.is_some_and(|value| value < 0.0) && !include_negative_tab_index)
        || has_jsx_prop_ignore_case(opening_element, "hidden").is_some()
        || has_static_hiding_inline_style(opening_element)
        || has_hiding_class_name(opening_element)
    {
        return false;
    }
    tab_index_value.is_some_and(|value| value >= 0.0 || include_negative_tab_index)
        || is_natively_focusable(tag_name, opening_element)
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
