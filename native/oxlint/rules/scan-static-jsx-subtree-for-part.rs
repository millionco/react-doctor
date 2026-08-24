struct StaticJsxPartScan {
    found_part: bool,
    saw_opaque_content: bool,
}

fn scan_static_jsx_subtree_for_part<'a, IsPartElementName, IsOpaqueElement>(
    children: &'a [oxc_ast::ast::JSXChild<'a>],
    ctx: &crate::context::LintContext<'a>,
    mut is_part_element_name: IsPartElementName,
    mut is_opaque_element: IsOpaqueElement,
) -> StaticJsxPartScan
where
    IsPartElementName: FnMut(&oxc_ast::ast::JSXElementName<'a>) -> bool,
    IsOpaqueElement: FnMut(&oxc_ast::ast::JSXElement<'a>) -> bool,
{
    use std::cell::Cell;

    let found_part = Cell::new(false);
    let saw_opaque_content = Cell::new(false);
    visit_static_jsx_children(
        children,
        &mut |element| {
            if is_part_element_name(&element.opening_element.name) {
                found_part.set(true);
                return false;
            }
            if find_jsx_attribute(&element.opening_element, "render").is_some_and(|attribute| {
                jsx_attribute_contains_part(attribute, ctx, &mut is_part_element_name)
            }) {
                found_part.set(true);
            }
            if is_opaque_element(element) {
                saw_opaque_content.set(true);
            }
            true
        },
        &mut || saw_opaque_content.set(true),
    );
    StaticJsxPartScan {
        found_part: found_part.get(),
        saw_opaque_content: saw_opaque_content.get(),
    }
}

fn jsx_attribute_contains_part<'a, IsPartElementName>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    ctx: &crate::context::LintContext<'a>,
    is_part_element_name: &mut IsPartElementName,
) -> bool
where
    IsPartElementName: FnMut(&oxc_ast::ast::JSXElementName<'a>) -> bool,
{
    use oxc_ast::AstKind;
    use oxc_span::GetSpan;

    let Some(value) = &attribute.value else {
        return false;
    };
    let value_span = value.span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            return false;
        };
        let candidate_span = opening_element.span;
        candidate_span.start >= value_span.start
            && candidate_span.end <= value_span.end
            && is_part_element_name(&opening_element.name)
    })
}
