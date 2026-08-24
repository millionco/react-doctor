use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{AstNode, context::LintContext, rule::Rule};

const PERSPECTIVE_CAMERA_CONSTRUCTOR_NAMES: [&str; 1] = ["PerspectiveCamera"];
const ASPECT_ARGUMENT_INDEX: usize = 1;
const NEAR_ARGUMENT_INDEX: usize = 2;
const FAR_ARGUMENT_INDEX: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidPerspectiveCamera;

declare_oxc_lint!(
    /// Validate Three.js perspective camera parameters.
    ThreeValidPerspectiveCamera,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js perspective cameras.",
);

impl Rule for ThreeValidPerspectiveCamera {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::NewExpression(new_expression)
                if three_module_api_path_matches(
                    &new_expression.callee,
                    &PERSPECTIVE_CAMERA_CONSTRUCTOR_NAMES,
                    ctx,
                ) =>
            {
                report_invalid_perspective_camera(
                    resolve_static_number_argument(
                        new_expression.arguments.get(ASPECT_ARGUMENT_INDEX),
                        ctx,
                    ),
                    resolve_static_number_argument(
                        new_expression.arguments.get(NEAR_ARGUMENT_INDEX),
                        ctx,
                    ),
                    resolve_static_number_argument(
                        new_expression.arguments.get(FAR_ARGUMENT_INDEX),
                        ctx,
                    ),
                    ctx,
                );
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(member_expression) = assignment.left.as_member_expression() else {
                    return;
                };
                let Some(property_name) = member_expression.static_property_name() else {
                    return;
                };
                if !matches!(property_name, "aspect" | "near" | "far")
                    || three_constructor_name(
                        member_expression.object(),
                        &PERSPECTIVE_CAMERA_CONSTRUCTOR_NAMES,
                        ctx,
                    )
                    .is_none()
                {
                    return;
                }
                let Some(value) = resolve_static_number(&assignment.right, ctx) else {
                    return;
                };
                let parameter = Some((&assignment.right, value));
                report_invalid_perspective_camera(
                    (property_name == "aspect").then_some(parameter).flatten(),
                    (property_name == "near").then_some(parameter).flatten(),
                    (property_name == "far").then_some(parameter).flatten(),
                    ctx,
                );
            }
            _ => {}
        }
    }
}

fn report_invalid_perspective_camera<'a>(
    aspect: Option<(&'a oxc_ast::ast::Expression<'a>, f64)>,
    near: Option<(&'a oxc_ast::ast::Expression<'a>, f64)>,
    far: Option<(&'a oxc_ast::ast::Expression<'a>, f64)>,
    ctx: &LintContext<'a>,
) {
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
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(expression.span()));
    }
}
