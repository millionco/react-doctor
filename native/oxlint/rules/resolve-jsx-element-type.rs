fn resolve_jsx_element_type<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<(&'a str, oxc_span::Span)> {
    match &opening_element.name {
        oxc_ast::ast::JSXElementName::Identifier(identifier) => {
            Some((identifier.name.as_str(), identifier.span))
        }
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            let Some(symbol_id) = reference.symbol_id() else {
                return Some((identifier.name.as_str(), identifier.span));
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return Some((identifier.name.as_str(), identifier.span));
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
                return Some((identifier.name.as_str(), identifier.span));
            };
            if !variable_declaration.kind.is_const()
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
            {
                return Some((identifier.name.as_str(), identifier.span));
            }
            let Some(oxc_ast::ast::Expression::StringLiteral(string_literal)) = declarator
                .init
                .as_ref()
                .map(oxc_ast::ast::Expression::get_inner_expression)
            else {
                return Some((identifier.name.as_str(), identifier.span));
            };
            Some((string_literal.value.as_str(), identifier.span))
        }
        _ => None,
    }
}
