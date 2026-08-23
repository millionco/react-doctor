fn resolve_local_react_callback<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<(bool, oxc_span::Span)> {
    resolve_local_react_callback_internal(expression, ctx, &mut Vec::new())
}

fn resolve_local_react_callback_internal<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<(bool, oxc_span::Span)> {
    use oxc_span::GetSpan;

    let expression = expression.get_inner_expression();
    match expression {
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => {
            return Some((function.r#async, function.span));
        }
        oxc_ast::ast::Expression::FunctionExpression(function) => {
            return Some((function.r#async, function.span));
        }
        oxc_ast::ast::Expression::CallExpression(call_expression)
            if module_api_path_matches(
                &call_expression.callee,
                &["useCallback"],
                &[
                    "react",
                    "react-dom",
                    "preact/compat",
                    "preact/hooks",
                    "@wordpress/element",
                ],
                true,
                ctx,
            ) =>
        {
            let callback = call_expression.arguments.first()?.as_expression()?;
            return resolve_local_react_callback_internal(callback, ctx, visited_symbol_ids);
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            if let oxc_ast::AstKind::Function(function) = declaration.kind() {
                return Some((function.r#async, function.span()));
            }
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
                return None;
            };
            if !variable_declaration.kind.is_const()
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
            {
                return None;
            }
            let initializer = declarator.init.as_ref()?;
            return resolve_local_react_callback_internal(initializer, ctx, visited_symbol_ids);
        }
        _ => {}
    }
    None
}
