use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttributeItem, JSXAttributeValue, JSXChild, JSXElementName, JSXExpression,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::UnaryOperator;

use crate::{
    AstNode,
    context::LintContext,
    rule::Rule,
    utils::{get_element_type, has_jsx_prop_ignore_case},
};

const DEFAULT_HEADING_TAGS: [&str; 6] = ["h1", "h2", "h3", "h4", "h5", "h6"];
const MESSAGE: &str = "Blind users can't use this heading to navigate because screen readers skip it empty, so add text, `aria-label`, or `aria-labelledby`.";

#[derive(Debug, Default, Clone)]
pub struct HeadingHasContent;

declare_oxc_lint!(
    /// Require accessible heading content.
    HeadingHasContent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible heading content.",
);

impl Rule for HeadingHasContent {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let element_type = get_element_type(ctx, opening_element);
        if !DEFAULT_HEADING_TAGS.contains(&element_type.as_ref())
            && !configured_heading_components(ctx).is_some_and(|components| {
                components
                    .iter()
                    .any(|component| component == element_type.as_ref())
            })
        {
            return;
        }
        if let AstKind::JSXElement(element) = ctx.nodes().parent_kind(node.id())
            && object_has_accessible_child(element, ctx)
        {
            return;
        }
        if is_hidden_from_screen_reader(opening_element, ctx)
            || ["aria-label", "aria-labelledby"]
                .iter()
                .any(|attribute_name| {
                    has_jsx_prop_ignore_case(opening_element, attribute_name).is_some()
                })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn configured_heading_components<'a>(
    ctx: &'a LintContext<'_>,
) -> Option<&'a Vec<serde_json::Value>> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("headingHasContent"))
        .and_then(|settings| settings.get("components"))
        .and_then(serde_json::Value::as_array)
}

fn object_has_accessible_child<'a>(
    element: &oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    has_accessible_child(&element.children, ctx)
        || attribute_may_have_non_empty_value(
            get_authoritative_jsx_attribute(
                &element.opening_element,
                "dangerouslySetInnerHTML",
                false,
            ),
            false,
        )
        || has_spread_that_may_provide_attribute(
            &element.opening_element,
            "dangerouslySetInnerHTML",
        )
        || attribute_may_have_non_empty_value(
            get_authoritative_jsx_attribute(&element.opening_element, "children", false),
            false,
        )
        || has_spread_that_may_provide_attribute(&element.opening_element, "children")
}

fn has_accessible_child<'a>(children: &[JSXChild<'a>], ctx: &LintContext<'a>) -> bool {
    children.iter().any(|child| match child {
        JSXChild::Text(text) => !text.value.trim().is_empty(),
        JSXChild::Element(element) => element_may_provide_text(element, ctx),
        JSXChild::Fragment(fragment) => has_accessible_child(&fragment.children, ctx),
        JSXChild::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            expression_may_render_text(expression)
        }
        JSXChild::Spread(_) => false,
    })
}

fn element_may_provide_text<'a>(
    element: &oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let opening_element = &element.opening_element;
    if is_hidden_from_screen_reader(opening_element, ctx) {
        return false;
    }
    if matches!(opening_element.name, JSXElementName::MemberExpression(_))
        || matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier)
                if identifier.name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
        )
        || matches!(
            &opening_element.name,
            JSXElementName::IdentifierReference(identifier)
                if identifier.name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
        )
    {
        return true;
    }
    let aria_label = get_authoritative_jsx_attribute(opening_element, "aria-label", false);
    if attribute_may_have_non_empty_value(aria_label, true)
        || (aria_label.is_none()
            && has_spread_that_may_provide_attribute(opening_element, "aria-label"))
    {
        return true;
    }
    if get_element_type(ctx, opening_element) == "img" {
        let alt = get_authoritative_jsx_attribute(opening_element, "alt", false);
        if attribute_may_have_non_empty_value(alt, false)
            || (alt.is_none() && has_spread_that_may_provide_attribute(opening_element, "alt"))
        {
            return true;
        }
    }
    object_has_accessible_child(element, ctx)
}

