fn is_import_absent_from_client_bundle(
    declaration: &oxc_ast::ast::ImportDeclaration<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_ast::ast::ImportDeclarationSpecifier;

    let Some(specifiers) = &declaration.specifiers else {
        return false;
    };
    if specifiers.is_empty() {
        return false;
    }
    specifiers.iter().all(|specifier| {
        let (symbol_id, local_name) = match specifier {
            ImportDeclarationSpecifier::ImportSpecifier(specifier)
                if specifier.import_kind.is_type() =>
            {
                return true;
            }
            ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                (specifier.local.symbol_id(), specifier.local.name.as_str())
            }
            ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                (specifier.local.symbol_id(), specifier.local.name.as_str())
            }
            ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                (specifier.local.symbol_id(), specifier.local.name.as_str())
            }
        };
        let has_import_reference =
            ctx.scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| {
                    reference.is_value()
                        && !reference.is_type()
                        && !import_reference_is_inside_nextjs_server_data_function(
                            reference.node_id(),
                            ctx,
                        )
                });
        !has_import_reference
            && !import_program_has_jsx_root_name(local_name, ctx)
            && !import_program_has_shadowing_plain_runtime_name(symbol_id, local_name, ctx)
    })
}

fn import_program_has_jsx_root_name(
    local_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let oxc_ast::AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            return false;
        };
        import_jsx_element_root_name(&opening_element.name) == Some(local_name)
    })
}

fn import_jsx_element_root_name<'a>(
    element_name: &'a oxc_ast::ast::JSXElementName<'a>,
) -> Option<&'a str> {
    match element_name {
        oxc_ast::ast::JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
            Some(identifier.name.as_str())
        }
        oxc_ast::ast::JSXElementName::MemberExpression(member_expression) => {
            import_jsx_member_root_name(member_expression)
        }
        _ => None,
    }
}

fn import_jsx_member_root_name<'a>(
    member_expression: &'a oxc_ast::ast::JSXMemberExpression<'a>,
) -> Option<&'a str> {
    match &member_expression.object {
        oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) => {
            Some(identifier.name.as_str())
        }
        oxc_ast::ast::JSXMemberExpressionObject::MemberExpression(member_expression) => {
            import_jsx_member_root_name(member_expression)
        }
        oxc_ast::ast::JSXMemberExpressionObject::ThisExpression(_) => None,
    }
}

fn import_program_has_shadowing_plain_runtime_name(
    import_symbol_id: oxc_semantic::SymbolId,
    local_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let is_shadow_reference = matches!(candidate.kind(), oxc_ast::AstKind::IdentifierReference(identifier)
            if identifier.name == local_name
                && {
                    let reference = ctx.scoping().get_reference(identifier.reference_id());
                    reference.symbol_id() != Some(import_symbol_id)
                        && reference.is_value()
                        && !reference.is_type()
                });
        let is_shadow_binding = matches!(candidate.kind(), oxc_ast::AstKind::BindingIdentifier(identifier)
            if identifier.name == local_name && identifier.symbol_id() != import_symbol_id);
        if !is_shadow_reference && !is_shadow_binding {
            return false;
        }
        if import_reference_is_inside_nextjs_server_data_function(candidate.id(), ctx)
            || import_node_is_shadowed_by_function_parameter(candidate.id(), local_name, ctx)
        {
            return false;
        }
        is_shadow_reference
            || ctx
                .nodes()
                .ancestors(candidate.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        oxc_ast::AstKind::VariableDeclarator(_)
                            | oxc_ast::AstKind::Class(_)
                            | oxc_ast::AstKind::CatchClause(_)
                            | oxc_ast::AstKind::Function(_)
                            | oxc_ast::AstKind::ArrowFunctionExpression(_)
                            | oxc_ast::AstKind::ImportDeclaration(_)
                    )
                })
                .is_some_and(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        oxc_ast::AstKind::VariableDeclarator(_)
                            | oxc_ast::AstKind::Class(_)
                            | oxc_ast::AstKind::CatchClause(_)
                    )
                })
    })
}

fn import_node_is_shadowed_by_function_parameter(
    node_id: oxc_semantic::NodeId,
    local_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(node_id).any(|ancestor| {
        let parameters_span = match ancestor.kind() {
            oxc_ast::AstKind::Function(function) => Some(function.params.span),
            oxc_ast::AstKind::ArrowFunctionExpression(function) => Some(function.params.span),
            _ => None,
        };
        parameters_span.is_some_and(|parameters_span| {
            ctx.nodes().iter().any(|candidate| {
                parameters_span.contains_inclusive(oxc_span::GetSpan::span(candidate))
                    && matches!(candidate.kind(), oxc_ast::AstKind::BindingIdentifier(identifier)
                        if identifier.name == local_name)
            })
        })
    })
}

fn import_reference_is_inside_nextjs_server_data_function(
    node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let Some(statement) = ctx.nodes().ancestors(node_id).find(|ancestor| {
        matches!(
            ctx.nodes().parent_node(ancestor.id()).kind(),
            oxc_ast::AstKind::Program(_)
        )
    }) else {
        return false;
    };
    import_statement_is_nextjs_server_data_function(statement)
}

fn import_statement_is_nextjs_server_data_function(node: &crate::AstNode<'_>) -> bool {
    use oxc_ast::{ast::Declaration, AstKind};

    match node.kind() {
        AstKind::Function(function) => function
            .id
            .as_ref()
            .is_some_and(|identifier| import_is_nextjs_server_data_function_name(&identifier.name)),
        AstKind::VariableDeclaration(declaration) => declaration.declarations.iter().all(|item| {
            item.id.get_binding_identifier().is_some_and(|identifier| {
                import_is_nextjs_server_data_function_name(&identifier.name)
            })
        }),
        AstKind::ExportDeclaration(export) => match &export.declaration {
            Declaration::FunctionDeclaration(function) => {
                function.id.as_ref().is_some_and(|identifier| {
                    import_is_nextjs_server_data_function_name(&identifier.name)
                })
            }
            Declaration::VariableDeclaration(declaration) => {
                declaration.declarations.iter().all(|item| {
                    item.id.get_binding_identifier().is_some_and(|identifier| {
                        import_is_nextjs_server_data_function_name(&identifier.name)
                    })
                })
            }
            _ => false,
        },
        _ => false,
    }
}

fn import_is_nextjs_server_data_function_name(name: &str) -> bool {
    matches!(
        name,
        "getServerSideProps" | "getStaticProps" | "getStaticPaths"
    )
}
