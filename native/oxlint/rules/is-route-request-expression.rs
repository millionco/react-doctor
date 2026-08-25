fn is_route_request_expression<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    route_function: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    use oxc_ast::ast::{BindingPattern, Expression};

    let Some(parameters) = react_router_route_function_parameters(route_function) else {
        return false;
    };
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            parameters.items.iter().any(|parameter| {
                let BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
                    return false;
                };
                pattern.properties.iter().any(|property| {
                    property.key.static_name().as_deref() == Some("request")
                        && binding_pattern_has_symbol(&property.value, symbol_id)
                })
            })
        }
        expression => {
            let Some(member_expression) = expression.as_member_expression() else {
                return false;
            };
            if member_expression.static_property_name() != Some("request") {
                return false;
            }
            let Expression::Identifier(identifier) = member_expression.object().get_inner_expression()
            else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            parameters
                .items
                .iter()
                .any(|parameter| binding_pattern_has_symbol(&parameter.pattern, symbol_id))
        }
    }
}

fn react_router_route_function_parameters<'a, 'b>(
    route_function: &'b crate::AstNode<'a>,
) -> Option<&'b oxc_ast::ast::FormalParameters<'a>> {
    match route_function.kind() {
        oxc_ast::AstKind::Function(function) => Some(function.params.as_ref()),
        oxc_ast::AstKind::ArrowFunctionExpression(function) => Some(function.params.as_ref()),
        _ => None,
    }
}
