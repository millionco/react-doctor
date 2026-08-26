use oxc_ast::{AstKind, ast::ObjectExpression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct MotionKeyframeTimesMismatch;

declare_oxc_lint!(
    /// Require Motion transition times to match the animated keyframe count.
    MotionKeyframeTimesMismatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require Motion transition times to match the animated keyframe count.",
);

impl Rule for MotionKeyframeTimesMismatch {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(animation_object) =
            get_static_motion_property_object(opening_element, "animate", ctx)
        else {
            return;
        };
        let Some(keyframe_lengths) = get_keyframe_lengths(animation_object) else {
            return;
        };
        if keyframe_lengths.is_empty() {
            return;
        }
        let direct_transition =
            get_static_motion_property_object(opening_element, "transition", ctx);
        let transition_object = get_nested_transition(animation_object).or(direct_transition);
        let Some(times_property) = transition_object
            .and_then(|transition| get_effective_static_style_property(transition, "times"))
        else {
            return;
        };
        let Some(times_length) = static_array_expression_length(&times_property.value) else {
            return;
        };
        let Some(keyframe_length) = keyframe_lengths
            .iter()
            .find(|keyframe_length| **keyframe_length != times_length)
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "This transition has {times_length} time stops for {keyframe_length} keyframes. The times array must match the keyframe count."
            ))
            .with_label(times_property.span),
        );
    }
}

fn get_keyframe_lengths(animation_object: &ObjectExpression<'_>) -> Option<Vec<usize>> {
    let mut keyframe_lengths = Vec::new();
    for property in &animation_object.properties {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let property_name = property.key.static_name()?;
        if property_name == "transition" {
            continue;
        }
        if let Some(length) = static_array_expression_length(&property.value) {
            keyframe_lengths.push(length);
        }
    }
    Some(keyframe_lengths)
}

fn get_nested_transition<'a>(
    animation_object: &'a ObjectExpression<'a>,
) -> Option<&'a ObjectExpression<'a>> {
    let transition_property =
        get_effective_static_style_property(animation_object, "transition")?;
    let oxc_ast::ast::Expression::ObjectExpression(transition_object) =
        &transition_property.value
    else {
        return None;
    };
    Some(transition_object)
}

fn static_array_expression_length(expression: &oxc_ast::ast::Expression<'_>) -> Option<usize> {
    let oxc_ast::ast::Expression::ArrayExpression(array_expression) = expression else {
        return None;
    };
    array_expression
        .elements
        .iter()
        .all(|element| element.as_expression().is_some())
        .then_some(array_expression.elements.len())
}
