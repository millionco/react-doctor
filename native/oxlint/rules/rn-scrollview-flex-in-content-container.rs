use oxc_ast::{
    AstKind,
    ast::{
        Argument, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        MemberExpression, ObjectExpression, ObjectProperty, ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CONTENT_CONTAINER_STYLE_SCROLL_CONTAINER_NAMES: [&str; 7] = [
    "ScrollView",
    "FlatList",
    "SectionList",
    "VirtualizedList",
    "KeyboardAwareScrollView",
    "FlashList",
    "LegendList",
];
const CONTENT_CONTAINER_FLEX_MESSAGE: &str =
    "`flex` on contentContainerStyle can collapse the container on small screens.";

#[derive(Debug, Default, Clone)]
pub struct RnScrollviewFlexInContentContainer;

declare_oxc_lint!(
    /// Warns when a React Native scroll content container uses positive flex shorthand.
    RnScrollviewFlexInContentContainer,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a React Native scroll content container uses positive flex shorthand.",
);

impl Rule for RnScrollviewFlexInContentContainer {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_non_production_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(element_name) = resolve_jsx_element_name(opening_element) else {
            return;
        };
        if !CONTENT_CONTAINER_STYLE_SCROLL_CONTAINER_NAMES.contains(&element_name) {
            return;
        }
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let Some(style_object) = content_container_style_object(attribute, ctx) else {
                continue;
            };
            if content_container_style_has_override(style_object) {
                continue;
            }
            let Some(flex_property) = content_container_positive_flex_property(style_object) else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(CONTENT_CONTAINER_FLEX_MESSAGE)
                    .with_label(flex_property.span()),
            );
        }
    }
}

fn content_container_style_object<'a, 'b>(
    attribute: &'b oxc_ast::ast::JSXAttribute<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b ObjectExpression<'a>> {
    if !matches!(
        &attribute.name,
        JSXAttributeName::Identifier(identifier) if identifier.name == "contentContainerStyle"
    ) {
        return None;
    }
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    let expression = container.expression.as_expression()?.get_inner_expression();
    if let Expression::ObjectExpression(object_expression) = expression {
        return Some(object_expression);
    }
    let member_expression = expression.as_member_expression()?;
    let style_key_name = content_container_static_member_key(member_expression)?;
    let root_identifier = content_container_member_root_identifier(member_expression)?;
    let style_sheet_initializer = identifier_direct_or_default_initializer(root_identifier, ctx)?;
    let Expression::CallExpression(style_sheet_call) =
        style_sheet_initializer.get_inner_expression()
    else {
        return None;
    };
    let Expression::StaticMemberExpression(callee) = &style_sheet_call.callee else {
        return None;
    };
    if callee.property.name != "create"
        || !matches!(&callee.object, Expression::Identifier(identifier) if identifier.name == "StyleSheet")
    {
        return None;
    }
    let Some(Argument::ObjectExpression(style_sheet_map)) = style_sheet_call.arguments.first()
    else {
        return None;
    };
    for property in &style_sheet_map.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        if property.computed
            || content_container_property_key_name(&property.key) != Some(style_key_name)
        {
            continue;
        }
        return match property.value.get_inner_expression() {
            Expression::ObjectExpression(object_expression) => Some(object_expression),
            _ => None,
        };
    }
    None
}

fn content_container_static_member_key<'a, 'b>(
    member_expression: &'b MemberExpression<'a>,
) -> Option<&'b str> {
    match member_expression {
        MemberExpression::StaticMemberExpression(member_expression) => {
            Some(member_expression.property.name.as_str())
        }
        MemberExpression::ComputedMemberExpression(member_expression) => {
            match &member_expression.expression {
                Expression::StringLiteral(literal) => Some(literal.value.as_str()),
                _ => None,
            }
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn content_container_member_root_identifier<'a, 'b>(
    member_expression: &'b MemberExpression<'a>,
) -> Option<&'b oxc_ast::ast::IdentifierReference<'a>> {
    let object = member_expression.object().get_inner_expression();
    match object {
        Expression::Identifier(identifier) => Some(identifier),
        expression => content_container_member_root_identifier(expression.as_member_expression()?),
    }
}

fn content_container_property_key_name<'a>(property_key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match property_key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn content_container_style_has_override(object_expression: &ObjectExpression<'_>) -> bool {
    object_expression.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        !property.computed
            && matches!(
                content_container_property_key_name(&property.key),
                Some("flexGrow" | "flexBasis")
            )
    })
}

fn content_container_positive_flex_property<'a, 'b>(
    object_expression: &'b ObjectExpression<'a>,
) -> Option<&'b ObjectProperty<'a>> {
    for property in &object_expression.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        if property.computed
            || content_container_unquoted_property_key_name(&property.key) != Some("flex")
        {
            continue;
        }
        let Expression::NumericLiteral(literal) = &property.value else {
            return None;
        };
        return (literal.value > 0.0).then_some(property.as_ref());
    }
    None
}

fn content_container_unquoted_property_key_name<'a>(
    property_key: &'a PropertyKey<'a>,
) -> Option<&'a str> {
    match property_key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}
