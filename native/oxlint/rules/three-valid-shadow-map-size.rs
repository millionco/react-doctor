use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const SHADOW_CASTING_LIGHT_NAMES: [&str; 3] = ["DirectionalLight", "PointLight", "SpotLight"];

#[derive(Debug, Default, Clone)]
pub struct ThreeValidShadowMapSize;

declare_oxc_lint!(
    /// Require valid Three.js shadow map dimensions.
    ThreeValidShadowMapSize,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js shadow map sizes.",
);

impl Rule for ThreeValidShadowMapSize {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(set_member) = call_expression.callee.as_member_expression() else {
            return;
        };
        if set_member.static_property_name() != Some("set") {
            return;
        }
        let Some(map_size_member) = set_member.object().as_member_expression() else {
            return;
        };
        if map_size_member.static_property_name() != Some("mapSize") {
            return;
        }
        let Some(shadow_member) = map_size_member.object().as_member_expression() else {
            return;
        };
        if shadow_member.static_property_name() != Some("shadow")
            || three_constructor_name(shadow_member.object(), &SHADOW_CASTING_LIGHT_NAMES, ctx)
                .is_none()
        {
            return;
        }
        for argument in call_expression.arguments.iter().take(2) {
            let Some(expression) = argument.as_expression() else {
                continue;
            };
            report_invalid_shadow_map_size(expression, ctx);
        }
    }
}

fn report_invalid_shadow_map_size<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(value) = resolve_static_number(expression, ctx) else {
        return;
    };
    if value >= 1.0 && value.fract() == 0.0 && value.log2().fract() == 0.0 {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Shadow map size {value} is invalid; Three.js shadow map dimensions must be positive powers of two"
        ))
        .with_label(expression.span()),
    );
}
