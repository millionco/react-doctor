use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const REANIMATED_MODULE_SOURCES: [&str; 1] = ["react-native-reanimated"];
const SCHEDULER_MIGRATIONS: [(&str, &str); 4] = [
    (
        "runOnUI",
        "replace `runOnUI(fn)(...args)` with `scheduleOnUI(fn, ...args)`",
    ),
    (
        "runOnJS",
        "replace `runOnJS(fn)(...args)` with `scheduleOnRN(fn, ...args)`",
    ),
    (
        "executeOnUIRuntimeSync",
        "replace `executeOnUIRuntimeSync(fn)(...args)` with `runOnUISync(fn, ...args)`",
    ),
    (
        "runOnRuntime",
        "replace `runOnRuntime(runtime, fn)(...args)` with `scheduleOnRuntime(runtime, fn, ...args)`",
    ),
];

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct RnReanimated_4UseWorkletsScheduler;

pub type RnReanimated4UseWorkletsScheduler = RnReanimated_4UseWorkletsScheduler;

declare_oxc_lint!(
    /// Prefer Reanimated 4 Worklets scheduler APIs.
    RnReanimated_4UseWorkletsScheduler,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prefer Reanimated 4 Worklets scheduler APIs.",
);

impl Rule for RnReanimated_4UseWorkletsScheduler {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some((_, migration)) = SCHEDULER_MIGRATIONS.iter().find(|(api_name, _)| {
            module_api_path_matches(
                &call_expression.callee,
                &[*api_name],
                &REANIMATED_MODULE_SOURCES,
                true,
                ctx,
            )
        }) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "For Reanimated 4, {migration} from `react-native-worklets`."
            ))
            .with_label(call_expression.span),
        );
    }
}
