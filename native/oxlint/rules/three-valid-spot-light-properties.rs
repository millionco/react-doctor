use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{AstNode, context::LintContext, rule::Rule};

const SPOT_LIGHT_CONSTRUCTOR_NAMES: [&str; 1] = ["SpotLight"];
const ANGLE_ARGUMENT_INDEX: usize = 3;
const PENUMBRA_ARGUMENT_INDEX: usize = 4;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidSpotLightProperties;

declare_oxc_lint!(
    /// Validate Three.js spotlight cone properties.
    ThreeValidSpotLightProperties,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js spotlight properties.",
);

impl Rule for ThreeValidSpotLightProperties {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::NewExpression(new_expression)
                if three_module_api_path_matches(
                    &new_expression.callee,
                    &SPOT_LIGHT_CONSTRUCTOR_NAMES,
                    ctx,
                ) =>
            {
                report_invalid_spot_light_property(
                    "angle",
                    new_expression.arguments.get(ANGLE_ARGUMENT_INDEX),
                    ctx,
                );
                report_invalid_spot_light_property(
                    "penumbra",
                    new_expression.arguments.get(PENUMBRA_ARGUMENT_INDEX),
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
                if !matches!(property_name, "angle" | "penumbra")
                    || three_constructor_name(
                        member_expression.object(),
                        &SPOT_LIGHT_CONSTRUCTOR_NAMES,
                        ctx,
                    )
                    .is_none()
                {
                    return;
                }
                report_invalid_spot_light_expression(property_name, &assignment.right, ctx);
            }
            _ => {}
        }
    }
}

fn report_invalid_spot_light_property<'a>(
    property_name: &str,
    argument: Option<&'a oxc_ast::ast::Argument<'a>>,
    ctx: &LintContext<'a>,
) {
    let Some(expression) = argument.and_then(oxc_ast::ast::Argument::as_expression) else {
        return;
    };
    report_invalid_spot_light_expression(property_name, expression, ctx);
}

fn report_invalid_spot_light_expression<'a>(
    property_name: &str,
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(value) = resolve_static_number(expression, ctx) else {
        return;
    };
    let message =
        if property_name == "angle" && (value <= 0.0 || value > std::f64::consts::FRAC_PI_2) {
            Some("SpotLight angle must be greater than zero and no greater than Math.PI / 2")
        } else if property_name == "penumbra" && !(0.0..=1.0).contains(&value) {
            Some("SpotLight penumbra must be in the normalized [0, 1] range")
        } else {
            None
        };
    if let Some(message) = message {
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(expression.span()));
    }
}
