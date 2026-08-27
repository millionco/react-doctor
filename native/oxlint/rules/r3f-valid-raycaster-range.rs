use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const NEAR_ARGUMENT_INDEX: usize = 2;
const FAR_ARGUMENT_INDEX: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct R3FValidRaycasterRange;

impl RuleMeta for R3FValidRaycasterRange {
    const NAME: &'static str = "r3f-valid-raycaster-range";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber raycaster ranges.",
    };
}

impl Rule for R3FValidRaycasterRange {
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
            if opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) {
                continue;
            }
            let (near_expression, far_expression) = match &opening_element.name {
                oxc_ast::ast::JSXElementName::Identifier(identifier)
                    if identifier.name == "raycaster" =>
                {
                    let arguments = get_authoritative_jsx_attribute(
                        opening_element,
                        "args",
                        true,
                    )
                    .and_then(|attribute| jsx_attribute_expression(attribute))
                    .and_then(|expression| {
                        let oxc_ast::ast::Expression::ArrayExpression(arguments) =
                            expression.get_inner_expression()
                        else {
                            return None;
                        };
                        Some(arguments)
                    });
                    let near_attribute =
                        get_authoritative_jsx_attribute(opening_element, "near", true);
                    let far_attribute =
                        get_authoritative_jsx_attribute(opening_element, "far", true);
                    let near_expression = near_attribute.map_or_else(
                        || {
                            arguments
                                .and_then(|arguments| arguments.elements.get(NEAR_ARGUMENT_INDEX))
                                .and_then(oxc_ast::ast::ArrayExpressionElement::as_expression)
                        },
                        |attribute| jsx_attribute_expression(attribute),
                    );
                    let far_expression = far_attribute.map_or_else(
                        || {
                            arguments
                                .and_then(|arguments| arguments.elements.get(FAR_ARGUMENT_INDEX))
                                .and_then(oxc_ast::ast::ArrayExpressionElement::as_expression)
                        },
                        |attribute| jsx_attribute_expression(attribute),
                    );
                    (near_expression, far_expression)
                }
                _ if is_r3f_canvas(opening_element, ctx) => {
                    let Some(raycaster_expression) = get_authoritative_jsx_attribute(
                        opening_element,
                        "raycaster",
                        true,
                    )
                    .and_then(|attribute| jsx_attribute_expression(attribute))
                    else {
                        continue;
                    };
                    (
                        get_static_object_property_value(raycaster_expression, "near"),
                        get_static_object_property_value(raycaster_expression, "far"),
                    )
                }
                _ => continue,
            };
            let near = near_expression.and_then(|expression| {
                resolve_static_number(expression, ctx).map(|value| (expression, value))
            });
            let far = far_expression.and_then(|expression| {
                resolve_static_number(expression, ctx).map(|value| (expression, value))
            });
            if let Some((expression, value)) = near
                && value < 0.0
            {
                ctx.diagnostic(
                    OxcDiagnostic::error("Raycaster near cannot be negative")
                        .with_label(expression.span()),
                );
                continue;
            }
            if let (Some((_, near_value)), Some((far_expression, far_value))) = (near, far)
                && far_value < near_value
            {
                ctx.diagnostic(
                    OxcDiagnostic::error("Raycaster far cannot be lower than near")
                        .with_label(far_expression.span()),
                );
            }
        }
    }
}
