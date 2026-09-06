const DIRECT_ZOD_MODULE_SOURCES: [&str; 2] = ["zod", "zod/v4"];

fn is_direct_zod_namespace_identifier<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && DIRECT_ZOD_MODULE_SOURCES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && (matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
                    | crate::module_record::ImportImportName::Default(_)
            ) || matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "z"
            ))
    })
}
