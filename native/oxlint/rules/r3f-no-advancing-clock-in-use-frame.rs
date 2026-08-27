use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "Calling this method advances the shared R3F clock and makes timing depend on callback order. Use the supplied delta argument or clock.elapsedTime";

#[derive(Debug, Default, Clone)]
pub struct R3FNoAdvancingClockInUseFrame;

impl RuleMeta for R3FNoAdvancingClockInUseFrame {
    const NAME: &'static str = "r3f-no-advancing-clock-in-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow advancing the shared R3F clock inside useFrame.",
    };
}

impl Rule for R3FNoAdvancingClockInUseFrame {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if has_capability(ctx, "r3f:10") {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            for_each_r3f_callback_execution_node(
                call_expression,
                "useFrame",
                ctx,
                |candidate, callback_id, _| {
                    let AstKind::CallExpression(candidate_call) = candidate.kind() else {
                        return;
                    };
                    let Some(member_expression) = candidate_call.callee.as_member_expression()
                    else {
                        return;
                    };
                    if matches!(
                        member_expression.static_property_name(),
                        Some("getDelta" | "getElapsedTime")
                    ) && r3f_callback_state_property_matches(
                        member_expression.object(),
                        callback_id,
                        "clock",
                        ctx,
                    ) {
                        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                    }
                },
            );
        }
    }
}
