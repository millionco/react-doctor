use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MINIMUM_MATERIAL_OPACITY: f64 = 0.0;
const MAXIMUM_MATERIAL_OPACITY: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct R3FValidMaterialOpacity;

impl RuleMeta for R3FValidMaterialOpacity {
    const NAME: &'static str = "r3f-valid-material-opacity";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber material opacity.",
    };
}

impl Rule for R3FValidMaterialOpacity {
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
            let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
                continue;
            };
            if !element_type.ends_with("Material")
                || !element_type.chars().next().is_some_and(char::is_lowercase)
                || element_type.contains('-')
                || opening_element.attributes.iter().any(|attribute| {
                    matches!(
                        attribute,
                        oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                    )
                })
            {
                continue;
            }
            let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "opacity", true)
            else {
                continue;
            };
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            let Some(opacity) = resolve_static_number(expression, ctx) else {
                continue;
            };
            if (MINIMUM_MATERIAL_OPACITY..=MAXIMUM_MATERIAL_OPACITY).contains(&opacity) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Material opacity is {opacity}, but Three.js opacity uses the normalized [0, 1] range"
                ))
                .with_label(attribute.span),
            );
        }
    }
}
