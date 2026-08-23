fn direct_named_import_matches<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    expected_export_names: &[&str],
    module_sources: &[&str],
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
            && module_sources.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if expected_export_names.contains(&imported_name.name())
            )
    })
}
