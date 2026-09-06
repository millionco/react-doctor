fn get_direct_string_literal_attribute_value<'a>(
    value: &'a oxc_ast::ast::JSXAttributeValue<'a>,
) -> Option<&'a str> {
    let oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) = value else {
        return None;
    };
    Some(string_literal.value.as_str())
}
