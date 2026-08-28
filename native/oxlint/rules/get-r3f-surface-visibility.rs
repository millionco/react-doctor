fn get_r3f_surface_visibility<'a>(
    mesh: &oxc_ast::ast::JSXElement<'a>,
    material: &oxc_ast::ast::JSXOpeningElement<'a>,
    mesh_node_id: oxc_semantic::NodeId,
    analysis: &mut Option<PossibleStaticPropertyWriteAnalysis>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<bool> {
    const R3F_PUBLIC_MODULES: [&str; 5] = [
        "@react-three/fiber",
        "@react-three/fiber/legacy",
        "@react-three/fiber/native",
        "@react-three/fiber/webgpu",
        "react-three-fiber",
    ];
    let material_visibility = get_r3f_material_visibility(material, ctx)?;
    if !material_visibility {
        return Some(false);
    }
    if !get_r3f_element_visibility(&mesh.opening_element)? {
        return Some(false);
    }
    let analysis =
        analysis.get_or_insert_with(|| build_possible_static_property_write_analysis(ctx));
    for ancestor in ctx.nodes().ancestors(mesh_node_id) {
        let oxc_ast::AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        if jsx_module_api_reference_matches(
            &element.opening_element.name,
            "Canvas",
            &R3F_PUBLIC_MODULES,
            analysis,
            ctx,
        ) {
            return Some(true);
        }
        if !is_r3f_host_intrinsic(&element.opening_element, ctx) {
            return None;
        }
        if !get_r3f_element_visibility(&element.opening_element)? {
            return Some(false);
        }
    }
    Some(true)
}

fn get_r3f_material_visibility<'a>(
    material: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<bool> {
    let element_visibility = get_r3f_element_visibility(material)?;
    if !element_visibility {
        return Some(false);
    }
    let Some(transparent_attribute) =
        get_authoritative_jsx_attribute(material, "transparent", true)
    else {
        return Some(true);
    };
    match read_static_jsx_boolean_attribute(transparent_attribute) {
        Some(false) => return Some(true),
        None => return None,
        Some(true) => {}
    }
    let Some(opacity_attribute) = get_authoritative_jsx_attribute(material, "opacity", true) else {
        return Some(true);
    };
    let Some(opacity_expression) = jsx_attribute_expression(opacity_attribute) else {
        return Some(true);
    };
    if is_nullish_expression(opacity_expression) {
        return Some(true);
    }
    resolve_static_number(opacity_expression, ctx).map(|opacity| opacity > 0.0)
}

fn get_r3f_element_visibility(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> Option<bool> {
    if has_any_jsx_spread_attribute(opening_element) {
        return None;
    }
    get_authoritative_jsx_attribute(opening_element, "visible", true)
        .map_or(Some(true), read_static_jsx_boolean_attribute)
}
