struct TanstackServerFnChainInfo<'a> {
    is_server_fn_chain: bool,
    specified_method: Option<&'a str>,
    has_input_validation: bool,
    method_names: Vec<&'a str>,
}

fn walk_tanstack_server_fn_chain<'a>(
    outer_call: &'a oxc_ast::ast::CallExpression<'a>,
) -> TanstackServerFnChainInfo<'a> {
    use oxc_ast::ast::{Expression, ObjectPropertyKind};

    let mut chain_info = TanstackServerFnChainInfo {
        is_server_fn_chain: false,
        specified_method: None,
        has_input_validation: false,
        method_names: Vec::new(),
    };
    let mut current_call = outer_call;

    loop {
        match current_call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => {
                if identifier.name != "createServerFn" {
                    break;
                }
                chain_info.is_server_fn_chain = true;
                let Some(Expression::ObjectExpression(options)) = current_call
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .map(Expression::get_inner_expression)
                else {
                    break;
                };
                for property in &options.properties {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        continue;
                    };
                    if property_key_identifier_name(&property.key) != Some("method") {
                        continue;
                    }
                    if let Expression::StringLiteral(method) = property.value.get_inner_expression()
                    {
                        chain_info.specified_method = Some(method.value.as_str());
                    }
                }
                break;
            }
            expression => {
                let Some(member) = expression.as_member_expression() else {
                    break;
                };
                let Some(method_name) = member_expression_identifier_property_name(member) else {
                    break;
                };
                chain_info.method_names.push(method_name);
                if matches!(method_name, "validator" | "inputValidator") {
                    chain_info.has_input_validation = true;
                }
                let Expression::CallExpression(previous_call) =
                    member.object().get_inner_expression()
                else {
                    break;
                };
                current_call = previous_call;
            }
        }
    }

    chain_info.method_names.reverse();
    chain_info
}
