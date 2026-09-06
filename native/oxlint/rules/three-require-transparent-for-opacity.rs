use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const DEFAULT_TRANSPARENT_MATERIAL_CONSTRUCTOR_NAMES: [&str; 5] = [
    "ShadowMaterial",
    "ShadowNodeMaterial",
    "SpriteMaterial",
    "SpriteNodeMaterial",
    "VolumeNodeMaterial",
];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireTransparentForOpacity;

declare_oxc_lint!(
    /// Require a transparency mode for translucent Three.js material opacity.
    ThreeRequireTransparentForOpacity,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require a Three.js material transparency mode.",
);

impl Rule for ThreeRequireTransparentForOpacity {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(new_expression) = node.kind() else {
            return;
        };
        let Some(constructor_name) = three_module_api_name(&new_expression.callee, ctx) else {
            return;
        };
        if !constructor_name.ends_with("Material")
            || DEFAULT_TRANSPARENT_MATERIAL_CONSTRUCTOR_NAMES.contains(&constructor_name.as_str())
        {
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
        let Some(opacity_expression) = get_static_object_property_value(parameters, "opacity")
        else {
            return;
        };
        let Some(opacity) = resolve_static_number(opacity_expression, ctx) else {
            return;
        };
        if !(0.0..1.0).contains(&opacity) {
            return;
        }
        if let Some(transparent_expression) =
            get_static_object_property_value(parameters, "transparent")
        {
            let Some(is_transparent) = resolve_static_boolean_literal(transparent_expression)
            else {
                return;
            };
            if is_transparent {
                return;
            }
        }
        if let Some(alpha_hash_expression) =
            get_static_object_property_value(parameters, "alphaHash")
        {
            let Some(has_alpha_hash) = resolve_static_boolean_literal(alpha_hash_expression) else {
                return;
            };
            if has_alpha_hash {
                return;
            }
        }
        if let Some(alpha_test_expression) =
            get_static_object_property_value(parameters, "alphaTest")
        {
            let Some(alpha_test) = resolve_static_number(alpha_test_expression, ctx) else {
                return;
            };
            if alpha_test > 0.0 {
                return;
            }
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(
                "This material sets opacity below 1 without transparent, alphaHash, or alphaTest, so the opacity does not make the surface translucent",
            )
            .with_label(opacity_expression.span()),
        );
    }
}

fn resolve_static_boolean_literal(expression: &oxc_ast::ast::Expression) -> Option<bool> {
    let oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) =
        expression.get_inner_expression()
    else {
        return None;
    };
    Some(boolean_literal.value)
}
