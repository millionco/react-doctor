struct StaticJsxAttributeResolution<'a> {
    attribute: Option<&'a oxc_ast::ast::JSXAttribute<'a>>,
    expression: Option<&'a oxc_ast::ast::Expression<'a>>,
    is_present: bool,
    is_unknown: bool,
}

fn missing_static_jsx_attribute() -> StaticJsxAttributeResolution<'static> {
    StaticJsxAttributeResolution {
        attribute: None,
        expression: None,
        is_present: false,
        is_unknown: false,
    }
}

fn unknown_static_jsx_attribute() -> StaticJsxAttributeResolution<'static> {
    StaticJsxAttributeResolution {
        attribute: None,
        expression: None,
        is_present: false,
        is_unknown: true,
    }
}

fn resolve_static_jsx_attribute<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    target_name: &str,
    is_case_sensitive: bool,
) -> StaticJsxAttributeResolution<'a> {
    for attribute in opening_element.attributes.iter().rev() {
        match attribute {
            oxc_ast::ast::JSXAttributeItem::SpreadAttribute(spread_attribute) => {
                let oxc_ast::ast::Expression::ObjectExpression(object_expression) =
                    &spread_attribute.argument
                else {
                    return unknown_static_jsx_attribute();
                };
                let spread_resolution = resolve_object_expression_attribute(
                    object_expression,
                    target_name,
                    is_case_sensitive,
                );
                if spread_resolution.is_present || spread_resolution.is_unknown {
                    return spread_resolution;
                }
            }
            oxc_ast::ast::JSXAttributeItem::Attribute(attribute) => {
                let oxc_ast::ast::JSXAttributeName::Identifier(identifier) = &attribute.name else {
                    continue;
                };
                if names_match_for_static_attribute(
                    identifier.name.as_str(),
                    target_name,
                    is_case_sensitive,
                ) {
                    return StaticJsxAttributeResolution {
                        attribute: Some(attribute),
                        expression: None,
                        is_present: true,
                        is_unknown: false,
                    };
                }
            }
        }
    }
    missing_static_jsx_attribute()
}

fn resolve_object_expression_attribute<'a>(
    object_expression: &'a oxc_ast::ast::ObjectExpression<'a>,
    target_name: &str,
    is_case_sensitive: bool,
) -> StaticJsxAttributeResolution<'a> {
    for property in object_expression.properties.iter().rev() {
        match property {
            oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread_property) => {
                let oxc_ast::ast::Expression::ObjectExpression(nested_object_expression) =
                    &spread_property.argument
                else {
                    return unknown_static_jsx_attribute();
                };
                let nested_resolution = resolve_object_expression_attribute(
                    nested_object_expression,
                    target_name,
                    is_case_sensitive,
                );
                if nested_resolution.is_present || nested_resolution.is_unknown {
                    return nested_resolution;
                }
            }
            oxc_ast::ast::ObjectPropertyKind::ObjectProperty(object_property) => {
                let Some(property_name) = object_property.key.static_name() else {
                    return unknown_static_jsx_attribute();
                };
                if names_match_for_static_attribute(
                    property_name.as_ref(),
                    target_name,
                    is_case_sensitive,
                ) {
                    return StaticJsxAttributeResolution {
                        attribute: None,
                        expression: Some(&object_property.value),
                        is_present: true,
                        is_unknown: false,
                    };
                }
            }
        }
    }
    missing_static_jsx_attribute()
}

fn names_match_for_static_attribute(left: &str, right: &str, is_case_sensitive: bool) -> bool {
    if is_case_sensitive {
        left == right
    } else {
        left.eq_ignore_ascii_case(right)
    }
}
