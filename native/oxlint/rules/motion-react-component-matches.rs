const MOTION_REACT_COMPONENT_MODULE_SOURCES: [&str; 3] =
    ["framer-motion", "motion/react", "motion/react-client"];

fn motion_react_component_matches<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    component_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    match element_name {
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                motion_component_symbol_matches_import(
                    symbol_id,
                    component_name,
                    false,
                    ctx,
                    &mut Vec::new(),
                )
            }),
        oxc_ast::ast::JSXElementName::MemberExpression(member_expression)
            if member_expression.property.name == component_name =>
        {
            let oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| {
                    motion_component_symbol_matches_import(
                        symbol_id,
                        component_name,
                        true,
                        ctx,
                        &mut Vec::new(),
                    )
                })
        }
        _ => false,
    }
}

fn motion_component_symbol_matches_import<'a>(
    symbol_id: oxc_semantic::SymbolId,
    component_name: &str,
    requires_namespace: bool,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    if ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && MOTION_REACT_COMPONENT_MODULE_SOURCES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && match &entry.import_name {
                crate::module_record::ImportImportName::NamespaceObject => requires_namespace,
                crate::module_record::ImportImportName::Name(imported_name) => {
                    !requires_namespace && imported_name.name() == component_name
                }
                crate::module_record::ImportImportName::Default(_) => false,
            }
    }) {
        return true;
    }
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
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(oxc_ast::ast::Expression::Identifier(identifier)) = declarator
        .init
        .as_ref()
        .map(oxc_ast::ast::Expression::get_inner_expression)
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some_and(|aliased_symbol_id| {
            motion_component_symbol_matches_import(
                aliased_symbol_id,
                component_name,
                requires_namespace,
                ctx,
                visited_symbol_ids,
            )
        })
}
