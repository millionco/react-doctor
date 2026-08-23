fn get_authoritative_jsx_attribute<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    target_name: &str,
    is_case_sensitive: bool,
) -> Option<&'b oxc_ast::ast::JSXAttribute<'a>> {
    for attribute in opening_element.attributes.iter().rev() {
        match attribute {
            oxc_ast::ast::JSXAttributeItem::SpreadAttribute(spread_attribute)
                if can_expression_override_jsx_attribute(
                    &spread_attribute.argument,
                    target_name,
                    is_case_sensitive,
                ) =>
            {
                return None;
            }
            oxc_ast::ast::JSXAttributeItem::Attribute(attribute)
                if jsx_attribute_name_matches(attribute, target_name, is_case_sensitive) =>
            {
                return Some(attribute);
            }
            _ => {}
        }
    }
    None
}

fn can_expression_override_jsx_attribute(
    expression: &oxc_ast::ast::Expression,
    target_name: &str,
    is_case_sensitive: bool,
) -> bool {
    let oxc_ast::ast::Expression::ObjectExpression(object_expression) =
        expression.get_inner_expression()
    else {
        return true;
    };
    object_expression
        .properties
        .iter()
        .any(|property| match property {
            oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread_property) => {
                can_expression_override_jsx_attribute(
                    &spread_property.argument,
                    target_name,
                    is_case_sensitive,
                )
            }
            oxc_ast::ast::ObjectPropertyKind::ObjectProperty(object_property) => {
                let Some(property_name) = object_property.key.static_name() else {
                    return true;
                };
                names_match(property_name.as_ref(), target_name, is_case_sensitive)
            }
        })
}

fn jsx_attribute_name_matches(
    attribute: &oxc_ast::ast::JSXAttribute,
    target_name: &str,
    is_case_sensitive: bool,
) -> bool {
    match &attribute.name {
        oxc_ast::ast::JSXAttributeName::Identifier(identifier) => {
            names_match(identifier.name.as_str(), target_name, is_case_sensitive)
        }
        oxc_ast::ast::JSXAttributeName::NamespacedName(namespaced_name) => {
            let attribute_name = format!(
                "{}:{}",
                namespaced_name.namespace.name, namespaced_name.name.name
            );
            names_match(&attribute_name, target_name, is_case_sensitive)
        }
    }
}

fn names_match(left: &str, right: &str, is_case_sensitive: bool) -> bool {
    if is_case_sensitive {
        left == right
    } else {
        left.eq_ignore_ascii_case(right)
    }
}
