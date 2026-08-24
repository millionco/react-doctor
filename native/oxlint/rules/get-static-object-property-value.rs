fn get_static_object_property_value<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    expected_property_name: &str,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let oxc_ast::ast::Expression::ObjectExpression(object_expression) =
        expression.get_inner_expression()
    else {
        return None;
    };
    let mut property_value = None;
    for property in &object_expression.properties {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            property_value = None;
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            property_value = None;
            continue;
        };
        if property_name != expected_property_name {
            continue;
        }
        property_value =
            (property.kind == oxc_ast::ast::PropertyKind::Init).then_some(&property.value);
    }
    property_value
}
