fn module_api_reference_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    api_name: &str,
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    module_api_reference_matches_internal(
        expression,
        api_name,
        module_sources,
        Some(analysis),
        ctx,
        &mut Vec::new(),
    )
}

fn module_api_reference_might_match<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    api_name: &str,
    module_sources: &[&str],
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    module_api_reference_matches_internal(
        expression,
        api_name,
        module_sources,
        None,
        ctx,
        &mut Vec::new(),
    )
}

fn module_api_reference_matches_internal<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    api_name: &str,
    module_sources: &[&str],
    analysis: Option<&PossibleStaticPropertyWriteAnalysis>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        if member.static_property_name() != Some(api_name)
            || !module_api_path_matches(member.object(), &[], module_sources, false, ctx)
        {
            return false;
        }
        let member_node = ctx.nodes().get_node(expression.node_id());
        let oxc_ast::ast::Expression::Identifier(receiver) = member.object().get_inner_expression()
        else {
            return true;
        };
        return analysis.is_none_or(|analysis| {
            !has_possible_static_property_write_before(
                receiver,
                api_name,
                member_node,
                analysis,
                ctx,
            )
        });
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
        return qualified_name.right.name == api_name
            && module_namespace_identifier_matches(
                namespace_identifier,
                module_sources,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
            && analysis.is_none_or(|analysis| {
                !has_possible_static_property_write_before(
                    namespace_identifier,
                    api_name,
                    declaration,
                    analysis,
                    ctx,
                )
            });
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
                module_api_reference_matches_internal(
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
        if destructured_name != api_name
            || !module_api_path_matches(initializer, &[], module_sources, false, ctx)
        {
            return false;
        }
        let oxc_ast::ast::Expression::Identifier(namespace_identifier) =
            initializer.get_inner_expression()
        else {
            return true;
        };
        return analysis.is_none_or(|analysis| {
            !has_possible_static_property_write_before(
                namespace_identifier,
                api_name,
                declaration,
                analysis,
                ctx,
            )
        });
    }
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
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

fn module_namespace_identifier_matches<'a>(
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
    if let oxc_ast::AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::ExternalModuleReference(reference) =
            &import_equals.module_reference
        else {
            return false;
        };
        return module_source_matches(reference.expression.value.as_str(), module_sources);
    }
    if let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() {
        return matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
            && declarator.init.as_ref().is_some_and(|initializer| {
                if global_require_module_source(initializer, ctx)
                    .is_some_and(|source| module_source_matches(source, module_sources))
                {
                    return true;
                }
                let oxc_ast::ast::Expression::Identifier(next_identifier) =
                    initializer.get_inner_expression()
                else {
                    return false;
                };
                module_namespace_identifier_matches(
                    next_identifier,
                    module_sources,
                    ctx,
                    visited_symbol_ids,
                )
            });
    }
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
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

fn destructured_binding_provenance<'a>(
    pattern: &'a oxc_ast::ast::BindingPattern<'a>,
    symbol_id: oxc_semantic::SymbolId,
    base_initializer: Option<&'a oxc_ast::ast::Expression<'a>>,
) -> Option<(String, &'a oxc_ast::ast::Expression<'a>)> {
    match pattern {
        oxc_ast::ast::BindingPattern::ObjectPattern(object_pattern) => {
            for property in &object_pattern.properties {
                let property_initializer = match &property.value {
                    oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
                        Some(&assignment.right)
                    }
                    _ => base_initializer,
                };
                let is_matching_binding = match &property.value {
                    oxc_ast::ast::BindingPattern::BindingIdentifier(binding) => {
                        binding.symbol_id() == symbol_id
                    }
                    oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => assignment
                        .left
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id),
                    _ => false,
                };
                if is_matching_binding {
                    return Some((
                        property.key.static_name()?.to_string(),
                        property_initializer?,
                    ));
                }
                if let Some(provenance) = destructured_binding_provenance(
                    &property.value,
                    symbol_id,
                    property_initializer,
                ) {
                    return Some(provenance);
                }
            }
            None
        }
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            destructured_binding_provenance(&assignment.left, symbol_id, Some(&assignment.right))
        }
        _ => None,
    }
}
