use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const FOG_CONSTRUCTOR_NAMES: [&str; 2] = ["Fog", "FogExp2"];
const DENSITY_OR_NEAR_ARGUMENT_INDEX: usize = 1;
const FAR_ARGUMENT_INDEX: usize = 2;
const DEFAULT_FOG_NEAR: f64 = 1.0;
const DEFAULT_FOG_FAR: f64 = 1_000.0;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidFogParameters;

declare_oxc_lint!(
    /// Validate Three.js fog ranges.
    ThreeValidFogParameters,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js fog parameters.",
);

impl Rule for ThreeValidFogParameters {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(new_expression) = node.kind() else {
            return;
        };
        let Some(constructor_name) =
            FOG_CONSTRUCTOR_NAMES
                .iter()
                .copied()
                .find(|constructor_name| {
                    three_module_api_path_matches(&new_expression.callee, &[*constructor_name], ctx)
                })
        else {
            return;
        };
        let invalid_parameter = if constructor_name == "FogExp2" {
            let density = optional_static_fog_argument(
                new_expression.arguments.get(DENSITY_OR_NEAR_ARGUMENT_INDEX),
                None,
                ctx,
            );
            (density.is_some_and(|value| value < 0.0)).then_some("density must be non-negative")
        } else {
            let near = optional_static_fog_argument(
                new_expression.arguments.get(DENSITY_OR_NEAR_ARGUMENT_INDEX),
                Some(DEFAULT_FOG_NEAR),
                ctx,
            );
            let far = optional_static_fog_argument(
                new_expression.arguments.get(FAR_ARGUMENT_INDEX),
                Some(DEFAULT_FOG_FAR),
                ctx,
            );
            if near.is_some_and(|value| value < 0.0) {
                Some("near must be non-negative")
            } else if near.zip(far).is_some_and(|(near, far)| far <= near) {
                Some("far must be greater than near")
            } else {
                None
            }
        };
        let Some(invalid_parameter) = invalid_parameter else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{constructor_name} {invalid_parameter}, otherwise the fog attenuation is invalid"
            ))
            .with_label(new_expression.span),
        );
    }
}

fn optional_static_fog_argument<'a>(
    argument: Option<&oxc_ast::ast::Argument<'a>>,
    missing_or_spread_default: Option<f64>,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    let Some(argument) = argument else {
        return missing_or_spread_default;
    };
    let Some(expression) = argument.as_expression() else {
        return missing_or_spread_default;
    };
    resolve_static_number(expression, ctx)
}
