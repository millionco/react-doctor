const REACT_RUNTIME_MODULE_SOURCES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];

fn is_react_api_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = callee {
        return is_named_react_api_import(identifier, api_name, ctx)
            || is_destructured_react_api_binding(identifier, api_name, ctx);
    }
    let Some(member_expression) = callee.as_member_expression() else {
        return false;
    };
    member_expression.static_property_name() == Some(api_name)
        && is_react_namespace_receiver(member_expression.object().get_inner_expression(), ctx)
}

fn is_named_react_api_import<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    api_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(symbol_id) = resolve_const_identifier_alias(identifier, ctx) else {
        return false;
    };
    matching_react_import(symbol_id, ctx).is_some_and(|entry| {
        matches!(
            &entry.import_name,
            crate::module_record::ImportImportName::Name(imported_name)
                if imported_name.name() == api_name
        )
    })
}

fn is_react_namespace_receiver<'a>(
    receiver: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let oxc_ast::ast::Expression::Identifier(identifier) = receiver else {
        return false;
    };
    if let Some(symbol_id) = resolve_const_identifier_alias(identifier, ctx)
        && let Some(entry) = matching_react_import(symbol_id, ctx)
    {
        return matches!(
            &entry.import_name,
            crate::module_record::ImportImportName::Default(_)
                | crate::module_record::ImportImportName::NamespaceObject
        ) || matches!(
            &entry.import_name,
            crate::module_record::ImportImportName::Name(imported_name)
                if imported_name.name() == "default"
        );
    }
    identifier.name == "React"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn is_destructured_react_api_binding<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    api_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    if !variable_declaration.kind.is_const() {
        return false;
    }
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    let has_matching_property = pattern.properties.iter().any(|property| {
        if property.computed || !property_key_matches_name(&property.key, api_name) {
            return false;
        }
        matches!(
            &property.value,
            oxc_ast::ast::BindingPattern::BindingIdentifier(binding_identifier)
                if binding_identifier.symbol_id() == symbol_id
        )
    });
    has_matching_property
        && declarator.init.as_ref().is_some_and(|initializer| {
            is_react_namespace_receiver(initializer.get_inner_expression(), ctx)
        })
}

fn resolve_const_identifier_alias<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let mut visited_symbol_ids = Vec::new();
    loop {
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_id);
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
            return Some(symbol_id);
        };
        if !variable_declaration.kind.is_const()
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
        {
            return None;
        }
        let Some(oxc_ast::ast::Expression::Identifier(next_identifier)) =
            declarator.init.as_ref().map(|initializer| initializer.get_inner_expression())
        else {
            return Some(symbol_id);
        };
        symbol_id = ctx
            .scoping()
            .get_reference(next_identifier.reference_id())
            .symbol_id()?;
    }
}

fn matching_react_import<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &'a crate::context::LintContext<'_>,
) -> Option<&'a crate::module_record::ImportEntry> {
    ctx.module_record().import_entries.iter().find(|entry| {
        REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
            && ctx.scoping().get_root_binding(entry.local_name.name().into()) == Some(symbol_id)
    })
}
