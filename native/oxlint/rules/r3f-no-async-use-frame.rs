use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
    AstNode,
};

const R3F_PUBLIC_MODULE_SOURCES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const MESSAGE: &str = "useFrame receives an ignored Promise from this callback, so thrown errors become unhandled rejections and awaited work can overlap across frames. Keep the frame callback synchronous";

#[derive(Debug, Default, Clone)]
pub struct R3FNoAsyncUseFrame;

impl RuleMeta for R3FNoAsyncUseFrame {
    const NAME: &'static str = "r3f-no-async-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow asynchronous useFrame callbacks.",
    };
}

impl Rule for R3FNoAsyncUseFrame {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !module_api_path_matches(
            &call_expression.callee,
            &["useFrame"],
            &R3F_PUBLIC_MODULE_SOURCES,
            false,
            ctx,
        ) {
            return;
        }
        let Some(callback) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some((is_async, callback_span)) = resolve_local_react_callback(callback, ctx) else {
            return;
        };
        if is_async {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(callback_span));
        }
    }
}
