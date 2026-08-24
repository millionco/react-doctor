#[derive(Clone, Copy)]
enum JsxPartAncestorClassification {
    Required,
    Root,
}

fn jsx_part_is_inside_root_without_required_ancestor<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
    classify_ancestor: impl Fn(
        &oxc_ast::ast::JSXElementName<'a>,
    ) -> Option<JsxPartAncestorClassification>,
) -> bool {
    use oxc_ast::AstKind;

    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXAttribute(_) => return false,
            AstKind::JSXElement(element) => {
                if element.opening_element.node_id.get() == node.id() {
                    continue;
                }
                match classify_ancestor(&element.opening_element.name) {
                    Some(JsxPartAncestorClassification::Required) => return false,
                    Some(JsxPartAncestorClassification::Root) => return true,
                    None => {}
                }
                let Some(trailing_name) =
                    jsx_element_name_trailing_segment(&element.opening_element.name)
                else {
                    continue;
                };
                if trailing_name != "Fragment"
                    && trailing_name
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_uppercase)
                {
                    return false;
                }
            }
            _ => {}
        }
    }
    false
}
