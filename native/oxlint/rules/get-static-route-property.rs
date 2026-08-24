fn get_static_route_property<'a>(
    route_object: &'a oxc_ast::ast::ObjectExpression<'a>,
    property_name: &str,
) -> Option<&'a oxc_ast::ast::ObjectProperty<'a>> {
    route_object.properties.iter().find_map(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(object_property) = property else {
            return None;
        };
        (object_property.key.static_name().as_deref() == Some(property_name))
            .then_some(object_property.as_ref())
    })
}
