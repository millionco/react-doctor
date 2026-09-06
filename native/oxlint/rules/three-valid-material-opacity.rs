use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{context::LintContext, rule::Rule, AstNode};

const MINIMUM_MATERIAL_OPACITY: f64 = 0.0;
const MAXIMUM_MATERIAL_OPACITY: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidMaterialOpacity;

declare_oxc_lint!(
    /// Require normalized Three.js material opacity.
    ThreeValidMaterialOpacity,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js material opacity.",
);

impl Rule for ThreeValidMaterialOpacity {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::NewExpression(new_expression) => {
                let Some(constructor_name) = three_module_api_name(&new_expression.callee, ctx)
                else {
                    return;
                };
                if !constructor_name.ends_with("Material") {
                    return;
                }
                let Some(parameters) = new_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                else {
                    return;
                };
                let oxc_ast::ast::Expression::ObjectExpression(object_expression) =
                    parameters.get_inner_expression()
                else {
                    return;
                };
                if object_expression.properties.iter().any(|property| {
                    !matches!(
                        property,
                        oxc_ast::ast::ObjectPropertyKind::ObjectProperty(_)
                    )
                }) {
                    return;
                }
                if let Some(opacity_expression) =
                    get_static_object_property_value(parameters, "opacity")
                {
                    report_invalid_material_opacity(opacity_expression, ctx);
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(member_expression) = assignment.left.as_member_expression() else {
                    return;
                };
                if member_expression.static_property_name() != Some("opacity")
                    || three_constructor_api_name(member_expression.object(), ctx)
                        .is_none_or(|constructor_name| !constructor_name.ends_with("Material"))
                {
                    return;
                }
                report_invalid_material_opacity(&assignment.right, ctx);
            }
            _ => {}
        }
    }
}

fn report_invalid_material_opacity<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(opacity) = resolve_static_number(expression, ctx) else {
        return;
    };
    if (MINIMUM_MATERIAL_OPACITY..=MAXIMUM_MATERIAL_OPACITY).contains(&opacity) {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Material opacity is {opacity}, but Three.js opacity uses the normalized [0, 1] range"
        ))
        .with_label(expression.span()),
    );
}
