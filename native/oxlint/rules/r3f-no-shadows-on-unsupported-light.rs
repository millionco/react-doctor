use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const UNSUPPORTED_SHADOW_LIGHT_NAMES: [&str; 3] =
    ["ambientLight", "hemisphereLight", "rectAreaLight"];

#[derive(Debug, Default, Clone)]
pub struct R3FNoShadowsOnUnsupportedLight;

impl RuleMeta for R3FNoShadowsOnUnsupportedLight {
    const NAME: &'static str = "r3f-no-shadows-on-unsupported-light";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow shadows on unsupported React Three Fiber lights.",
    };
}

impl Rule for R3FNoShadowsOnUnsupportedLight {
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
            if !UNSUPPORTED_SHADOW_LIGHT_NAMES.contains(&element_type) {
                continue;
            }
            let Some(attribute) =
                get_authoritative_jsx_attribute(opening_element, "castShadow", true)
            else {
                continue;
            };
            if read_static_jsx_boolean_attribute(attribute) != Some(true) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "{element_type} has no direction and cannot cast shadows. Use a directionalLight, pointLight, or spotLight for the shadow caster"
                ))
                .with_label(attribute.span),
            );
        }
    }
}
