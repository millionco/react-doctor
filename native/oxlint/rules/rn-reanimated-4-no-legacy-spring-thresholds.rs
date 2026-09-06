use oxc_ast::{AstKind, ast::ObjectPropertyKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const REANIMATED_MODULE_SOURCES: [&str; 1] = ["react-native-reanimated"];
const LEGACY_SPRING_THRESHOLD_NAMES: [&str; 2] =
    ["restDisplacementThreshold", "restSpeedThreshold"];

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct RnReanimated_4NoLegacySpringThresholds;

pub type RnReanimated4NoLegacySpringThresholds = RnReanimated_4NoLegacySpringThresholds;

declare_oxc_lint!(
    /// Disallow legacy Reanimated spring thresholds.
    RnReanimated_4NoLegacySpringThresholds,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow legacy Reanimated spring thresholds.",
);

impl Rule for RnReanimated_4NoLegacySpringThresholds {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !module_api_path_matches(
            &call_expression.callee,
            &["withSpring"],
            &REANIMATED_MODULE_SOURCES,
            true,
            ctx,
        ) {
            return;
        }
        let Some(oxc_ast::ast::Expression::ObjectExpression(configuration)) = call_expression
            .arguments
            .get(1)
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(oxc_ast::ast::Expression::get_inner_expression)
        else {
            return;
        };
        for property in &configuration.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            let Some(property_name) = LEGACY_SPRING_THRESHOLD_NAMES
                .iter()
                .find(|property_name| property_key_matches_name(&property.key, property_name))
            else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Reanimated 4 removed `{property_name}`; use the `energyThreshold` spring option instead."
                ))
                .with_label(property.span),
            );
        }
    }
}
