use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXChild, JSXElement, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const LIT_MATERIAL_CONSTRUCTOR_NAMES: [&str; 5] = [
    "MeshLambertMaterial",
    "MeshPhongMaterial",
    "MeshPhysicalMaterial",
    "MeshStandardMaterial",
    "MeshToonMaterial",
];
const R3F_LIT_NORMALS_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const ATTRIBUTE_ATTACH_PREFIX: &str = "attributes-";

#[derive(Debug, Default, Clone)]
pub struct R3FRequireLitMaterialNormals;

struct ClosedR3fBufferGeometryAttributes {
    attribute_names: rustc_hash::FxHashSet<String>,
    is_complete: bool,
}

impl RuleMeta for R3FRequireLitMaterialNormals {
    const NAME: &'static str = "r3f-require-lit-material-normals";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require normals for normal-mapped React Three Fiber geometry.",
    };
}

impl Rule for R3FRequireLitMaterialNormals {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        let mut analysis = None;
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(mesh) = node.kind() else {
                continue;
            };
            if resolve_jsx_element_type(&mesh.opening_element, ctx)
                .is_none_or(|(element_type, _)| element_type != "mesh")
                || !is_r3f_host_intrinsic(&mesh.opening_element, ctx)
                || has_jsx_spread_attribute(&mesh.opening_element)
                || get_authoritative_jsx_attribute(&mesh.opening_element, "geometry", true)
                    .is_some()
                || get_authoritative_jsx_attribute(&mesh.opening_element, "material", true)
                    .is_some()
            {
                continue;
            }

            let element_children = mesh
                .children
                .iter()
                .filter_map(|child| match child {
                    JSXChild::Element(element) => Some(element.as_ref()),
                    _ => None,
                })
                .collect::<Vec<_>>();
            let geometry_children = element_children
                .iter()
                .copied()
                .filter(|element| {
                    resolve_jsx_element_type(&element.opening_element, ctx)
                        .is_some_and(|(element_type, _)| element_type == "bufferGeometry")
                })
                .collect::<Vec<_>>();
            let material_children = element_children
                .iter()
                .copied()
                .filter(|element| is_active_lit_normal_map_material(&element.opening_element, ctx))
                .collect::<Vec<_>>();
            if geometry_children.len() != 1 || material_children.len() != 1 {
                continue;
            }
            let geometry = geometry_children[0];
            let material = material_children[0];
            if element_children.iter().any(|element| {
                !std::ptr::eq(*element, geometry) && !std::ptr::eq(*element, material)
            }) || !is_r3f_host_intrinsic(&geometry.opening_element, ctx)
            {
                continue;
            }

            let attributes = get_closed_r3f_buffer_geometry_attributes(geometry, ctx);
            if !attributes.is_complete
                || !attributes.attribute_names.contains("position")
                || attributes.attribute_names.contains("normal")
                || get_r3f_lit_normals_surface_visibility(
                    mesh,
                    &material.opening_element,
                    node.id(),
                    &mut analysis,
                    ctx,
                ) != Some(true)
            {
                continue;
            }
            let material_type = resolve_jsx_element_type(&material.opening_element, ctx)
                .map_or("This lit material", |(element_type, _)| element_type);
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "{material_type} applies a normalMap to this custom bufferGeometry, but the geometry defines positions without the normals needed to establish its normal basis"
                ))
                .with_label(geometry.opening_element.span),
            );
        }
    }
}

fn is_active_lit_normal_map_material<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return false;
    };
    let constructor_name = r3f_lit_normals_constructor_name(element_type);
    LIT_MATERIAL_CONSTRUCTOR_NAMES.contains(&constructor_name.as_str())
        && !has_jsx_spread_attribute(opening_element)
        && get_authoritative_jsx_attribute(opening_element, "normalMap", true).is_some_and(
            |normal_map_attribute| {
                jsx_attribute_expression(normal_map_attribute)
                    .is_none_or(|expression| !is_nullish_expression(expression))
            },
        )
        && get_authoritative_jsx_attribute(opening_element, "attach", true).is_none()
}

fn get_closed_r3f_buffer_geometry_attributes<'a>(
    geometry: &JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> ClosedR3fBufferGeometryAttributes {
    let opening_element = &geometry.opening_element;
    if has_jsx_spread_attribute(opening_element)
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
            JSXChild::Text(text) if text.value.trim().is_empty() => {}
            JSXChild::ExpressionContainer(container) => {
                if container.expression.as_expression().is_some() {
                    is_complete = false;
                }
            }
            JSXChild::Element(element) => {
                if let Some(attribute_name) =
                    get_r3f_lit_normals_buffer_attribute_name(&element.opening_element, ctx)
                {
                    attribute_names.insert(attribute_name);
                } else {
                    is_complete = false;
                }
            }
            JSXChild::Text(_) | JSXChild::Fragment(_) | JSXChild::Spread(_) => {
                is_complete = false;
            }
        }
    }
    ClosedR3fBufferGeometryAttributes {
        attribute_names,
        is_complete,
    }
}

fn get_r3f_lit_normals_buffer_attribute_name<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let attach_attribute = get_authoritative_jsx_attribute(opening_element, "attach", true)?;
    let attach_values = get_static_jsx_attribute_string_values(attach_attribute, ctx)?;
    let mut attribute_name = None;
    for attach_value in attach_values {
        let candidate = attach_value.strip_prefix(ATTRIBUTE_ATTACH_PREFIX)?;
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

fn get_r3f_lit_normals_surface_visibility<'a>(
    mesh: &JSXElement<'a>,
    material: &JSXOpeningElement<'a>,
    mesh_node_id: oxc_semantic::NodeId,
    analysis: &mut Option<PossibleStaticPropertyWriteAnalysis>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let material_visibility = get_r3f_lit_normals_material_visibility(material, ctx)?;
    if !material_visibility {
        return Some(false);
    }
    if !get_r3f_lit_normals_element_visibility(&mesh.opening_element)? {
        return Some(false);
    }
    let analysis = analysis.get_or_insert_with(|| build_possible_static_property_write_analysis(ctx));
    for ancestor in ctx.nodes().ancestors(mesh_node_id) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        if jsx_module_api_reference_matches(
            &element.opening_element.name,
            "Canvas",
            &R3F_LIT_NORMALS_PUBLIC_MODULES,
            analysis,
            ctx,
        ) {
            return Some(true);
        }
        if !is_r3f_host_intrinsic(&element.opening_element, ctx) {
            return None;
        }
        if !get_r3f_lit_normals_element_visibility(&element.opening_element)? {
            return Some(false);
        }
    }
    Some(true)
}

fn get_r3f_lit_normals_material_visibility<'a>(
    material: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let element_visibility = get_r3f_lit_normals_element_visibility(material)?;
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

fn get_r3f_lit_normals_element_visibility(opening_element: &JSXOpeningElement<'_>) -> Option<bool> {
    if has_jsx_spread_attribute(opening_element) {
        return None;
    }
    get_authoritative_jsx_attribute(opening_element, "visible", true)
        .map_or(Some(true), read_static_jsx_boolean_attribute)
}

fn has_jsx_spread_attribute(opening_element: &JSXOpeningElement<'_>) -> bool {
    opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
}

fn r3f_lit_normals_constructor_name(element_type: &str) -> String {
    let mut characters = element_type.chars();
    let Some(first_character) = characters.next() else {
        return String::new();
    };
    first_character.to_uppercase().chain(characters).collect()
}
