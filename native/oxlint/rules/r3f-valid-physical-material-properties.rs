use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const NORMALIZED_PROPERTY_NAMES: [&str; 9] = [
    "anisotropy",
    "clearcoat",
    "clearcoatRoughness",
    "iridescence",
    "reflectivity",
    "sheen",
    "sheenRoughness",
    "specularIntensity",
    "transmission",
];
const IOR_PROPERTY_NAMES: [&str; 2] = ["ior", "iridescenceIOR"];
const MINIMUM_NORMALIZED_FACTOR: f64 = 0.0;
const MAXIMUM_NORMALIZED_FACTOR: f64 = 1.0;
const MINIMUM_IOR: f64 = 1.0;
const MAXIMUM_IOR: f64 = 2.333;

#[derive(Debug, Default, Clone)]
pub struct R3FValidPhysicalMaterialProperties;

impl RuleMeta for R3FValidPhysicalMaterialProperties {
    const NAME: &'static str = "r3f-valid-physical-material-properties";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber physical material properties.",
    };
}

impl Rule for R3FValidPhysicalMaterialProperties {
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
                    if identifier.name == "meshPhysicalMaterial"
            ) || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) {
                continue;
            }
            for property_name in NORMALIZED_PROPERTY_NAMES
                .iter()
                .chain(IOR_PROPERTY_NAMES.iter())
            {
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
                let (minimum, maximum) = if NORMALIZED_PROPERTY_NAMES.contains(property_name) {
                    (MINIMUM_NORMALIZED_FACTOR, MAXIMUM_NORMALIZED_FACTOR)
                } else {
                    (MINIMUM_IOR, MAXIMUM_IOR)
                };
                if (minimum..=maximum).contains(&value) {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "{property_name} is {value}, but meshPhysicalMaterial requires {property_name} in [{minimum}, {maximum}]"
                    ))
                    .with_label(attribute.span),
                );
            }
        }
    }
}
