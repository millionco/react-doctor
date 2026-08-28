const R3F_ANALYZED_CALLBACK_REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];

fn resolve_r3f_analyzed_callback_function_id<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    if let Some(function_id) = exact_local_function_id_including_generators(
        expression,
        ctx,
        &mut Vec::new(),
        resolution_cache,
    )
    {
        return Some(function_id);
    }
    let wrapper_call = r3f_analyzed_callback_wrapper_call(expression, ctx, &mut Vec::new())?;
    if !r3f_analyzed_react_use_callback_matches(wrapper_call, analysis, ctx) {
        return None;
    }
    exact_local_function_id_including_generators(
        wrapper_call.arguments.first()?.as_expression()?,
        ctx,
        &mut Vec::new(),
        resolution_cache,
    )
}

fn r3f_analyzed_callback_wrapper_call<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::CallExpression(call_expression) = expression {
        return Some(call_expression);
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    r3f_analyzed_callback_wrapper_call(declarator.init.as_ref()?, ctx, visited_symbol_ids)
}

fn r3f_analyzed_react_use_callback_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let direct_match = if call_expression.callee.as_member_expression().is_some() {
        is_react_api_call(call_expression, "useCallback", ctx)
            && !r3f_analyzed_is_global_react_namespace_call(call_expression, ctx)
    } else {
        let oxc_ast::ast::Expression::Identifier(identifier) =
            call_expression.callee.get_inner_expression()
        else {
            return module_api_reference_matches(
                &call_expression.callee,
                "useCallback",
                &R3F_ANALYZED_CALLBACK_REACT_RUNTIME_MODULES,
                analysis,
                ctx,
            );
        };
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
        symbol_id.is_some_and(|symbol_id| {
            ctx.module_record().import_entries.iter().any(|entry| {
                !entry.is_type
                    && R3F_ANALYZED_CALLBACK_REACT_RUNTIME_MODULES
                        .contains(&entry.module_request.name())
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
                    && matches!(
                        &entry.import_name,
                        crate::module_record::ImportImportName::Name(imported_name)
                            if imported_name.name() == "useCallback"
                    )
            })
        })
    };
    direct_match
        || module_api_reference_matches(
            &call_expression.callee,
            "useCallback",
            &R3F_ANALYZED_CALLBACK_REACT_RUNTIME_MODULES,
            analysis,
            ctx,
        )
        || type_import_module_api_reference_matches(
            &call_expression.callee,
            "useCallback",
            &R3F_ANALYZED_CALLBACK_REACT_RUNTIME_MODULES,
            analysis,
            ctx,
        )
}

fn r3f_analyzed_is_global_react_namespace_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    r3f_analyzed_is_global_identifier(member_expression.object(), "React", ctx)
}

fn r3f_analyzed_is_global_identifier(
    expression: &oxc_ast::ast::Expression<'_>,
    identifier_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        oxc_ast::ast::Expression::Identifier(identifier)
            if identifier.name == identifier_name
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}
