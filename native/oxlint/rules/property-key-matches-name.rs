fn property_key_matches_name(property_key: &oxc_ast::ast::PropertyKey, name: &str) -> bool {
    match property_key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => identifier.name == name,
        oxc_ast::ast::PropertyKey::Identifier(identifier) => identifier.name == name,
        oxc_ast::ast::PropertyKey::StringLiteral(string_literal) => string_literal.value == name,
        _ => false,
    }
}
