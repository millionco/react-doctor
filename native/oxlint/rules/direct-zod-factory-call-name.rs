fn direct_zod_factory_call_name<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    factory_names: &[&'static str],
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'static str> {
    let factory_name = match call_expression.callee.get_inner_expression() {
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            ctx.module_record().import_entries.iter().find_map(|entry| {
                if entry.is_type
                    || !DIRECT_ZOD_MODULE_SOURCES.contains(&entry.module_request.name())
                    || ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        != Some(symbol_id)
                {
                    return None;
                }
                match &entry.import_name {
                    crate::module_record::ImportImportName::Name(imported_name) => {
                        Some(imported_name.name())
                    }
                    crate::module_record::ImportImportName::NamespaceObject
                    | crate::module_record::ImportImportName::Default(_) => None,
                }
            })?
        }
        expression => {
            let member_expression = expression.as_member_expression()?;
            let factory_name = member_expression.static_property_name()?;
            matches!(
                member_expression.object().get_inner_expression(),
                oxc_ast::ast::Expression::Identifier(identifier)
                    if is_direct_zod_namespace_identifier(identifier, ctx)
            )
            .then_some(factory_name)?
        }
    };
    factory_names
        .iter()
        .copied()
        .find(|candidate_name| *candidate_name == factory_name)
}
