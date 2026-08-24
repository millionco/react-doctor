use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const ORTHOGRAPHIC_CAMERA_CONSTRUCTOR_NAMES: [&str; 1] = ["OrthographicCamera"];
const LEFT_ARGUMENT_INDEX: usize = 0;
const RIGHT_ARGUMENT_INDEX: usize = 1;
const TOP_ARGUMENT_INDEX: usize = 2;
const BOTTOM_ARGUMENT_INDEX: usize = 3;
const NEAR_ARGUMENT_INDEX: usize = 4;
const FAR_ARGUMENT_INDEX: usize = 5;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidOrthographicCamera;

declare_oxc_lint!(
    /// Validate Three.js orthographic camera parameters.
    ThreeValidOrthographicCamera,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js orthographic cameras.",
);

impl Rule for ThreeValidOrthographicCamera {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(new_expression) = node.kind() else {
            return;
        };
        if !three_module_api_path_matches(
            &new_expression.callee,
            &ORTHOGRAPHIC_CAMERA_CONSTRUCTOR_NAMES,
            ctx,
        ) {
            return;
        }
        let left =
            resolve_static_number_argument(new_expression.arguments.get(LEFT_ARGUMENT_INDEX), ctx);
        let right =
            resolve_static_number_argument(new_expression.arguments.get(RIGHT_ARGUMENT_INDEX), ctx);
        let top =
            resolve_static_number_argument(new_expression.arguments.get(TOP_ARGUMENT_INDEX), ctx);
        let bottom = resolve_static_number_argument(
            new_expression.arguments.get(BOTTOM_ARGUMENT_INDEX),
            ctx,
        );
        let near =
            resolve_static_number_argument(new_expression.arguments.get(NEAR_ARGUMENT_INDEX), ctx);
        let far =
            resolve_static_number_argument(new_expression.arguments.get(FAR_ARGUMENT_INDEX), ctx);
        let invalid_parameter =
            if let (Some((_, left_value)), Some((right_expression, right_value))) = (left, right)
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
            } else if let (Some((_, near_value)), Some((far_expression, far_value))) = (near, far)
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
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(expression.span()));
        }
    }
}
