struct ClosedR3fBufferGeometryAttributes {
    attribute_names: rustc_hash::FxHashSet<String>,
    is_complete: bool,
}

fn get_closed_r3f_buffer_geometry_attributes<'a>(
    geometry: &oxc_ast::ast::JSXElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> ClosedR3fBufferGeometryAttributes {
    let opening_element = &geometry.opening_element;
    if has_any_jsx_spread_attribute(opening_element)
        || get_authoritative_jsx_attribute(opening_element, "ref", true).is_some()
        || get_authoritative_jsx_attribute(opening_element, "onUpdate", true).is_some()
    {
        return ClosedR3fBufferGeometryAttributes {
            attribute_names: rustc_hash::FxHashSet::default(),
            is_complete: false,
        };
    }
    let mut attribute_names = rustc_hash::FxHashSet::default();
    let mut is_complete = true;
    for child in &geometry.children {
        match child {
            oxc_ast::ast::JSXChild::Text(text) if text.value.trim().is_empty() => {}
            oxc_ast::ast::JSXChild::ExpressionContainer(container) => {
                if container.expression.as_expression().is_some() {
                    is_complete = false;
                }
            }
            oxc_ast::ast::JSXChild::Element(element) => {
                if let Some(attribute_name) =
                    get_r3f_buffer_geometry_attribute_name(&element.opening_element, ctx)
                {
                    attribute_names.insert(attribute_name);
                } else {
                    is_complete = false;
                }
            }
            oxc_ast::ast::JSXChild::Text(_)
            | oxc_ast::ast::JSXChild::Fragment(_)
            | oxc_ast::ast::JSXChild::Spread(_) => {
                is_complete = false;
            }
        }
    }
    ClosedR3fBufferGeometryAttributes {
        attribute_names,
        is_complete,
    }
}

fn get_r3f_buffer_geometry_attribute_name<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<String> {
    let attach_attribute = get_authoritative_jsx_attribute(opening_element, "attach", true)?;
    let attach_values = get_static_jsx_attribute_string_values(attach_attribute, ctx)?;
    let mut attribute_name = None;
    for attach_value in attach_values {
        let candidate = attach_value.strip_prefix("attributes-")?;
        if candidate.is_empty() {
            return None;
        }
        if attribute_name
            .as_deref()
            .is_some_and(|current| current != candidate)
        {
            return None;
        }
        attribute_name = Some(candidate.to_string());
    }
    attribute_name
}
