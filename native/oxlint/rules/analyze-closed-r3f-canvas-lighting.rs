use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttributeItem, JSXAttributeValue, JSXChild, JSXElement, JSXOpeningElement,
    },
};

use crate::{context::LintContext, globals::HTML_TAG};

const DREI_PUBLIC_MODULES: [&str; 2] = ["@react-three/drei", "@react-three/drei/native"];
const LIGHT_CONSTRUCTOR_NAMES: [&str; 7] = [
    "AmbientLight",
    "DirectionalLight",
    "HemisphereLight",
    "LightProbe",
    "PointLight",
    "RectAreaLight",
    "SpotLight",
];
const PBR_MATERIAL_CONSTRUCTOR_NAMES: [&str; 2] = ["MeshPhysicalMaterial", "MeshStandardMaterial"];

struct R3fMaterialLighting {
    constructor_name: String,
    has_emissive_source: bool,
    has_environment_map: bool,
    has_light_map: bool,
    metalness: Option<f64>,
    span: oxc_span::Span,
}

struct R3fCanvasLighting {
    has_environment: bool,
    has_light: bool,
    is_complete: bool,
    materials: Vec<R3fMaterialLighting>,
}

fn analyze_closed_r3f_canvas_lighting<'a>(
    canvas: &'a JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> R3fCanvasLighting {
    let mut analysis = R3fCanvasLighting {
        has_environment: false,
        has_light: false,
        is_complete: true,
        materials: Vec::new(),
    };
    if r3f_lighting_has_spread_attribute(&canvas.opening_element)
        || r3f_lighting_has_attribute(&canvas.opening_element, "onCreated")
        || r3f_lighting_has_attribute(&canvas.opening_element, "scene")
    {
        analysis.is_complete = false;
    }
    let mut ancestors = vec![canvas.opening_element.as_ref()];
    visit_r3f_lighting_children(
        &canvas.children,
        None,
        true,
        &mut ancestors,
        ctx,
        &mut analysis,
    );
    analysis
}

fn visit_r3f_lighting_children<'a>(
    children: &'a [JSXChild<'a>],
    parent: Option<&'a JSXElement<'a>>,
    is_visible: bool,
    ancestors: &mut Vec<&'a JSXOpeningElement<'a>>,
    ctx: &LintContext<'a>,
    analysis: &mut R3fCanvasLighting,
) {
    for child in children {
        match child {
            JSXChild::Text(text) if text.value.trim().is_empty() => {}
            JSXChild::ExpressionContainer(container) => {
                if container.expression.as_expression().is_some() {
                    analysis.is_complete = false;
                }
            }
            JSXChild::Fragment(fragment) => visit_r3f_lighting_children(
                &fragment.children,
                parent,
                is_visible,
                ancestors,
                ctx,
                analysis,
            ),
            JSXChild::Element(element) => {
                visit_r3f_lighting_element(element, parent, is_visible, ancestors, ctx, analysis);
            }
            JSXChild::Text(_) | JSXChild::Spread(_) => analysis.is_complete = false,
        }
    }
}

fn visit_r3f_lighting_element<'a>(
    element: &'a JSXElement<'a>,
    parent: Option<&'a JSXElement<'a>>,
    is_visible: bool,
    ancestors: &mut Vec<&'a JSXOpeningElement<'a>>,
    ctx: &LintContext<'a>,
    analysis: &mut R3fCanvasLighting,
) {
    let opening_element = &element.opening_element;
    let child_is_visible = is_visible
        && !r3f_lighting_attribute_expression(opening_element, "visible").is_some_and(
            |expression| {
                matches!(expression.get_inner_expression(), Expression::BooleanLiteral(value) if !value.value)
            },
        );
    if is_drei_lighting_environment(opening_element, ctx) {
        analysis.has_environment = true;
        return;
    }
    if !is_r3f_lighting_host_intrinsic(opening_element, ancestors, ctx) {
        analysis.is_complete = false;
        return;
    }
    let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        analysis.is_complete = false;
        return;
    };
    if element_type == "primitive" {
        analysis.is_complete = false;
        return;
    }
    let constructor_name = r3f_lighting_constructor_name(element_type);
    let intensity = r3f_lighting_attribute_expression(opening_element, "intensity")
        .and_then(|expression| resolve_static_number(expression, ctx));
    if child_is_visible
        && LIGHT_CONSTRUCTOR_NAMES.contains(&constructor_name.as_str())
        && intensity.is_none_or(|value| value > 0.0)
    {
        analysis.has_light = true;
    }
    if child_is_visible
        && PBR_MATERIAL_CONSTRUCTOR_NAMES.contains(&constructor_name.as_str())
        && is_default_r3f_mesh_material(element, parent, ctx)
    {
        match get_r3f_lighting_surface_visibility(opening_element, ancestors, ctx) {
            None => analysis.is_complete = false,
            Some(false) => {}
            Some(true) => {
                if r3f_lighting_has_spread_attribute(opening_element) {
                    analysis.is_complete = false;
                } else {
                    analysis.materials.push(R3fMaterialLighting {
                        constructor_name,
                        has_emissive_source: r3f_lighting_has_non_nullish_attribute(
                            opening_element,
                            "emissive",
                        ) || r3f_lighting_has_non_nullish_attribute(
                            opening_element,
                            "emissiveNode",
                        ),
                        has_environment_map: r3f_lighting_has_non_nullish_attribute(
                            opening_element,
                            "envMap",
                        ) || r3f_lighting_has_non_nullish_attribute(
                            opening_element,
                            "envNode",
                        ),
                        has_light_map: r3f_lighting_has_non_nullish_attribute(
                            opening_element,
                            "lightMap",
                        ),
                        metalness: r3f_lighting_attribute_expression(opening_element, "metalness")
                            .and_then(|expression| resolve_static_number(expression, ctx)),
                        span: opening_element.span,
                    });
                }
            }
        }
    }
    ancestors.push(opening_element);
    visit_r3f_lighting_children(
        &element.children,
        Some(element),
        child_is_visible,
        ancestors,
        ctx,
        analysis,
    );
    ancestors.pop();
}

