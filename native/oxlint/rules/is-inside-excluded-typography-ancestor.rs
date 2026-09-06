const TYPOGRAPHY_PUNCTUATION_EXCLUDED_TAG_NAMES: [&str; 26] = [
    "code",
    "pre",
    "kbd",
    "samp",
    "var",
    "tt",
    "markdown",
    "markdownblock",
    "markdowncontent",
    "markdownrenderer",
    "markdowntext",
    "markdownview",
    "mdx",
    "mdxcontent",
    "mdxremote",
    "md",
    "prose",
    "richtext",
    "article",
    "blockquote",
    "quote",
    "trans",
    "translation",
    "translated",
    "fbt",
    "fbs",
];

fn is_inside_excluded_typography_ancestor(
    node: &crate::AstNode,
    ctx: &crate::context::LintContext,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        let oxc_ast::AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        if get_opening_element_tag_name(&element.opening_element, ctx).is_some_and(|tag_name| {
            TYPOGRAPHY_PUNCTUATION_EXCLUDED_TAG_NAMES
                .iter()
                .any(|excluded_name| tag_name.eq_ignore_ascii_case(excluded_name))
        }) {
            return true;
        }
        let Some(translate_attribute) = find_jsx_attribute(&element.opening_element, "translate")
        else {
            return false;
        };
        matches!(
            translate_attribute.value.as_ref(),
            Some(oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal))
                if string_literal.value == "no"
        )
    })
}
