use std::borrow::Cow;

use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::ast::{
    JSXAttributeName, JSXAttributeValue, ObjectExpression, ObjectProperty, ObjectPropertyKind,
    PropertyKey,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MOTION_ANIMATE_PROPS: [&str; 8] = [
    "animate",
    "initial",
    "exit",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileDrag",
    "whileInView",
];
static BLUR_VALUE_PATTERN: Lazy<Regex> = lazy_regex!(r"blur\((\d+(?:\.\d+)?)px\)");

#[derive(Debug, Default, Clone)]
pub struct NoLargeAnimatedBlur;

declare_oxc_lint!(
    /// Disallow large animated CSS blurs.
    NoLargeAnimatedBlur,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow large animated CSS blurs.",
);

impl Rule for NoLargeAnimatedBlur {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => check_motion_attribute(attribute, ctx),
            AstKind::CallExpression(call_expression) => {
                check_web_animation_call(call_expression, ctx);
            }
            _ => {}
        }
    }
}

fn check_motion_attribute<'a>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    ctx: &LintContext<'a>,
) {
    let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return;
    };
    if !MOTION_ANIMATE_PROPS.contains(&attribute_name.name.as_str()) {
        return;
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return;
    };
    let Some(Expression::ObjectExpression(animation)) = container.expression.as_expression()
    else {
        return;
    };
    for property in object_properties(animation) {
        let Some(property_name) = property_key_identifier_name(&property.key) else {
            continue;
        };
        if !matches!(property_name, "filter" | "backdropFilter" | "WebkitBackdropFilter") {
            continue;
        }
        let Expression::StringLiteral(value) = &property.value else {
            continue;
        };
        let Some(blur_radius) = get_blur_radius(value.value.as_str()) else {
            continue;
        };
        if blur_radius > 10.0 {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Large animated blurs can use significant GPU memory on phones because blur({blur_radius}px) gets heavier as the blur and element grow. Use a smaller blur or a smaller element."
                ))
                .with_label(property.span),
            );
        }
    }
}

fn check_web_animation_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return;
    };
    if member_expression.static_property_name() != Some("animate")
        || !is_proven_dom_event_target(member_expression.object(), ctx, &mut Vec::new())
    {
        return;
    }
    let Some(keyframes) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return;
    };
    match keyframes.get_inner_expression() {
        Expression::ObjectExpression(keyframe) => check_web_animation_keyframe(keyframe, ctx),
        Expression::ArrayExpression(keyframes) => {
            for keyframe in keyframes.elements.iter().filter_map(|element| element.as_expression()) {
                if let Expression::ObjectExpression(keyframe) = keyframe.get_inner_expression() {
                    check_web_animation_keyframe(keyframe, ctx);
                }
            }
        }
        _ => {}
    }
}

fn check_web_animation_keyframe<'a>(
    keyframe: &ObjectExpression<'a>,
    ctx: &LintContext<'a>,
) {
    for property in object_properties(keyframe) {
        let property_name = if property.computed {
            match &property.key {
                PropertyKey::StringLiteral(property_name) => {
                    Some(Cow::Borrowed(property_name.value.as_str()))
                }
                _ => None,
            }
        } else {
            property.key.static_name()
        };
        let Some(property_name) = property_name else {
            continue;
        };
        if !matches!(
            property_name.as_ref(),
            "filter"
                | "backdropFilter"
                | "backdrop-filter"
                | "WebkitBackdropFilter"
                | "-webkit-backdrop-filter"
        ) {
            continue;
        }
        let Expression::StringLiteral(value) = &property.value else {
            continue;
        };
        let Some(blur_radius) = get_blur_radius(value.value.as_str()) else {
            continue;
        };
        if blur_radius > 10.0 {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This Web Animation uses blur({blur_radius}px), which can consume significant GPU memory. Use a smaller blur or animate opacity and transform instead."
                ))
                .with_label(property.span),
            );
        }
    }
}

fn object_properties<'a>(
    object: &'a ObjectExpression<'a>,
) -> impl Iterator<Item = &'a ObjectProperty<'a>> {
    object.properties.iter().filter_map(|property| match property {
        ObjectPropertyKind::ObjectProperty(property) => Some(property.as_ref()),
        ObjectPropertyKind::SpreadProperty(_) => None,
    })
}

fn get_blur_radius(value: &str) -> Option<f64> {
    BLUR_VALUE_PATTERN
        .captures(value)
        .and_then(|captures| captures.get(1))
        .and_then(|radius| radius.as_str().parse().ok())
}
