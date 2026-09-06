fn is_react_hook_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    hook_names: &[&str],
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if hook_names
        .iter()
        .any(|hook_name| is_react_api_call(call_expression, hook_name, ctx))
    {
        return true;
    }
    is_react_hook_callee(
        &call_expression.callee,
        hook_names,
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    )
}

fn is_react_hook_callee<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    hook_names: &[&str],
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::Identifier(identifier) => {
            if hook_names.iter().any(|hook_name| {
                is_named_react_api_import(identifier, hook_name, ctx)
                    || is_destructured_react_api_binding(identifier, hook_name, ctx)
            }) {
                return true;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return hook_names.contains(&identifier.name.as_str());
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
                return false;
            };
            variable_declaration.kind.is_const()
                && declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    is_react_hook_callee(initializer, hook_names, ctx, visited_symbol_ids)
                })
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            let mut consequent_visited_symbol_ids = visited_symbol_ids.clone();
            let mut alternate_visited_symbol_ids = visited_symbol_ids.clone();
            is_react_hook_callee(
                &conditional_expression.consequent,
                hook_names,
                ctx,
                &mut consequent_visited_symbol_ids,
            ) && is_react_hook_callee(
                &conditional_expression.alternate,
                hook_names,
                ctx,
                &mut alternate_visited_symbol_ids,
            )
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression
                    .static_property_name()
                    .is_some_and(|property_name| hook_names.contains(&property_name))
                    && is_react_namespace_receiver(
                        member_expression.object().get_inner_expression(),
                        ctx,
                    )
            }),
    }
}
