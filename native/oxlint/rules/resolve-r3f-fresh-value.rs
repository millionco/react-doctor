fn resolve_r3f_fresh_value<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    accepted_kinds: &[&str],
) -> Option<&'static str> {
    resolve_r3f_fresh_value_inner(
        expression,
        ctx,
        accepted_kinds,
        &mut rustc_hash::FxHashSet::default(),
    )
}

fn resolve_r3f_fresh_value_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    accepted_kinds: &[&str],
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> Option<&'static str> {
    let expression = expression.get_inner_expression();
    match expression {
        oxc_ast::ast::Expression::ObjectExpression(_) => {
            r3f_accepted_fresh_kind("object", accepted_kinds)
        }
        oxc_ast::ast::Expression::ArrayExpression(_) => {
            r3f_accepted_fresh_kind("array", accepted_kinds)
        }
        oxc_ast::ast::Expression::ArrowFunctionExpression(_)
        | oxc_ast::ast::Expression::FunctionExpression(_) => {
            r3f_accepted_fresh_kind("function", accepted_kinds)
        }
        oxc_ast::ast::Expression::JSXElement(_) | oxc_ast::ast::Expression::JSXFragment(_) => {
            r3f_accepted_fresh_kind("JSX", accepted_kinds)
        }
        oxc_ast::ast::Expression::NewExpression(_) => {
            r3f_accepted_fresh_kind("instance", accepted_kinds)
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if ctx
                .scoping()
                .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
                .is_top()
                || !visited_symbol_ids.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let oxc_ast::AstKind::VariableDeclaration(variable_declaration) =
                ctx.nodes().parent_node(declaration.id()).kind()
            else {
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
            resolve_r3f_fresh_value_inner(
                declarator.init.as_ref()?,
                ctx,
                accepted_kinds,
                visited_symbol_ids,
            )
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            resolve_r3f_fresh_value_inner(
                &conditional_expression.consequent,
                ctx,
                accepted_kinds,
                &mut visited_symbol_ids.clone(),
            )
            .or_else(|| {
                resolve_r3f_fresh_value_inner(
                    &conditional_expression.alternate,
                    ctx,
                    accepted_kinds,
                    &mut visited_symbol_ids.clone(),
                )
            })
        }
        oxc_ast::ast::Expression::LogicalExpression(logical_expression) => {
            resolve_r3f_fresh_value_inner(
                &logical_expression.left,
                ctx,
                accepted_kinds,
                &mut visited_symbol_ids.clone(),
            )
            .or_else(|| {
                resolve_r3f_fresh_value_inner(
                    &logical_expression.right,
                    ctx,
                    accepted_kinds,
                    &mut visited_symbol_ids.clone(),
                )
            })
        }
        oxc_ast::ast::Expression::CallExpression(call_expression) => {
            let member_expression = call_expression.callee.as_member_expression()?;
            let method_name = member_expression.static_property_name()?;
            if method_name == "create"
                && !call_expression.arguments.is_empty()
                && matches!(
                    member_expression.object().get_inner_expression(),
                    oxc_ast::ast::Expression::Identifier(identifier)
                        if identifier.name == "Object"
                            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
                )
            {
                return r3f_accepted_fresh_kind("object", accepted_kinds);
            }
            if method_name == "clone" {
                return r3f_accepted_fresh_kind("clone", accepted_kinds);
            }
            (method_name == "add")
                .then(|| {
                    resolve_r3f_fresh_value_inner(
                        member_expression.object(),
                        ctx,
                        accepted_kinds,
                        visited_symbol_ids,
                    )
                })
                .flatten()
        }
        _ => None,
    }
}

fn r3f_accepted_fresh_kind(
    fresh_kind: &'static str,
    accepted_kinds: &[&str],
) -> Option<&'static str> {
    (accepted_kinds.is_empty() || accepted_kinds.contains(&fresh_kind)).then_some(fresh_kind)
}
