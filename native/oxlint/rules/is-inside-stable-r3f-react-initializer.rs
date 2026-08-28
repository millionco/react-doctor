const STABLE_R3F_REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];

fn is_inside_stable_r3f_react_initializer<'a>(
    node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(mut enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    loop {
        let callback_root = transparent_expression_root(enclosing_function, ctx);
        let parent = ctx.nodes().parent_node(callback_root.id());
        if let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind()
            && expression_is_argument_at(
                &call_expression.arguments,
                0,
                oxc_span::GetSpan::span(callback_root),
            )
            && (stable_r3f_react_api_call_matches(call_expression, "useState", analysis, ctx)
                || (stable_r3f_react_api_call_matches(call_expression, "useMemo", analysis, ctx)
                    && call_expression
                        .arguments
                        .get(1)
                        .is_some_and(|argument| !argument.is_spread())))
        {
            return true;
        }
        let Some(outer_function) =
            ctx.nodes()
                .ancestors(enclosing_function.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        oxc_ast::AstKind::Function(_)
                            | oxc_ast::AstKind::ArrowFunctionExpression(_)
                    )
                })
        else {
            return false;
        };
        enclosing_function = outer_function;
    }
}

fn stable_r3f_react_api_call_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    stable_r3f_direct_react_api_call_matches(call_expression, api_name, ctx)
        || module_api_reference_matches(
            &call_expression.callee,
            api_name,
            &STABLE_R3F_REACT_RUNTIME_MODULES,
            analysis,
            ctx,
        )
}

fn stable_r3f_direct_react_api_call_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if callee.as_member_expression().is_some() {
        return is_react_api_call(call_expression, api_name, ctx);
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = callee else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && STABLE_R3F_REACT_RUNTIME_MODULES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == api_name
            )
    })
}
