fn module_api_path_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    expected_path: &[&str],
    module_sources: &[&str],
    allow_default_namespace: bool,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    module_api_path_matches_internal(
        expression,
        expected_path,
        module_sources,
        allow_default_namespace,
        ctx,
        &mut Vec::new(),
    )
}

fn module_api_path_matches_internal<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    expected_path: &[&str],
    module_sources: &[&str],
    allow_default_namespace: bool,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        let Some((expected_property, expected_receiver_path)) = expected_path.split_last() else {
            return false;
        };
        return member_expression.static_property_name() == Some(*expected_property)
            && module_api_path_matches_internal(
                member_expression.object(),
                expected_receiver_path,
                module_sources,
                allow_default_namespace,
                ctx,
                visited_symbol_ids,
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
        let parent = ctx.nodes().parent_node(declaration.id());
        let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
            return false;
        };
        if !variable_declaration.kind.is_const() {
            return false;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        {
            return declarator.init.as_ref().is_some_and(|initializer| {
                module_api_path_matches_internal(
                    initializer,
                    expected_path,
                    module_sources,
                    allow_default_namespace,
                    ctx,
                    visited_symbol_ids,
                )
            });
        }
        if expected_path.len() != 1 {
            return false;
        }
        let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
            return false;
        };
        let has_matching_property = pattern.properties.iter().any(|property| {
            property_key_matches_name(&property.key, expected_path[0])
                && matches!(
                    &property.value,
                    oxc_ast::ast::BindingPattern::BindingIdentifier(binding_identifier)
                        if binding_identifier.symbol_id() == symbol_id
                )
        });
        return has_matching_property
            && declarator.init.as_ref().is_some_and(|initializer| {
                module_api_path_matches_internal(
                    initializer,
                    &[],
                    module_sources,
                    allow_default_namespace,
                    ctx,
                    visited_symbol_ids,
                )
            });
    }
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && module_sources.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && match &entry.import_name {
                crate::module_record::ImportImportName::NamespaceObject => expected_path.is_empty(),
                crate::module_record::ImportImportName::Default(_) => {
                    allow_default_namespace && expected_path.is_empty()
                }
                crate::module_record::ImportImportName::Name(imported_name) => {
                    expected_path == [imported_name.name()]
                        || (allow_default_namespace
                            && expected_path.is_empty()
                            && imported_name.name() == "default")
                }
            }
    })
}
