use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const PBR_MATERIAL_NAMES: [&str; 2] = ["meshPhysicalMaterial", "meshStandardMaterial"];
const PBR_MATERIAL_PROPERTY_NAMES: [&str; 2] = ["metalness", "roughness"];
const MINIMUM_PBR_MATERIAL_FACTOR: f64 = 0.0;
const MAXIMUM_PBR_MATERIAL_FACTOR: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct R3FValidPbrMaterialProperties;

impl RuleMeta for R3FValidPbrMaterialProperties {
    const NAME: &'static str = "r3f-valid-pbr-material-properties";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber PBR material factors.",
    };
}

impl Rule for R3FValidPbrMaterialProperties {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !matches!(
                &opening_element.name,
                oxc_ast::ast::JSXElementName::Identifier(identifier)
                    if PBR_MATERIAL_NAMES.contains(&identifier.name.as_str())
            ) || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) {
                continue;
            }
            for property_name in PBR_MATERIAL_PROPERTY_NAMES {
                let Some(attribute) =
                    get_authoritative_jsx_attribute(opening_element, property_name, true)
                else {
                    continue;
                };
                let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                else {
                    continue;
                };
                let Some(expression) = container.expression.as_expression() else {
                    continue;
                };
                let Some(value) = resolve_static_number(expression, ctx) else {
                    continue;
                };
                if (MINIMUM_PBR_MATERIAL_FACTOR..=MAXIMUM_PBR_MATERIAL_FACTOR).contains(&value) {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "{property_name} is {value}, but Three.js PBR material factors use the normalized [0, 1] range"
                    ))
                    .with_label(attribute.span),
                );
            }
        }
    }
}
