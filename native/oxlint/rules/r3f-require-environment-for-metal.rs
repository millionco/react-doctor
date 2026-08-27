use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::ContextHost,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const METAL_ENVIRONMENT_THRESHOLD: f64 = 0.5;

#[derive(Debug, Default, Clone)]
pub struct R3FRequireEnvironmentForMetal;

impl RuleMeta for R3FRequireEnvironmentForMetal {
    const NAME: &'static str = "r3f-require-environment-for-metal";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require environments for metallic React Three Fiber materials.",
    };
}

impl Rule for R3FRequireEnvironmentForMetal {
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
            if !is_r3f_lighting_canvas(&canvas.opening_element, ctx) {
                continue;
            }
            let analysis = analyze_closed_r3f_canvas_lighting(canvas, ctx);
            if !analysis.is_complete || analysis.has_environment {
                continue;
            }
            for material in analysis.materials {
                let Some(metalness) = material.metalness else {
                    continue;
                };
                if material.has_environment_map || metalness <= METAL_ENVIRONMENT_THRESHOLD {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "{} uses metalness {} without an envMap or Canvas scene environment, so its reflections have no environment source",
                        material.constructor_name,
                        format_javascript_number(metalness)
                    ))
                    .with_label(material.span),
                );
            }
        }
    }
}
