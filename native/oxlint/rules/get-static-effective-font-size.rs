const ROOT_FONT_SIZE_PX: f64 = 16.0;

fn get_static_effective_font_size(
    opening_element: &oxc_ast::ast::JSXOpeningElement,
    has_tailwind: bool,
) -> Option<f64> {
    let class_name = get_static_class_name(opening_element);
    let tailwind_font_size = has_tailwind
        .then(|| class_name.and_then(|value| get_static_tailwind_font_size(value)))
        .flatten();
    if has_tailwind && class_name.is_some_and(|value| has_important_tailwind_font_size(value)) {
        return tailwind_font_size;
    }

    let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
    let Some(style_attribute) = style_attribute else {
        return if opening_element.attributes.iter().any(|attribute| {
            matches!(
                attribute,
                oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
            )
        }) {
            None
        } else {
            tailwind_font_size
        };
    };
    let style_expression = get_inline_style_object_expression(style_attribute)?;
    if let Some(font_size_property) =
        get_effective_static_style_property(style_expression, "fontSize")
    {
        return get_font_size_px(font_size_property);
    }
    style_expression
        .properties
        .iter()
        .all(|property| {
            matches!(
                property,
                oxc_ast::ast::ObjectPropertyKind::ObjectProperty(object_property)
                    if object_property.key.static_name().is_some()
            )
        })
        .then_some(tailwind_font_size)
        .flatten()
}

fn has_important_tailwind_font_size(class_name: &str) -> bool {
    tailwind_class_name_tokens(class_name).iter().any(|token| {
        token.variants.is_empty()
            && token.is_important
            && parse_static_tailwind_font_size(token.utility).is_some()
    })
}

fn get_font_size_px(property: &oxc_ast::ast::ObjectProperty) -> Option<f64> {
    if let Some(number_value) = get_static_style_property_number_value(property) {
        return Some(number_value);
    }
    let oxc_ast::ast::Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    let string_value = string_literal
        .value
        .trim_matches(|character| is_js_whitespace(character));
    string_value
        .strip_suffix("px")
        .and_then(parse_static_font_size_decimal)
        .or_else(|| {
            string_value
                .strip_suffix("rem")
                .and_then(parse_static_font_size_decimal)
                .map(|value| value * ROOT_FONT_SIZE_PX)
        })
}

fn parse_static_font_size_decimal(value: &str) -> Option<f64> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
        || value.bytes().filter(|byte| *byte == b'.').count() > 1
        || !value.bytes().any(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    value.parse().ok()
}
