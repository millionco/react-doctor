fn get_inline_style_object_expression_with_aliases<'a: 'b, 'b>(
    attribute: &'b oxc_ast::ast::JSXAttribute<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'b oxc_ast::ast::ObjectExpression<'a>> {
    let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return None;
    };
    if attribute_name.name != "style" {
        return None;
    }
    let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
    else {
        return None;
    };
    let expression = container.expression.as_expression()?;
    resolve_inline_style_object_expression_with_aliases(expression, ctx, &mut Vec::new())
}

fn resolve_inline_style_object_expression_with_aliases<'a: 'b, 'b>(
    expression: &'b oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'b oxc_ast::ast::ObjectExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::ObjectExpression(object_expression) = expression {
        return Some(object_expression);
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id)
        || inline_style_object_binding_is_mutated(symbol_id, ctx)
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return None;
    };
    if !variable_declaration.kind.is_const() {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let result = declarator.init.as_ref().and_then(|initializer| {
        resolve_inline_style_object_expression_with_aliases(initializer, ctx, visited_symbol_ids)
    });
    visited_symbol_ids.pop();
    result
}

fn inline_style_object_binding_is_mutated(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_span::GetSpan;

    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            if reference.is_write() {
                return true;
            }
            let mut reference_node = ctx.nodes().get_node(reference.node_id());
            loop {
                let parent = ctx.nodes().parent_node(reference_node.id());
                let is_object = match parent.kind() {
                    oxc_ast::AstKind::ComputedMemberExpression(member_expression) => {
                        member_expression.object.span() == reference_node.kind().span()
                    }
                    oxc_ast::AstKind::StaticMemberExpression(member_expression) => {
                        member_expression.object.span() == reference_node.kind().span()
                    }
                    oxc_ast::AstKind::PrivateFieldExpression(member_expression) => {
                        member_expression.object.span() == reference_node.kind().span()
                    }
                    _ => false,
                };
                if !is_object {
                    break;
                }
                reference_node = parent;
            }
            let reference_span = reference_node.kind().span();
            match ctx.nodes().parent_node(reference_node.id()).kind() {
                oxc_ast::AstKind::AssignmentExpression(assignment_expression) => {
                    assignment_expression.left.span() == reference_span
                }
                oxc_ast::AstKind::UpdateExpression(update_expression) => {
                    update_expression.argument.span() == reference_span
                }
                oxc_ast::AstKind::UnaryExpression(unary_expression) => {
                    unary_expression.operator == oxc_syntax::operator::UnaryOperator::Delete
                        && unary_expression.argument.span() == reference_span
                }
                oxc_ast::AstKind::CallExpression(call_expression) => call_expression
                    .arguments
                    .iter()
                    .filter_map(oxc_ast::ast::Argument::as_expression)
                    .any(|argument| argument.span() == reference_span),
                _ => false,
            }
        })
}
