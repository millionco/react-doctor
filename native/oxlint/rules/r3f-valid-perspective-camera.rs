use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const ASPECT_ARGUMENT_INDEX: usize = 1;
const NEAR_ARGUMENT_INDEX: usize = 2;
const FAR_ARGUMENT_INDEX: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct R3FValidPerspectiveCamera;

impl RuleMeta for R3FValidPerspectiveCamera {
    const NAME: &'static str = "r3f-valid-perspective-camera";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber perspective cameras.",
    };
}

impl Rule for R3FValidPerspectiveCamera {
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
            let parameters = match &opening_element.name {
                oxc_ast::ast::JSXElementName::Identifier(identifier)
                    if identifier.name == "perspectiveCamera"
                        && !opening_element.attributes.iter().any(|attribute| {
                            matches!(
                                attribute,
                                oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                            )
                        }) =>
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
                    let parameter_expression = |property_name, argument_index| {
                        get_authoritative_jsx_attribute(opening_element, property_name, true)
                            .map_or_else(
                                || {
                                    arguments
                                        .and_then(|arguments| {
                                            arguments.elements.get(argument_index)
                                        })
                                        .and_then(
                                            oxc_ast::ast::ArrayExpressionElement::as_expression,
                                        )
                                },
                                |attribute| jsx_attribute_expression(attribute),
                            )
                    };
                    Some((
                        parameter_expression("aspect", ASPECT_ARGUMENT_INDEX),
                        parameter_expression("near", NEAR_ARGUMENT_INDEX),
                        parameter_expression("far", FAR_ARGUMENT_INDEX),
                    ))
                }
                _ if is_r3f_canvas(opening_element, ctx)
                    && get_authoritative_jsx_attribute(opening_element, "orthographic", true)
                        .is_none() =>
                {
                    let Some(camera_expression) = get_authoritative_jsx_attribute(
                        opening_element,
                        "camera",
                        true,
                    )
                    .and_then(|attribute| jsx_attribute_expression(attribute))
                    else {
                        continue;
                    };
                    Some((
                        get_static_object_property_value(camera_expression, "aspect"),
                        get_static_object_property_value(camera_expression, "near"),
                        get_static_object_property_value(camera_expression, "far"),
                    ))
                }
                _ => None,
            };
            let Some((aspect_expression, near_expression, far_expression)) = parameters else {
                continue;
            };
            let aspect = resolve_camera_parameter(aspect_expression, ctx);
            let near = resolve_camera_parameter(near_expression, ctx);
            let far = resolve_camera_parameter(far_expression, ctx);
            let invalid_parameter = if let Some((expression, value)) = aspect
                && value <= 0.0
            {
                Some((
                    expression,
                    "This perspective camera has a non-positive aspect ratio, so its projection is invalid",
                ))
            } else if let Some((expression, value)) = near
                && value <= 0.0
            {
                Some((
                    expression,
                    "This perspective camera has a non-positive near plane, but Three.js requires near to be greater than zero",
                ))
            } else if let Some((expression, value)) = far
                && value <= 0.0
            {
                Some((
                    expression,
                    "This perspective camera has a non-positive far plane, but Three.js requires far to be greater than its positive near plane",
                ))
            } else if let (Some((_, near_value)), Some((far_expression, far_value))) = (near, far)
                && far_value <= near_value
            {
                Some((
                    far_expression,
                    "This perspective camera's far plane is not greater than its near plane, so its projection is invalid",
                ))
            } else {
                None
            };
            if let Some((expression, message)) = invalid_parameter {
                ctx.diagnostic(OxcDiagnostic::error(message).with_label(expression.span()));
            }
        }
    }
}

fn resolve_camera_parameter<'a>(
    expression: Option<&'a oxc_ast::ast::Expression<'a>>,
    ctx: &LintContext<'a>,
) -> Option<(&'a oxc_ast::ast::Expression<'a>, f64)> {
    expression.and_then(|expression| {
        resolve_static_number(expression, ctx).map(|value| (expression, value))
    })
}
