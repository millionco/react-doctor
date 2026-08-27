use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const DENSITY_OR_NEAR_ARGUMENT_INDEX: usize = 1;
const FAR_ARGUMENT_INDEX: usize = 2;
const DEFAULT_FOG_NEAR: f64 = 1.0;
const DEFAULT_FOG_FAR: f64 = 1_000.0;

#[derive(Debug, Default, Clone)]
pub struct R3FValidFogParameters;

impl RuleMeta for R3FValidFogParameters {
    const NAME: &'static str = "r3f-valid-fog-parameters";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber fog parameters.",
    };
}

impl Rule for R3FValidFogParameters {
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
            let constructor_name = match &opening_element.name {
                oxc_ast::ast::JSXElementName::Identifier(identifier) if identifier.name == "fog" => {
                    "Fog"
                }
                oxc_ast::ast::JSXElementName::Identifier(identifier)
                    if identifier.name == "fogExp2" =>
                {
                    "FogExp2"
                }
                _ => continue,
            };
            let argument_expression = get_authoritative_jsx_attribute(
                opening_element,
                "args",
                true,
            )
            .and_then(|attribute| jsx_attribute_expression(attribute));
            let density_expression = get_authoritative_jsx_attribute(
                opening_element,
                "density",
                true,
            )
            .and_then(|attribute| jsx_attribute_expression(attribute));
            let near_expression =
                get_authoritative_jsx_attribute(opening_element, "near", true)
                    .and_then(|attribute| jsx_attribute_expression(attribute));
            let far_expression = get_authoritative_jsx_attribute(opening_element, "far", true)
                .and_then(|attribute| jsx_attribute_expression(attribute));
            let invalid_parameter = if constructor_name == "FogExp2" {
                let density = density_expression
                    .map(|expression| resolve_static_number(expression, ctx))
                    .unwrap_or_else(|| {
                        argument_expression.and_then(|expression| {
                            resolve_static_number_array_element(
                                expression,
                                DENSITY_OR_NEAR_ARGUMENT_INDEX,
                                ctx,
                            )
                        })
                    });
                density
                    .is_some_and(|value| value < 0.0)
                    .then_some("density must be non-negative")
            } else {
                let near = near_expression
                    .map(|expression| resolve_static_number(expression, ctx))
                    .unwrap_or_else(|| {
                        argument_expression
                            .and_then(|expression| {
                                resolve_static_number_array_element(
                                    expression,
                                    DENSITY_OR_NEAR_ARGUMENT_INDEX,
                                    ctx,
                                )
                            })
                            .or(Some(DEFAULT_FOG_NEAR))
                    });
                let far = far_expression
                    .map(|expression| resolve_static_number(expression, ctx))
                    .unwrap_or_else(|| {
                        argument_expression
                            .and_then(|expression| {
                                resolve_static_number_array_element(
                                    expression,
                                    FAR_ARGUMENT_INDEX,
                                    ctx,
                                )
                            })
                            .or(Some(DEFAULT_FOG_FAR))
                    });
                if near.is_some_and(|value| value < 0.0) {
                    Some("near must be non-negative")
                } else if near.zip(far).is_some_and(|(near, far)| far <= near) {
                    Some("far must be greater than near")
                } else {
                    None
                }
            };
            let Some(invalid_parameter) = invalid_parameter else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "{constructor_name} {invalid_parameter}, otherwise the fog attenuation is invalid"
                ))
                .with_label(opening_element.span),
            );
        }
    }
}

fn resolve_static_number_array_element<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    index: usize,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    let oxc_ast::ast::Expression::ArrayExpression(array_expression) =
        expression.get_inner_expression()
    else {
        return None;
    };
    array_expression
        .elements
        .get(index)
        .and_then(oxc_ast::ast::ArrayExpressionElement::as_expression)
        .and_then(|expression| resolve_static_number(expression, ctx))
}
