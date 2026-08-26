use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const DEFAULT_TRANSPARENT_MATERIAL_NAMES: [&str; 5] = [
    "shadowMaterial",
    "shadowNodeMaterial",
    "spriteMaterial",
    "spriteNodeMaterial",
    "volumeNodeMaterial",
];
const MESSAGE: &str = "This material sets opacity below 1 without transparent, alphaHash, or alphaTest, so the opacity does not make the surface translucent";

#[derive(Debug, Default, Clone)]
pub struct R3FRequireTransparentForOpacity;

impl RuleMeta for R3FRequireTransparentForOpacity {
    const NAME: &'static str = "r3f-require-transparent-for-opacity";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require a React Three Fiber material transparency mode.",
    };
}

impl Rule for R3FRequireTransparentForOpacity {
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
                || DEFAULT_TRANSPARENT_MATERIAL_NAMES.contains(&element_type)
                || opening_element.attributes.iter().any(|attribute| {
                    matches!(
                        attribute,
                        oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                    )
                })
            {
                continue;
            }
            let Some(opacity_attribute) =
                get_authoritative_jsx_attribute(opening_element, "opacity", true)
            else {
                continue;
            };
            let Some(opacity) = read_static_number_attribute(opacity_attribute, ctx) else {
                continue;
            };
            if !(0.0..1.0).contains(&opacity) {
                continue;
            }
            if let Some(transparent_attribute) =
                get_authoritative_jsx_attribute(opening_element, "transparent", true)
            {
                let Some(is_transparent) = read_static_jsx_boolean_attribute(transparent_attribute)
                else {
                    continue;
                };
                if is_transparent {
                    continue;
                }
            }
            if let Some(alpha_hash_attribute) =
                get_authoritative_jsx_attribute(opening_element, "alphaHash", true)
            {
                let Some(has_alpha_hash) = read_static_jsx_boolean_attribute(alpha_hash_attribute)
                else {
                    continue;
                };
                if has_alpha_hash {
                    continue;
                }
            }
            if let Some(alpha_test_attribute) =
                get_authoritative_jsx_attribute(opening_element, "alphaTest", true)
            {
                let Some(alpha_test) = read_static_number_attribute(alpha_test_attribute, ctx)
                else {
                    continue;
                };
                if alpha_test > 0.0 {
                    continue;
                }
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opacity_attribute.span));
        }
    }
}

fn read_static_number_attribute<'a>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return None;
    };
    resolve_static_number(container.expression.as_expression()?, ctx)
}
