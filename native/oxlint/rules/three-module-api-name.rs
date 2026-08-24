fn three_module_api_name<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<String> {
    three_module_api_name_internal(expression, ctx, &mut Vec::new())
}

fn three_module_api_name_internal<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        let api_name = member_expression.static_property_name()?;
        return three_module_api_path_matches(member_expression.object(), &[], ctx)
            .then(|| api_name.to_string());
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
    if let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() {
        let parent = ctx.nodes().parent_node(declaration.id());
        if !matches!(
            parent.kind(),
            oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return None;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        {
            return three_module_api_name_internal(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            );
        }
        let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
            return None;
        };
        let property_name = pattern.properties.iter().find_map(|property| {
            matches!(
                &property.value,
                oxc_ast::ast::BindingPattern::BindingIdentifier(binding_identifier)
                    if binding_identifier.symbol_id() == symbol_id
            )
            .then(|| property.key.static_name().map(|name| name.to_string()))
            .flatten()
        })?;
        return declarator
            .init
            .as_ref()
            .is_some_and(|initializer| three_module_api_path_matches(initializer, &[], ctx))
            .then_some(property_name);
    }
    ctx.module_record().import_entries.iter().find_map(|entry| {
        let module_source = entry.module_request.name();
        if entry.is_type
            || !(THREE_MODULE_SOURCES.contains(&module_source)
                || THREE_MODULE_SOURCES.iter().any(|module_source_prefix| {
                    module_source_prefix.ends_with('/')
                        && module_source.starts_with(module_source_prefix)
                }))
            || ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                != Some(symbol_id)
        {
            return None;
        }
        let crate::module_record::ImportImportName::Name(imported_name) = &entry.import_name else {
            return None;
        };
        Some(imported_name.name().to_string())
    })
}