fn attribute_may_have_non_empty_value(
    attribute: Option<&oxc_ast::ast::JSXAttribute>,
    boolean_values_render: bool,
) -> bool {
    let Some(value) = attribute.and_then(|attribute| attribute.value.as_ref()) else {
        return false;
    };
    match value {
        JSXAttributeValue::StringLiteral(string_literal) => !string_literal.value.trim().is_empty(),
        JSXAttributeValue::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| match expression.get_inner_expression() {
                Expression::BooleanLiteral(_) => boolean_values_render,
                Expression::NumericLiteral(_) => true,
                Expression::StringLiteral(string_literal) => {
                    !string_literal.value.trim().is_empty()
                }
                Expression::UnaryExpression(unary_expression) => {
                    !is_literal_void_expression(unary_expression)
                }
                _ => true,
            }),
        _ => true,
    }
}

fn expression_may_render_text(expression: &Expression) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => false,
        Expression::StringLiteral(string_literal) => !string_literal.value.trim().is_empty(),
        Expression::Identifier(identifier) => identifier.name != "undefined",
        Expression::UnaryExpression(unary_expression) => {
            !is_literal_void_expression(unary_expression)
        }
        _ => true,
    }
}

fn has_spread_that_may_provide_attribute(
    opening_element: &oxc_ast::ast::JSXOpeningElement,
    attribute_name: &str,
) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        let JSXAttributeItem::SpreadAttribute(spread_attribute) = attribute else {
            return false;
        };
        can_expression_override_jsx_attribute(&spread_attribute.argument, attribute_name, false)
    })
}

fn is_hidden_from_screen_reader<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if get_element_type(ctx, opening_element).eq_ignore_ascii_case("input")
        && get_authoritative_jsx_attribute(opening_element, "type", false)
            .and_then(get_direct_static_string_attribute_value)
            .is_some_and(|value| value.eq_ignore_ascii_case("hidden"))
    {
        return true;
    }
    if get_authoritative_jsx_attribute(opening_element, "hidden", false)
        .is_some_and(|attribute| boolean_like_hidden_value(attribute, false))
    {
        return true;
    }
    get_authoritative_jsx_attribute(opening_element, "aria-hidden", false)
        .is_some_and(|attribute| boolean_like_hidden_value(attribute, true))
}

fn boolean_like_hidden_value(
    attribute: &oxc_ast::ast::JSXAttribute,
    requires_true_string: bool,
) -> bool {
    let Some(value) = &attribute.value else {
        return true;
    };
    match value {
        JSXAttributeValue::StringLiteral(string_literal) => {
            if requires_true_string {
                string_literal.value.eq_ignore_ascii_case("true")
            } else {
                !string_literal.value.is_empty()
            }
        }
        JSXAttributeValue::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            match expression.get_inner_expression() {
                Expression::BooleanLiteral(boolean_literal) => boolean_literal.value,
                Expression::StringLiteral(string_literal) => {
                    if requires_true_string {
                        string_literal.value.eq_ignore_ascii_case("true")
                    } else {
                        !string_literal.value.is_empty()
                    }
                }
                Expression::NumericLiteral(numeric_literal) if !requires_true_string => {
                    numeric_literal.value != 0.0 && !numeric_literal.value.is_nan()
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn is_literal_void_expression(unary_expression: &oxc_ast::ast::UnaryExpression) -> bool {
    unary_expression.operator == UnaryOperator::Void
        && unary_expression
            .argument
            .get_inner_expression()
            .is_literal()
}

fn get_direct_static_string_attribute_value<'a>(
    attribute: &'a oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
            JSXExpression::TemplateLiteral(template_literal)
                if template_literal.expressions.is_empty()
                    && template_literal.quasis.len() == 1 =>
            {
                let quasi = &template_literal.quasis[0];
                Some(
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
                )
            }
            _ => None,
        },
        _ => None,
    }
}
