use std::borrow::Cow;

use oxc_ast::ast::{
    JSXAttributeName, JSXAttributeValue, JSXElementName, JSXMemberExpressionObject,
    ObjectExpression, ObjectProperty, ObjectPropertyKind, PropertyKey,
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
const LAYOUT_PROPERTIES: [&str; 20] = [
    "width",
    "height",
    "top",
    "left",
    "right",
    "bottom",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "margin",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "borderWidth",
    "fontSize",
    "lineHeight",
    "gap",
];

#[derive(Debug, Default, Clone)]
pub struct NoLayoutPropertyAnimation;

declare_oxc_lint!(
    /// Disallow animating layout properties.
    NoLayoutPropertyAnimation,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow animating layout properties.",
);

impl Rule for NoLayoutPropertyAnimation {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => check_motion_attribute(node, attribute, ctx),
            AstKind::CallExpression(call_expression) => {
                check_web_animation_call(call_expression, ctx);
            }
            _ => {}
        }
    }
}

fn check_motion_attribute<'a>(
    node: &AstNode<'a>,
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    ctx: &LintContext<'a>,
) {
    let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return;
    };
    if !MOTION_ANIMATE_PROPS.contains(&attribute_name.name.as_str())
        || !is_motion_element(node, ctx)
    {
        return;
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return;
    };
    let Some(Expression::ObjectExpression(animation)) = container.expression.as_expression()
    else {
        return;
    };
    for property in &animation.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let property_name = match &property.key {
            PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
            PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
            PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            _ => None,
        };
        let Some(property_name) = property_name else {
            continue;
        };
        if LAYOUT_PROPERTIES.contains(&property_name) {
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "This stutters because animating \"{property_name}\" makes the browser redo page layout every frame, so animate transform or scale instead, or use the layout prop"
                ))
                .with_label(property.span),
            );
        }
    }
}

fn is_motion_element(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::JSXOpeningElement(opening_element) = parent.kind() else {
        return false;
    };
    match &opening_element.name {
        JSXElementName::MemberExpression(member_expression) => matches!(
            &member_expression.object,
            JSXMemberExpressionObject::IdentifierReference(identifier)
                if matches!(identifier.name.as_str(), "motion" | "m")
        ),
        JSXElementName::Identifier(identifier) => identifier.name.starts_with("Motion"),
        JSXElementName::IdentifierReference(identifier) => identifier.name.starts_with("Motion"),
        _ => false,
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
    for property in &keyframe.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(property_name) = static_web_animation_property_name(property) else {
            continue;
        };
        let normalized_property_name = to_camel_case_property_name(property_name.as_ref());
        if !LAYOUT_PROPERTIES.contains(&normalized_property_name.as_str()) {
            continue;
        }
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "This Web Animation changes \"{property_name}\" every frame, forcing layout work. Animate transform or opacity instead."
            ))
            .with_label(property.span),
        );
    }
}

fn static_web_animation_property_name<'a>(
    property: &'a ObjectProperty<'a>,
) -> Option<Cow<'a, str>> {
    if property.computed {
        return match &property.key {
            PropertyKey::StringLiteral(property_name) => {
                Some(Cow::Borrowed(property_name.value.as_str()))
            }
            _ => None,
        };
    }
    property.key.static_name()
}

fn to_camel_case_property_name(property_name: &str) -> String {
    let mut characters = property_name.chars().peekable();
    let mut normalized_property_name = String::with_capacity(property_name.len());
    while let Some(character) = characters.next() {
        if character == '-'
            && let Some(next_character) = characters.peek()
            && next_character.is_ascii_lowercase()
        {
            normalized_property_name.push(next_character.to_ascii_uppercase());
            characters.next();
        } else {
            normalized_property_name.push(character);
        }
    }
    normalized_property_name
}
