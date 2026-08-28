fn property_key_matches_name(property_key: &oxc_ast::ast::PropertyKey, name: &str) -> bool {
    match property_key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => identifier.name == name,
        oxc_ast::ast::PropertyKey::Identifier(identifier) => identifier.name == name,
        oxc_ast::ast::PropertyKey::StringLiteral(string_literal) => string_literal.value == name,
        oxc_ast::ast::PropertyKey::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().is_some_and(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    == name
            })
        }
        _ => false,
    }
}
