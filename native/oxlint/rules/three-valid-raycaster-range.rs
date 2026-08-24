use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{AstNode, context::LintContext, rule::Rule};

const RAYCASTER_CONSTRUCTOR_NAMES: [&str; 1] = ["Raycaster"];
const NEAR_ARGUMENT_INDEX: usize = 2;
const FAR_ARGUMENT_INDEX: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidRaycasterRange;

declare_oxc_lint!(
    /// Validate Three.js raycaster distance ranges.
    ThreeValidRaycasterRange,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js raycaster ranges.",
);

impl Rule for ThreeValidRaycasterRange {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::NewExpression(new_expression)
                if three_module_api_path_matches(
                    &new_expression.callee,
                    &RAYCASTER_CONSTRUCTOR_NAMES,
                    ctx,
                ) =>
            {
                let near = static_raycaster_argument(
                    new_expression.arguments.get(NEAR_ARGUMENT_INDEX),
                    ctx,
                );
                let far = static_raycaster_argument(
                    new_expression.arguments.get(FAR_ARGUMENT_INDEX),
                    ctx,
                );
                report_invalid_raycaster_range(near, far, ctx);
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(member_expression) = assignment.left.as_member_expression() else {
                    return;
                };
                if member_expression.static_property_name() != Some("near")
                    || three_constructor_name(
                        member_expression.object(),
                        &RAYCASTER_CONSTRUCTOR_NAMES,
                        ctx,
                    )
                    .is_none()
                {
                    return;
                }
                let Some(near) = resolve_static_number(&assignment.right, ctx) else {
                    return;
                };
                report_invalid_raycaster_range(Some((&assignment.right, near)), None, ctx);
            }
            _ => {}
        }
    }
}

fn static_raycaster_argument<'a>(
    argument: Option<&'a oxc_ast::ast::Argument<'a>>,
    ctx: &LintContext<'a>,
) -> Option<(&'a oxc_ast::ast::Expression<'a>, f64)> {
    let expression = argument.and_then(oxc_ast::ast::Argument::as_expression)?;
    Some((expression, resolve_static_number(expression, ctx)?))
}

fn report_invalid_raycaster_range<'a>(
    near: Option<(&'a oxc_ast::ast::Expression<'a>, f64)>,
    far: Option<(&'a oxc_ast::ast::Expression<'a>, f64)>,
    ctx: &LintContext<'a>,
) {
    if let Some((near_expression, near_value)) = near
        && near_value < 0.0
    {
        ctx.diagnostic(
            OxcDiagnostic::warn("Raycaster near cannot be negative")
                .with_label(near_expression.span()),
        );
        return;
    }
    if let (Some((_, near_value)), Some((far_expression, far_value))) = (near, far)
        && far_value < near_value
    {
        ctx.diagnostic(
            OxcDiagnostic::warn("Raycaster far cannot be lower than near")
                .with_label(far_expression.span()),
        );
    }
}
