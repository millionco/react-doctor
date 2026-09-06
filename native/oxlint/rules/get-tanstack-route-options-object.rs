fn get_tanstack_route_options_object<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    const ROUTE_CREATION_FUNCTIONS: [&str; 4] = [
        "createFileRoute",
        "createRoute",
        "createRootRoute",
        "createRootRouteWithContext",
    ];

    let route_creation_call = match &call_expression.callee {
        oxc_ast::ast::Expression::CallExpression(route_creation_call) => route_creation_call,
        oxc_ast::ast::Expression::Identifier(identifier)
            if ROUTE_CREATION_FUNCTIONS.contains(&identifier.name.as_str()) =>
        {
            call_expression
        }
        _ => return None,
    };
    let oxc_ast::ast::Expression::Identifier(route_creation_function) = &route_creation_call.callee
    else {
        return None;
    };
    if !ROUTE_CREATION_FUNCTIONS.contains(&route_creation_function.name.as_str()) {
        return None;
    }
    let oxc_ast::ast::Expression::ObjectExpression(options_object) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)?
    else {
        return None;
    };
    Some(options_object)
}
