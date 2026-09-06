use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "Renderer shader precompilation runs inside useFrame. Compile once before display instead of rechecking the scene every frame";

#[derive(Debug, Default, Clone)]
pub struct R3FNoCompileInUseFrame;

impl RuleMeta for R3FNoCompileInUseFrame {
    const NAME: &'static str = "r3f-no-compile-in-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow renderer shader compilation inside useFrame.",
    };
}

impl Rule for R3FNoCompileInUseFrame {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
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
                        Some("compile" | "compileAsync")
                    ) && (r3f_callback_state_property_matches(
                        member_expression.object(),
                        callback_id,
                        "gl",
                        ctx,
                    ) || r3f_callback_state_property_matches(
                        member_expression.object(),
                        callback_id,
                        "renderer",
                        ctx,
                    )) {
                        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(candidate.span()));
                    }
                },
            );
        }
    }
}
