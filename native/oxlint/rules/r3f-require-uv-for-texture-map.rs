use oxc_ast::{
    AstKind,
    ast::{JSXChild, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const UV_ATTRIBUTE_NAMES: [&str; 4] = ["uv", "uv1", "uv2", "uv3"];

#[derive(Debug, Default, Clone)]
pub struct R3FRequireUvForTextureMap;

impl RuleMeta for R3FRequireUvForTextureMap {
    const NAME: &'static str = "r3f-require-uv-for-texture-map";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require UVs for texture-mapped React Three Fiber geometry.",
    };
}

impl Rule for R3FRequireUvForTextureMap {
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
                || has_any_jsx_spread_attribute(&mesh.opening_element)
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
            let mapped_material_children = element_children
                .iter()
                .copied()
                .filter(|element| is_active_uv_mapped_material(&element.opening_element, ctx))
                .collect::<Vec<_>>();
            if geometry_children.len() != 1 || mapped_material_children.len() != 1 {
                continue;
            }
            let geometry = geometry_children[0];
            let material = mapped_material_children[0];
            if element_children.iter().any(|element| {
                !std::ptr::eq(*element, geometry) && !std::ptr::eq(*element, material)
            }) || !is_r3f_host_intrinsic(&geometry.opening_element, ctx)
                || !is_r3f_host_intrinsic(&material.opening_element, ctx)
            {
                continue;
            }

            let attributes = get_closed_r3f_buffer_geometry_attributes(geometry, ctx);
            if !attributes.is_complete
                || !attributes.attribute_names.contains("position")
                || UV_ATTRIBUTE_NAMES
                    .iter()
                    .any(|attribute_name| attributes.attribute_names.contains(*attribute_name))
            {
                continue;
            }
            let Some((material_type, _)) = resolve_jsx_element_type(&material.opening_element, ctx)
            else {
                continue;
            };
            if get_r3f_surface_visibility(
                mesh,
                &material.opening_element,
                node.id(),
                &mut analysis,
                ctx,
            ) != Some(true)
            {
                continue;
            }
            let texture_property_names = get_active_r3f_material_texture_property_names(
                &material.opening_element,
                &r3f_constructor_name(material_type),
            );
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "{material_type} samples {}, but this custom bufferGeometry defines positions without any UV attribute",
                    texture_property_names.join(", ")
                ))
                .with_label(geometry.opening_element.span),
            );
        }
    }
}

fn is_active_uv_mapped_material<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return false;
    };
    !has_any_jsx_spread_attribute(opening_element)
        && !get_active_r3f_material_texture_property_names(
            opening_element,
            &r3f_constructor_name(element_type),
        )
        .is_empty()
        && get_authoritative_jsx_attribute(opening_element, "attach", true).is_none()
}
