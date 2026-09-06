use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{context::LintContext, rule::Rule, AstNode};

const PBR_MATERIAL_CONSTRUCTOR_NAMES: [&str; 2] = ["MeshPhysicalMaterial", "MeshStandardMaterial"];
const PBR_MATERIAL_PROPERTY_NAMES: [&str; 2] = ["metalness", "roughness"];
const MINIMUM_PBR_MATERIAL_FACTOR: f64 = 0.0;
const MAXIMUM_PBR_MATERIAL_FACTOR: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidPbrMaterialProperties;

declare_oxc_lint!(
    /// Require normalized Three.js PBR material factors.
    ThreeValidPbrMaterialProperties,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js PBR material factors.",
);

impl Rule for ThreeValidPbrMaterialProperties {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::NewExpression(new_expression)
                if PBR_MATERIAL_CONSTRUCTOR_NAMES
                    .iter()
                    .any(|constructor_name| {
                        three_module_api_path_matches(
                            &new_expression.callee,
                            &[*constructor_name],
                            ctx,
                        )
                    }) =>
            {
                let Some(parameters) = new_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                else {
                    return;
                };
                for property_name in PBR_MATERIAL_PROPERTY_NAMES {
                    if let Some(property_value) =
                        get_static_object_property_value(parameters, property_name)
                    {
                        report_invalid_pbr_material_factor(property_name, property_value, ctx);
                    }
                }
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
                if !PBR_MATERIAL_PROPERTY_NAMES.contains(&property_name)
                    || three_constructor_name(
                        member_expression.object(),
                        &PBR_MATERIAL_CONSTRUCTOR_NAMES,
                        ctx,
                    )
                    .is_none()
                {
                    return;
                }
                report_invalid_pbr_material_factor(property_name, &assignment.right, ctx);
            }
            _ => {}
        }
    }
}

fn report_invalid_pbr_material_factor<'a>(
    property_name: &str,
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(value) = resolve_static_number(expression, ctx) else {
        return;
    };
    if (MINIMUM_PBR_MATERIAL_FACTOR..=MAXIMUM_PBR_MATERIAL_FACTOR).contains(&value) {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "{property_name} is {value}, but Three.js PBR material factors use the normalized [0, 1] range"
        ))
        .with_label(expression.span()),
    );
}
