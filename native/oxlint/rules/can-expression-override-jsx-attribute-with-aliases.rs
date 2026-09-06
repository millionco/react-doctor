fn can_expression_override_jsx_attribute_with_aliases<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    target_name: &str,
    is_case_sensitive: bool,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    can_expression_override_jsx_attribute_with_aliases_internal(
        expression,
        target_name,
        is_case_sensitive,
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    )
}

fn can_expression_override_jsx_attribute_with_aliases_internal<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    target_name: &str,
    is_case_sensitive: bool,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return true;
        };
        if visited_symbol_ids.contains(&symbol_id)
            || !can_expression_override_static_spread_symbol(symbol_id, ctx)
        {
            return true;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return true;
        };
        let Some(initializer) = declarator.init.as_ref() else {
            return true;
        };
        visited_symbol_ids.insert(symbol_id);
        let can_override = can_expression_override_jsx_attribute_with_aliases_internal(
            initializer,
            target_name,
            is_case_sensitive,
            ctx,
            visited_symbol_ids,
        );
        visited_symbol_ids.remove(&symbol_id);
        return can_override;
    }
    let oxc_ast::ast::Expression::ObjectExpression(object_expression) = expression else {
        return true;
    };
    object_expression
        .properties
        .iter()
        .any(|property| match property {
            oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread) => {
                can_expression_override_jsx_attribute_with_aliases_internal(
                    &spread.argument,
                    target_name,
                    is_case_sensitive,
                    ctx,
                    visited_symbol_ids,
                )
            }
            oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
                property.key.static_name().is_none_or(|property_name| {
                    if is_case_sensitive {
                        property_name == target_name
                    } else {
                        property_name.eq_ignore_ascii_case(target_name)
                    }
                })
            }
        })
}

fn can_expression_override_static_spread_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .all(|reference| {
            reference.is_read()
                && !reference.is_write()
                && can_expression_override_is_static_spread_reference(reference.node_id(), ctx)
        })
}

fn can_expression_override_is_static_spread_reference(
    reference_node_id: oxc_syntax::node::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let reference_node = ctx.nodes().get_node(reference_node_id);
    let reference_span = oxc_span::GetSpan::span(reference_node);
    match ctx.nodes().parent_node(reference_node.id()).kind() {
        oxc_ast::AstKind::JSXSpreadAttribute(spread) => {
            oxc_span::GetSpan::span(&spread.argument) == reference_span
        }
        oxc_ast::AstKind::SpreadElement(spread) => {
            oxc_span::GetSpan::span(&spread.argument) == reference_span
        }
        oxc_ast::AstKind::VariableDeclarator(declarator) => declarator
            .init
            .as_ref()
            .is_some_and(|initializer| oxc_span::GetSpan::span(initializer) == reference_span),
        _ => false,
    }
}
