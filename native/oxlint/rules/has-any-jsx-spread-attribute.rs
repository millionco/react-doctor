fn has_any_jsx_spread_attribute(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        matches!(
            attribute,
            oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
        )
    })
}
