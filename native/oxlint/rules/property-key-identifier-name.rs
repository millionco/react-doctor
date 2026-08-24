fn property_key_identifier_name<'a>(
    property_key: &'a oxc_ast::ast::PropertyKey<'a>,
) -> Option<&'a str> {
    match property_key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}
