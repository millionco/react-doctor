static DATA_VISUALIZATION_NAME_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> = lazy_regex::lazy_regex!(
    r"(?i)(?:^|[-_\s/.])(?:blueprint|breakdown|canvas|chart|distribution|graph|map|plot|visualization)(?:[-_\s/.]|$)"
);

fn is_data_visualization_context<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let filename = ctx.file_path().to_string_lossy();
    if DATA_VISUALIZATION_NAME_PATTERN.is_match(&normalize_data_visualization_name(&filename))
        || is_data_visualization_element(opening_element)
    {
        return true;
    }
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::JSXElement(element)
                if is_data_visualization_element(&element.opening_element)
        )
    })
}

fn is_data_visualization_element(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let element_name = match &opening_element.name {
        oxc_ast::ast::JSXElementName::Identifier(identifier) => identifier.name.as_str(),
        _ => "",
    };
    DATA_VISUALIZATION_NAME_PATTERN.is_match(&normalize_data_visualization_name(element_name))
        || get_static_class_name(opening_element)
            .is_some_and(|class_name| DATA_VISUALIZATION_NAME_PATTERN.is_match(class_name))
}

fn normalize_data_visualization_name(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut previous = None;
    for character in value.chars() {
        if character.is_ascii_uppercase()
            && previous.is_some_and(|previous: char| {
                previous.is_ascii_lowercase() || previous.is_ascii_digit()
            })
        {
            normalized.push('-');
        }
        normalized.push(character);
        previous = Some(character);
    }
    normalized
}
