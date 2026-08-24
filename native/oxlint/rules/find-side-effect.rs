fn find_side_effect(
    handler_function_node_id: oxc_semantic::NodeId,
    handler_body_span: oxc_span::Span,
    ctx: &crate::context::LintContext<'_>,
) -> Option<String> {
    use oxc_ast::AstKind;
    use rustc_hash::FxHashSet;

    let mut locally_scoped_safe_bindings = FxHashSet::default();
    let mut locally_scoped_cookie_bindings = FxHashSet::default();

    for candidate in ctx.nodes().iter() {
        if !handler_body_span.contains_inclusive(oxc_span::GetSpan::span(&candidate.kind()))
            || nearest_side_effect_function_node_id(candidate, ctx)
                != Some(handler_function_node_id)
        {
            continue;
        }
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            continue;
        };
        let Some(initializer) = &declarator.init else {
            continue;
        };
        if is_safe_mutable_receiver_source(initializer) {
            collect_binding_pattern_names(&declarator.id, &mut locally_scoped_safe_bindings);
        }
        if is_cookies_or_awaited_cookies_call(initializer) {
            collect_binding_pattern_names(&declarator.id, &mut locally_scoped_cookie_bindings);
        }
    }

    for candidate in ctx.nodes().iter() {
        if !handler_body_span.contains_inclusive(oxc_span::GetSpan::span(&candidate.kind())) {
            continue;
        }
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            if let Some(method) = mutating_fetch_method(call_expression) {
                return Some(format!("fetch() with method {method}"));
            }
            continue;
        };
        let Some(method_name) = member_expression_identifier_property_name(member_expression)
        else {
            continue;
        };
        let receiver = member_expression.object().get_inner_expression();
        if matches!(method_name, "set" | "append" | "delete")
            && is_cookie_receiver(receiver, &locally_scoped_cookie_bindings)
        {
            return Some(format!("cookies().{method_name}()"));
        }
        if !matches!(
            method_name,
            "create"
                | "insert"
                | "insertInto"
                | "update"
                | "upsert"
                | "delete"
                | "remove"
                | "destroy"
                | "set"
                | "append"
        ) || is_safe_receiver_chain(receiver, &locally_scoped_safe_bindings)
        {
            continue;
        }
        let receiver_name = match receiver {
            oxc_ast::ast::Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        };
        return Some(match receiver_name {
            Some(receiver_name) => format!("{receiver_name}.{method_name}()"),
            None => format!(".{method_name}()"),
        });
    }

    None
}

fn nearest_side_effect_function_node_id(
    node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    use oxc_ast::AstKind;

    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn mutating_fetch_method<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a str> {
    use oxc_ast::ast::{Expression, ObjectPropertyKind};

    if !matches!(
        &call_expression.callee,
        Expression::Identifier(identifier) if identifier.name == "fetch"
    ) {
        return None;
    }
    let Some(Expression::ObjectExpression(options)) = call_expression
        .arguments
        .get(1)
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return None;
    };
    options.properties.iter().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if property_key_identifier_name(&property.key) != Some("method") {
            return None;
        }
        let Expression::StringLiteral(method) = &property.value else {
            return None;
        };
        matches!(
            method.value.to_ascii_uppercase().as_str(),
            "POST" | "PUT" | "DELETE" | "PATCH"
        )
        .then_some(method.value.as_str())
    })
}

fn is_cookie_receiver(
    receiver: &oxc_ast::ast::Expression<'_>,
    locally_scoped_cookie_bindings: &rustc_hash::FxHashSet<String>,
) -> bool {
    is_cookies_or_awaited_cookies_call(receiver)
        || matches!(
            receiver,
            oxc_ast::ast::Expression::Identifier(identifier)
                if locally_scoped_cookie_bindings.contains(identifier.name.as_str())
        )
}

fn is_cookies_or_awaited_cookies_call(expression: &oxc_ast::ast::Expression<'_>) -> bool {
    use oxc_ast::ast::Expression;

    if is_named_call(expression, "cookies") {
        return true;
    }
    matches!(
        expression,
        Expression::AwaitExpression(await_expression)
            if is_named_call(&await_expression.argument, "cookies")
    )
}

fn is_named_call(expression: &oxc_ast::ast::Expression<'_>, name: &str) -> bool {
    matches!(
        expression,
        oxc_ast::ast::Expression::CallExpression(call_expression)
            if matches!(
                &call_expression.callee,
                oxc_ast::ast::Expression::Identifier(identifier) if identifier.name == name
            )
    )
}

fn is_safe_mutable_receiver_source(expression: &oxc_ast::ast::Expression<'_>) -> bool {
    let expression = match expression {
        oxc_ast::ast::Expression::AwaitExpression(await_expression) => &await_expression.argument,
        expression => expression,
    };
    is_safe_receiver_chain_node(expression, &rustc_hash::FxHashSet::default())
}

fn is_safe_receiver_chain(
    mut expression: &oxc_ast::ast::Expression<'_>,
    locally_scoped_safe_bindings: &rustc_hash::FxHashSet<String>,
) -> bool {
    use oxc_ast::ast::Expression;

    loop {
        expression = expression.get_inner_expression();
        if is_safe_receiver_chain_node(expression, locally_scoped_safe_bindings) {
            return true;
        }
        if let Some(member_expression) = expression.as_member_expression() {
            expression = member_expression.object();
            continue;
        }
        if let Expression::AwaitExpression(await_expression) = expression {
            expression = &await_expression.argument;
            continue;
        }
        return false;
    }
}

fn is_safe_receiver_chain_node(
    expression: &oxc_ast::ast::Expression<'_>,
    locally_scoped_safe_bindings: &rustc_hash::FxHashSet<String>,
) -> bool {
    use oxc_ast::ast::Expression;

    match expression {
        Expression::NewExpression(new_expression) => matches!(
            &new_expression.callee,
            Expression::Identifier(identifier)
                if matches!(
                    identifier.name.as_str(),
                    "Map"
                        | "Set"
                        | "WeakMap"
                        | "WeakSet"
                        | "Headers"
                        | "URLSearchParams"
                        | "FormData"
                        | "Response"
                        | "NextResponse"
                )
        ),
        Expression::CallExpression(call_expression) => {
            is_response_factory_call(call_expression)
                || is_named_call(expression, "headers")
                || is_crypto_builder_call(call_expression)
        }
        Expression::Identifier(identifier) => {
            locally_scoped_safe_bindings.contains(identifier.name.as_str())
        }
        expression => expression
            .as_member_expression()
            .and_then(member_expression_identifier_property_name)
            .is_some_and(|property_name| matches!(property_name, "headers" | "searchParams")),
    }
}

fn is_response_factory_call(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    use oxc_ast::ast::Expression;

    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    matches!(
        member_expression.object(),
        Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "Response" | "NextResponse")
    ) && member_expression_identifier_property_name(member_expression).is_some_and(|method_name| {
        matches!(
            method_name,
            "json" | "redirect" | "next" | "rewrite" | "error"
        )
    })
}

fn is_crypto_builder_call(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    use oxc_ast::ast::Expression;

    let method_name = match &call_expression.callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(member_expression_identifier_property_name),
    };
    method_name.is_some_and(|method_name| {
        matches!(
            method_name,
            "createHash"
                | "createHmac"
                | "createSign"
                | "createVerify"
                | "createCipheriv"
                | "createDecipheriv"
        )
    })
}