fn is_default_r3f_mesh_material<'a>(
    material: &JSXElement<'a>,
    parent: Option<&JSXElement<'a>>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(parent) = parent else {
        return false;
    };
    if resolve_jsx_element_type(&parent.opening_element, ctx)
        .is_none_or(|(element_type, _)| element_type != "mesh")
        || r3f_lighting_has_spread_attribute(&parent.opening_element)
        || r3f_lighting_has_attribute(&parent.opening_element, "material")
        || r3f_lighting_has_attribute(&material.opening_element, "attach")
    {
        return false;
    }
    let mut matching_material = None;
    let mut material_count = 0;
    for child in &parent.children {
        let JSXChild::Element(child_element) = child else {
            continue;
        };
        if resolve_jsx_element_type(&child_element.opening_element, ctx)
            .is_some_and(|(element_type, _)| element_type.ends_with("Material"))
        {
            material_count += 1;
            matching_material = Some(child_element.as_ref());
        }
    }
    material_count == 1
        && matching_material.is_some_and(|candidate| std::ptr::eq(candidate, material))
}

fn get_r3f_lighting_surface_visibility<'a>(
    material: &JSXOpeningElement<'a>,
    ancestors: &[&JSXOpeningElement<'a>],
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let material_visibility = get_r3f_lighting_material_visibility(material, ctx)?;
    if !material_visibility {
        return Some(false);
    }
    for (index, opening_element) in ancestors.iter().rev().enumerate() {
        if index > 0 && r3f_canvas_has_public_provenance(opening_element, ctx) {
            return Some(true);
        }
        if !is_r3f_lighting_host_intrinsic(opening_element, &[], ctx) {
            return None;
        }
        if !get_r3f_lighting_element_visibility(opening_element)? {
            return Some(false);
        }
    }
    Some(true)
}

fn get_r3f_lighting_material_visibility<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let element_visibility = get_r3f_lighting_element_visibility(opening_element)?;
    if !element_visibility {
        return Some(false);
    }
    let Some(transparent_attribute) =
        get_authoritative_jsx_attribute(opening_element, "transparent", true)
    else {
        return Some(true);
    };
    match read_static_jsx_boolean_attribute(transparent_attribute) {
        Some(false) => return Some(true),
        None => return None,
        Some(true) => {}
    }
    let Some(opacity_attribute) = get_authoritative_jsx_attribute(opening_element, "opacity", true)
    else {
        return Some(true);
    };
    let Some(opacity_expression) = r3f_lighting_expression_from_attribute(opacity_attribute) else {
        return Some(true);
    };
    if is_nullish_expression(opacity_expression) {
        return Some(true);
    }
    resolve_static_number(opacity_expression, ctx).map(|opacity| opacity > 0.0)
}

fn get_r3f_lighting_element_visibility(opening_element: &JSXOpeningElement<'_>) -> Option<bool> {
    if r3f_lighting_has_spread_attribute(opening_element) {
        return None;
    }
    get_authoritative_jsx_attribute(opening_element, "visible", true)
        .map_or(Some(true), read_static_jsx_boolean_attribute)
}

fn r3f_lighting_has_attribute(opening_element: &JSXOpeningElement<'_>, name: &str) -> bool {
    get_authoritative_jsx_attribute(opening_element, name, true).is_some()
}

fn r3f_lighting_has_non_nullish_attribute(
    opening_element: &JSXOpeningElement<'_>,
    name: &str,
) -> bool {
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, name, true) else {
        return false;
    };
    r3f_lighting_expression_from_attribute(attribute)
        .is_none_or(|expression| !is_nullish_expression(expression))
}

fn r3f_lighting_attribute_expression<'a, 'b>(
    opening_element: &'b JSXOpeningElement<'a>,
    name: &str,
) -> Option<&'b Expression<'a>> {
    get_authoritative_jsx_attribute(opening_element, name, true)
        .and_then(r3f_lighting_expression_from_attribute)
}

fn r3f_lighting_expression_from_attribute<'a, 'b>(
    attribute: &'b oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'b Expression<'a>> {
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    container.expression.as_expression()
}

fn r3f_lighting_has_spread_attribute(opening_element: &JSXOpeningElement<'_>) -> bool {
    opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
}

fn is_drei_lighting_environment<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    DREI_PUBLIC_MODULES.iter().any(|module_source| {
        resolve_imported_jsx_component_name(opening_element, module_source, ctx)
            == Some("Environment")
    })
}

fn is_r3f_lighting_host_intrinsic<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ancestors: &[&JSXOpeningElement<'a>],
    ctx: &LintContext<'a>,
) -> bool {
    let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return false;
    };
    element_type
        .chars()
        .next()
        .is_some_and(|first_character| first_character.is_lowercase())
        && !element_type.contains('-')
        && !HTML_TAG.contains(element_type)
        && (!is_svg_tag_name(element_type)
            || (element_type == "line"
                && !ancestors.iter().any(|ancestor| {
                    resolve_jsx_element_type(ancestor, ctx)
                        .is_some_and(|(ancestor_type, _)| ancestor_type == "svg")
                })))
}

fn r3f_lighting_constructor_name(element_type: &str) -> String {
    let mut characters = element_type.chars();
    let Some(first_character) = characters.next() else {
        return String::new();
    };
    first_character.to_uppercase().chain(characters).collect()
}
