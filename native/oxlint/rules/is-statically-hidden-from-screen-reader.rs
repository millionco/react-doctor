fn is_statically_hidden_from_screen_reader<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if resolve_jsx_element_type(opening_element, ctx)
        .is_some_and(|(tag_name, _)| tag_name.eq_ignore_ascii_case("input"))
    {
        let type_resolution = resolve_static_jsx_attribute(opening_element, "type", false);
        if get_resolved_static_string(&type_resolution)
            .is_some_and(|value| value.eq_ignore_ascii_case("hidden"))
        {
            return true;
        }
    }

    let hidden_resolution = resolve_static_jsx_attribute(opening_element, "hidden", false);
    if hidden_resolution.is_present {
        if hidden_resolution
            .attribute
            .is_some_and(|attribute| attribute.value.is_none())
        {
            return true;
        }
        if let Some(static_string_value) = get_resolved_static_string(&hidden_resolution) {
            return !static_string_value.is_empty();
        }
        if get_resolved_expression(&hidden_resolution).is_some_and(is_truthy_static_literal) {
            return true;
        }
    }

    let aria_hidden_resolution =
        resolve_static_jsx_attribute(opening_element, "aria-hidden", false);
    if !aria_hidden_resolution.is_present {
        return false;
    }
    if get_resolved_static_string(&aria_hidden_resolution)
        .is_some_and(|value| value.eq_ignore_ascii_case("true"))
    {
        return true;
    }
    if aria_hidden_resolution
        .attribute
        .is_some_and(|attribute| attribute.value.is_none())
    {
        return true;
    }
    let Some(expression) = get_resolved_expression(&aria_hidden_resolution) else {
        return false;
    };
    matches!(
        expression,
        oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) if boolean_literal.value
    )
}

fn get_resolved_static_string<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
) -> Option<&'a str> {
    resolution
        .attribute
        .and_then(|attribute| get_string_literal_attribute_value(attribute))
        .or_else(|| {
            resolution
                .expression
                .and_then(|expression| get_static_string_expression(expression))
        })
}

fn get_resolved_expression<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    if let Some(expression) = resolution.expression {
        return Some(expression.get_inner_expression());
    }
    let attribute = resolution.attribute?;
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) =
        attribute.value.as_ref()?
    else {
        return None;
    };
    Some(container.expression.as_expression()?.get_inner_expression())
}

fn is_truthy_static_literal(expression: &oxc_ast::ast::Expression) -> bool {
    match expression {
        oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) => boolean_literal.value,
        oxc_ast::ast::Expression::NumericLiteral(number_literal) => number_literal.value != 0.0,
        oxc_ast::ast::Expression::StringLiteral(string_literal) => !string_literal.value.is_empty(),
        _ => false,
    }
}
