use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::AssignmentOperator;

use crate::{AstNode, context::LintContext, rule::Rule};

const UNSUPPORTED_LIGHT_CONSTRUCTOR_NAMES: [&str; 3] =
    ["AmbientLight", "HemisphereLight", "RectAreaLight"];

#[derive(Debug, Default, Clone)]
pub struct ThreeNoShadowsOnUnsupportedLight;

declare_oxc_lint!(
    /// Disallow shadow flags on Three.js lights that cannot cast shadows.
    ThreeNoShadowsOnUnsupportedLight,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow shadows on unsupported Three.js lights.",
);

impl Rule for ThreeNoShadowsOnUnsupportedLight {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::AssignmentExpression(assignment) = node.kind() else {
            return;
        };
        let Some(member_expression) = assignment.left.as_member_expression() else {
            return;
        };
        if assignment.operator != AssignmentOperator::Assign
            || member_expression.static_property_name() != Some("castShadow")
            || !matches!(
                assignment.right.get_inner_expression(),
                oxc_ast::ast::Expression::BooleanLiteral(value) if value.value
            )
        {
            return;
        }
        let Some(constructor_name) = three_constructor_name(
            member_expression.object(),
            &UNSUPPORTED_LIGHT_CONSTRUCTOR_NAMES,
            ctx,
        ) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{constructor_name} has no direction and cannot cast shadows. Use a DirectionalLight, PointLight, or SpotLight for the shadow caster"
            ))
            .with_label(assignment.span),
        );
    }
}
