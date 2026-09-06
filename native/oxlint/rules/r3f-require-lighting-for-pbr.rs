use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::ContextHost,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

#[derive(Debug, Default, Clone)]
pub struct R3FRequireLightingForPbr;

impl RuleMeta for R3FRequireLightingForPbr {
    const NAME: &'static str = "r3f-require-lighting-for-pbr";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require lighting for React Three Fiber PBR materials.",
    };
}

impl Rule for R3FRequireLightingForPbr {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(canvas) = node.kind() else {
                continue;
            };
            if !r3f_canvas_has_public_provenance(&canvas.opening_element, ctx) {
                continue;
            }
            let analysis = analyze_closed_r3f_canvas_lighting(canvas, ctx);
            if !analysis.is_complete || analysis.has_environment || analysis.has_light {
                continue;
            }
            for material in analysis.materials {
                if material.has_environment_map
                    || material.has_light_map
                    || material.has_emissive_source
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "{} is rendered in a closed Canvas with no light, environment, envMap, lightMap, or emissive source",
                        material.constructor_name
                    ))
                    .with_label(material.span),
                );
            }
        }
    }
}
