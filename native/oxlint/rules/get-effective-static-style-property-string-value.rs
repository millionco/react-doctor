fn get_effective_static_style_property_string_value<'a>(
    object_expression: &'a oxc_ast::ast::ObjectExpression<'a>,
    target_name: &str,
) -> Option<(&'a oxc_ast::ast::ObjectProperty<'a>, &'a str)> {
    for property in object_expression.properties.iter().rev() {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(object_property) = property else {
            return None;
        };
        let Some(property_name) = object_property.key.static_name() else {
            return None;
        };
        if property_name != target_name {
            continue;
        }
        let oxc_ast::ast::Expression::StringLiteral(string_literal) = &object_property.value else {
            return None;
        };
        return Some((object_property, string_literal.value.as_str()));
    }
    None
}
