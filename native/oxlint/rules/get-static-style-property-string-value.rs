fn get_static_style_property_string_value<'a>(
    property: &'a oxc_ast::ast::ObjectPropertyKind<'a>,
    target_name: &str,
) -> Option<(&'a oxc_ast::ast::ObjectProperty<'a>, &'a str)> {
    let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(object_property) = property else {
        return None;
    };
    if object_property.key.static_name().as_deref() != Some(target_name) {
        return None;
    }
    let oxc_ast::ast::Expression::StringLiteral(string_literal) = &object_property.value else {
        return None;
    };
    Some((object_property, string_literal.value.as_str()))
}
