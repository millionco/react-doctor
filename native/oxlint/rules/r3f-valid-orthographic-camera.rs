use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const LEFT_ARGUMENT_INDEX: usize = 0;
const RIGHT_ARGUMENT_INDEX: usize = 1;
const TOP_ARGUMENT_INDEX: usize = 2;
const BOTTOM_ARGUMENT_INDEX: usize = 3;
const NEAR_ARGUMENT_INDEX: usize = 4;
const FAR_ARGUMENT_INDEX: usize = 5;

#[derive(Debug, Default, Clone)]
pub struct R3FValidOrthographicCamera;

impl RuleMeta for R3FValidOrthographicCamera {
    const NAME: &'static str = "r3f-valid-orthographic-camera";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber orthographic cameras.",
    };
}

impl Rule for R3FValidOrthographicCamera {
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
            let parameters = match &opening_element.name {
                oxc_ast::ast::JSXElementName::Identifier(identifier)
                    if identifier.name == "orthographicCamera" =>
                {
                    let arguments = get_authoritative_jsx_attribute(
                        opening_element,
                        "args",
                        true,
                    )
                    .and_then(jsx_attribute_expression)
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
                                jsx_attribute_expression,
                            )
                    };
                    Some((
                        parameter_expression("left", LEFT_ARGUMENT_INDEX),
                        parameter_expression("right", RIGHT_ARGUMENT_INDEX),
                        parameter_expression("top", TOP_ARGUMENT_INDEX),
                        parameter_expression("bottom", BOTTOM_ARGUMENT_INDEX),
                        parameter_expression("near", NEAR_ARGUMENT_INDEX),
                        parameter_expression("far", FAR_ARGUMENT_INDEX),
                    ))
                }
                _ if is_r3f_canvas(opening_element, ctx) => {
                    let Some(orthographic_attribute) =
                        get_authoritative_jsx_attribute(opening_element, "orthographic", true)
                    else {
                        continue;
                    };
                    if read_static_jsx_boolean_attribute(orthographic_attribute) != Some(true) {
                        continue;
                    }
                    let Some(camera_expression) = get_authoritative_jsx_attribute(
                        opening_element,
                        "camera",
                        true,
                    )
                    .and_then(jsx_attribute_expression)
                    else {
                        continue;
                    };
                    Some((
                        get_static_object_property_value(camera_expression, "left"),
                        get_static_object_property_value(camera_expression, "right"),
                        get_static_object_property_value(camera_expression, "top"),
                        get_static_object_property_value(camera_expression, "bottom"),
                        get_static_object_property_value(camera_expression, "near"),
                        get_static_object_property_value(camera_expression, "far"),
                    ))
                }
                _ => None,
            };
            let Some((
                left_expression,
                right_expression,
                top_expression,
                bottom_expression,
                near_expression,
                far_expression,
            )) = parameters
            else {
                continue;
            };
            let left = resolve_camera_parameter(left_expression, ctx);
            let right = resolve_camera_parameter(right_expression, ctx);
            let top = resolve_camera_parameter(top_expression, ctx);
            let bottom = resolve_camera_parameter(bottom_expression, ctx);
            let near = resolve_camera_parameter(near_expression, ctx);
            let far = resolve_camera_parameter(far_expression, ctx);
            let invalid_parameter =
                if let (Some((_, left_value)), Some((right_expression, right_value))) =
                    (left, right)
                    && left_value == right_value
                {
                    Some((
                        right_expression,
                        "OrthographicCamera left and right planes must differ",
                    ))
                } else if let (Some((_, top_value)), Some((bottom_expression, bottom_value))) =
                    (top, bottom)
                    && top_value == bottom_value
                {
                    Some((
                        bottom_expression,
                        "OrthographicCamera top and bottom planes must differ",
                    ))
                } else if let (Some((_, near_value)), Some((far_expression, far_value))) =
                    (near, far)
                    && far_value <= near_value
                {
                    Some((
                        far_expression,
                        "OrthographicCamera far must be greater than near",
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

fn jsx_attribute_expression<'a>(
    attribute: &'a oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    container.expression.as_expression()
}

fn is_r3f_canvas<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    R3F_PUBLIC_MODULES.iter().any(|module_source| {
        resolve_imported_jsx_component_name(opening_element, module_source, ctx) == Some("Canvas")
    })
}
