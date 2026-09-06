fn has_active_route_property<'a>(
    route_object: &'a oxc_ast::ast::ObjectExpression<'a>,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    get_static_route_property(route_object, property_name)
        .is_some_and(|property| !is_definitely_falsy_expression(&property.value, ctx))
}
