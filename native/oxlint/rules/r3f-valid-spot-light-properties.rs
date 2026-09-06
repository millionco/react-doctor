use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const ANGLE_ARGUMENT_INDEX: usize = 3;
const PENUMBRA_ARGUMENT_INDEX: usize = 4;

#[derive(Debug, Default, Clone)]
pub struct R3FValidSpotLightProperties;

impl RuleMeta for R3FValidSpotLightProperties {
    const NAME: &'static str = "r3f-valid-spot-light-properties";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber spotlight properties.",
    };
}

impl Rule for R3FValidSpotLightProperties {
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
            if !matches!(
                &opening_element.name,
                oxc_ast::ast::JSXElementName::Identifier(identifier)
                    if identifier.name == "spotLight"
            ) || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) {
                continue;
            }
            let arguments = get_authoritative_jsx_attribute(opening_element, "args", true)
                .and_then(|attribute| jsx_attribute_expression(attribute))
                .and_then(|expression| {
                    let oxc_ast::ast::Expression::ArrayExpression(arguments) =
                        expression.get_inner_expression()
                    else {
                        return None;
                    };
                    Some(arguments)
                });
            for (property_name, argument_index) in [
                ("angle", ANGLE_ARGUMENT_INDEX),
                ("penumbra", PENUMBRA_ARGUMENT_INDEX),
            ] {
                let attribute =
                    get_authoritative_jsx_attribute(opening_element, property_name, true);
                let expression = attribute.map_or_else(
                    || {
                        arguments
                            .and_then(|arguments| arguments.elements.get(argument_index))
                            .and_then(oxc_ast::ast::ArrayExpressionElement::as_expression)
                    },
                    |attribute| jsx_attribute_expression(attribute),
                );
                let Some(expression) = expression else {
                    continue;
                };
                let Some(value) = resolve_static_number(expression, ctx) else {
                    continue;
                };
                let message = if property_name == "angle"
                    && (value <= 0.0 || value > std::f64::consts::FRAC_PI_2)
                {
                    Some(
                        "SpotLight angle must be greater than zero and no greater than Math.PI / 2",
                    )
                } else if property_name == "penumbra" && !(0.0..=1.0).contains(&value) {
                    Some("SpotLight penumbra must be in the normalized [0, 1] range")
                } else {
                    None
                };
                if let Some(message) = message {
                    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(expression.span()));
                }
            }
        }
    }
}
