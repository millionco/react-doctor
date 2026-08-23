use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const REANIMATED_MODULE_SOURCES: [&str; 1] = ["react-native-reanimated"];
const REMOVED_APIS: [(&str, &str); 5] = [
    (
        "useAnimatedGestureHandler",
        "Reanimated 4 removed `useAnimatedGestureHandler`; migrate this gesture to the Gesture API.",
    ),
    (
        "useWorkletCallback",
        "Reanimated 4 removed `useWorkletCallback`; use React's `useCallback` with a `worklet` directive instead.",
    ),
    (
        "combineTransition",
        "Reanimated 4 removed `combineTransition`; compose the transition with `EntryExitTransition` instead.",
    ),
    (
        "addWhitelistedNativeProps",
        "Reanimated 4 removed `addWhitelistedNativeProps` because prop whitelisting is no longer needed.",
    ),
    (
        "addWhitelistedUIProps",
        "Reanimated 4 removed `addWhitelistedUIProps` because prop whitelisting is no longer needed.",
    ),
];

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct RnReanimated_4NoRemovedApi;

pub type RnReanimated4NoRemovedApi = RnReanimated_4NoRemovedApi;

declare_oxc_lint!(
    /// Disallow Reanimated APIs removed in version 4.
    RnReanimated_4NoRemovedApi,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow Reanimated APIs removed in version 4.",
);

impl Rule for RnReanimated_4NoRemovedApi {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some((_, message)) = REMOVED_APIS.iter().find(|(api_name, _)| {
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
        ctx.diagnostic(OxcDiagnostic::warn(*message).with_label(call_expression.span));
    }
}
