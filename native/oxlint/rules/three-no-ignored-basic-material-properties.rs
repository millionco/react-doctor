use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{AstNode, context::LintContext, rule::Rule};

const IGNORED_PROPERTY_NAMES: [&str; 2] = ["metalness", "roughness"];
const MESH_BASIC_MATERIAL_CONSTRUCTOR_NAMES: [&str; 1] = ["MeshBasicMaterial"];

#[derive(Debug, Default, Clone)]
pub struct ThreeNoIgnoredBasicMaterialProperties;

declare_oxc_lint!(
    /// Disallow PBR-only properties on Three.js basic materials.
    ThreeNoIgnoredBasicMaterialProperties,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow ignored PBR properties on basic materials.",
);

impl Rule for ThreeNoIgnoredBasicMaterialProperties {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::NewExpression(new_expression)
                if three_module_api_path_matches(
                    &new_expression.callee,
                    &MESH_BASIC_MATERIAL_CONSTRUCTOR_NAMES,
                    ctx,
                ) =>
            {
                let Some(parameters) = new_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                else {
                    return;
                };
                for property_name in IGNORED_PROPERTY_NAMES {
                    let Some(property_value) =
                        get_static_object_property_value(parameters, property_name)
                    else {
                        continue;
                    };
                    report_ignored_basic_material_property(property_name, property_value, ctx);
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
                if !IGNORED_PROPERTY_NAMES.contains(&property_name)
                    || three_constructor_name(
                        member_expression.object(),
                        &MESH_BASIC_MATERIAL_CONSTRUCTOR_NAMES,
                        ctx,
                    )
                    .is_none()
                {
                    return;
                }
                report_ignored_basic_material_property(property_name, &assignment.right, ctx);
            }
            _ => {}
        }
    }
}

fn report_ignored_basic_material_property(
    property_name: &str,
    property_value: &oxc_ast::ast::Expression,
    ctx: &LintContext,
) {
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "MeshBasicMaterial ignores {property_name} because it is not a PBR material. Use MeshStandardMaterial or MeshPhysicalMaterial for this property"
        ))
        .with_label(property_value.span()),
    );
}
