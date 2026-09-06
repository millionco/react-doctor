const REACT_ROUTER_SESSION_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];
const REACT_ROUTER_SESSION_STORAGE_FACTORY_NAMES: [&str; 5] = [
    "createCookieSessionStorage",
    "createFileSessionStorage",
    "createMemorySessionStorage",
    "createSessionStorage",
    "createWorkersKVSessionStorage",
];

fn is_react_router_session_method(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    expected_method_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    if !pattern.properties.iter().any(|property| {
        property.key.static_name().as_deref() == Some(expected_method_name)
            && binding_pattern_has_symbol(&property.value, symbol_id)
    }) {
        return false;
    }
    let Some(oxc_ast::ast::Expression::CallExpression(factory_call)) = &declarator.init else {
        return false;
    };
    let oxc_ast::ast::Expression::Identifier(factory_callee) =
        factory_call.callee.get_inner_expression()
    else {
        return false;
    };
    direct_named_import_matches(
        factory_callee,
        &REACT_ROUTER_SESSION_STORAGE_FACTORY_NAMES,
        &REACT_ROUTER_SESSION_RUNTIME_PACKAGE_NAMES,
        ctx,
    )
}

fn is_react_router_session_method_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    session_symbol_id: oxc_semantic::SymbolId,
    expected_method_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let oxc_ast::ast::Expression::Identifier(callee) = &call_expression.callee else {
        return false;
    };
    let Some(oxc_ast::ast::Expression::Identifier(session_argument)) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(session_argument.reference_id())
        .symbol_id()
        == Some(session_symbol_id)
        && is_react_router_session_method(callee, expected_method_name, ctx)
}
