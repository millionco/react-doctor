fn type_import_module_api_reference_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    api_name: &str,
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    type_import_module_api_reference_matches_inner(
        expression,
        api_name,
        module_sources,
        analysis,
        ctx,
        &mut Vec::new(),
    )
}

fn type_import_module_api_reference_matches_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    api_name: &str,
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        if member_expression.static_property_name() != Some(api_name) {
            return false;
        }
        let oxc_ast::ast::Expression::Identifier(namespace_identifier) =
            member_expression.object().get_inner_expression()
        else {
            return false;
        };
        let member_node = ctx.nodes().get_node(expression.node_id());
        return type_import_module_namespace_identifier_matches(
            namespace_identifier,
            module_sources,
            ctx,
            &mut visited_symbol_ids.clone(),
        ) && !has_possible_static_property_write_before(
            namespace_identifier,
            api_name,
            member_node,
            analysis,
            ctx,
        );
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return false;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            return declarator.init.as_ref().is_some_and(|initializer| {
                type_import_module_api_reference_matches_inner(
                    initializer,
                    api_name,
                    module_sources,
                    analysis,
                    ctx,
                    visited_symbol_ids,
                )
            });
        }
        let Some((destructured_name, initializer)) =
            destructured_binding_provenance(&declarator.id, symbol_id, declarator.init.as_ref())
        else {
            return false;
        };
        if destructured_name != api_name {
            return false;
        }
        let oxc_ast::ast::Expression::Identifier(namespace_identifier) =
            initializer.get_inner_expression()
        else {
            return false;
        };
        return type_import_module_namespace_identifier_matches(
            namespace_identifier,
            module_sources,
            ctx,
            &mut visited_symbol_ids.clone(),
        ) && !has_possible_static_property_write_before(
            namespace_identifier,
            api_name,
            declaration,
            analysis,
            ctx,
        );
    }
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.is_type
            && module_source_matches(entry.module_request.name(), module_sources)
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

fn type_import_module_namespace_identifier_matches<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    module_sources: &[&str],
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return false;
        }
        let Some(oxc_ast::ast::Expression::Identifier(next_identifier)) =
            declarator.init.as_ref().map(|initializer| initializer.get_inner_expression())
        else {
            return false;
        };
        return type_import_module_namespace_identifier_matches(
            next_identifier,
            module_sources,
            ctx,
            visited_symbol_ids,
        );
    }
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.is_type
            && module_source_matches(entry.module_request.name(), module_sources)
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
    })
}
