use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const IGNORED_PROPERTY_NAMES: [&str; 2] = ["metalness", "roughness"];

#[derive(Debug, Default, Clone)]
pub struct R3FNoIgnoredBasicMaterialProperties;

impl RuleMeta for R3FNoIgnoredBasicMaterialProperties {
    const NAME: &'static str = "r3f-no-ignored-basic-material-properties";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow ignored PBR properties on React Three Fiber basic materials.",
    };
}

impl Rule for R3FNoIgnoredBasicMaterialProperties {
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
                    if identifier.name == "meshBasicMaterial"
            ) {
                continue;
            }
            for property_name in IGNORED_PROPERTY_NAMES {
                let Some(attribute) =
                    get_authoritative_jsx_attribute(opening_element, property_name, true)
                else {
                    continue;
                };
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "meshBasicMaterial ignores {property_name} because it is not a PBR material. Use meshStandardMaterial or meshPhysicalMaterial for this prop"
                    ))
                    .with_label(attribute.span),
                );
            }
        }
    }
}
