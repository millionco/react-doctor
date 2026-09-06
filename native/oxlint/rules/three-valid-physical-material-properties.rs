use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{context::LintContext, rule::Rule, AstNode};

const PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES: [&str; 9] = [
    "anisotropy",
    "clearcoat",
    "clearcoatRoughness",
    "iridescence",
    "reflectivity",
    "sheen",
    "sheenRoughness",
    "specularIntensity",
    "transmission",
];
const PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES: [&str; 2] = ["ior", "iridescenceIOR"];
const MINIMUM_PHYSICAL_MATERIAL_FACTOR: f64 = 0.0;
const MAXIMUM_PHYSICAL_MATERIAL_FACTOR: f64 = 1.0;
const MINIMUM_PHYSICAL_MATERIAL_IOR: f64 = 1.0;
const MAXIMUM_PHYSICAL_MATERIAL_IOR: f64 = 2.333;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidPhysicalMaterialProperties;

declare_oxc_lint!(
    /// Require documented Three.js physical material property ranges.
    ThreeValidPhysicalMaterialProperties,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js physical material properties.",
);

impl Rule for ThreeValidPhysicalMaterialProperties {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::NewExpression(new_expression)
                if three_module_api_path_matches(
                    &new_expression.callee,
                    &["MeshPhysicalMaterial"],
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
                for property_name in PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES
                    .iter()
                    .chain(PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES.iter())
                {
                    if let Some(property_value) =
                        get_static_object_property_value(parameters, property_name)
                    {
                        report_invalid_physical_material_property(
                            property_name,
                            property_value,
                            ctx,
                        );
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
                if !is_physical_material_property(property_name)
                    || three_constructor_name(
                        member_expression.object(),
                        &["MeshPhysicalMaterial"],
                        ctx,
                    )
                    .is_none()
                {
                    return;
                }
                report_invalid_physical_material_property(property_name, &assignment.right, ctx);
            }
            _ => {}
        }
    }
}

fn is_physical_material_property(property_name: &str) -> bool {
    PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES.contains(&property_name)
        || PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES.contains(&property_name)
}

fn report_invalid_physical_material_property<'a>(
    property_name: &str,
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(value) = resolve_static_number(expression, ctx) else {
        return;
    };
    let (minimum, maximum) = if PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES.contains(&property_name)
    {
        (
            MINIMUM_PHYSICAL_MATERIAL_FACTOR,
            MAXIMUM_PHYSICAL_MATERIAL_FACTOR,
        )
    } else {
        (MINIMUM_PHYSICAL_MATERIAL_IOR, MAXIMUM_PHYSICAL_MATERIAL_IOR)
    };
    if (minimum..=maximum).contains(&value) {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "{property_name} is {value}, but MeshPhysicalMaterial requires {property_name} in [{minimum}, {maximum}]"
        ))
        .with_label(expression.span()),
    );
}
