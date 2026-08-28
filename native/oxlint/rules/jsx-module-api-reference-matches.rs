fn jsx_module_api_reference_matches<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    api_name: &str,
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    match element_name {
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
            jsx_module_api_identifier_matches(
                identifier,
                api_name,
                module_sources,
                analysis,
                ctx,
                &mut Vec::new(),
            )
        }
        oxc_ast::ast::JSXElementName::MemberExpression(member_expression) => {
            if member_expression.property.name != api_name {
                return false;
            }
            let oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            module_namespace_identifier_matches(identifier, module_sources, ctx, &mut Vec::new())
                || type_import_module_namespace_identifier_matches(
                    identifier,
                    module_sources,
                    ctx,
                    &mut Vec::new(),
                )
        }
        _ => false,
    }
}

fn jsx_module_api_identifier_matches<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    api_name: &str,
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let oxc_ast::AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return false;
        };
        let oxc_ast::ast::TSTypeName::IdentifierReference(namespace_identifier) =
            &qualified_name.left
        else {
            return false;
        };
        let Some(namespace_symbol_id) =
            identifier_symbol_id_with_lexical_fallback(namespace_identifier, ctx)
        else {
            return false;
        };
        return qualified_name.right.name == api_name
            && (module_namespace_identifier_matches(
                namespace_identifier,
                module_sources,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) || type_import_module_namespace_identifier_matches(
                namespace_identifier,
                module_sources,
                ctx,
                &mut visited_symbol_ids.clone(),
            ))
            && !has_possible_static_property_write_for_symbol_before(
                namespace_symbol_id,
                api_name,
                declaration,
                analysis,
                ctx,
            );
    }
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
                module_api_reference_matches(initializer, api_name, module_sources, analysis, ctx)
                    || type_import_module_api_reference_matches(
                        initializer,
                        api_name,
                        module_sources,
                        analysis,
                        ctx,
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
        let runtime_namespace_matches =
            module_api_path_matches(initializer, &[], module_sources, false, ctx);
        let type_namespace_matches = match initializer.get_inner_expression() {
            oxc_ast::ast::Expression::Identifier(namespace_identifier) => {
                type_import_module_namespace_identifier_matches(
                    namespace_identifier,
                    module_sources,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                )
            }
            _ => false,
        };
        if !runtime_namespace_matches && !type_namespace_matches {
            return false;
        }
        let oxc_ast::ast::Expression::Identifier(namespace_identifier) =
            initializer.get_inner_expression()
        else {
            return true;
        };
        let Some(namespace_symbol_id) =
            identifier_symbol_id_with_lexical_fallback(namespace_identifier, ctx)
        else {
            return true;
        };
        return !has_possible_static_property_write_for_symbol_before(
            namespace_symbol_id,
            api_name,
            declaration,
            analysis,
            ctx,
        );
    }
    ctx.module_record().import_entries.iter().any(|entry| {
        module_source_matches(entry.module_request.name(), module_sources)
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
