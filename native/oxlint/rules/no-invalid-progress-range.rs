use oxc_ast::{ast::JSXAttributeItem, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::UnaryOperator;

use crate::{context::LintContext, rule::Rule, AstNode};

const NATIVE_MESSAGE: &str = "This progress element has an impossible value range, so its visual state and exposed progress can disagree. Use a positive max and keep value between zero and max.";
const ARIA_MESSAGE: &str = "This progressbar exposes an impossible ARIA range. Keep aria-valuemin below aria-valuemax and aria-valuenow within that range.";

#[derive(Debug, Default, Clone)]
pub struct NoInvalidProgressRange;

declare_oxc_lint!(
    /// Disallow impossible native and ARIA progress ranges.
    NoInvalidProgressRange,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow impossible native and ARIA progress ranges.",
);

impl Rule for NoInvalidProgressRange {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let message = if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name)
            == Some("progress")
        {
            has_invalid_native_progress_range(opening_element).then_some(NATIVE_MESSAGE)
        } else {
            let role = get_authoritative_jsx_attribute(opening_element, "role", false)
                .and_then(get_string_literal_attribute_value);
            if role != Some("progressbar") {
                return;
            }
            has_invalid_aria_progress_range(opening_element).then_some(ARIA_MESSAGE)
        };
        let Some(message) = message else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
    }
}

fn get_static_number_attribute_value(
    attribute: Option<&oxc_ast::ast::JSXAttribute>,
) -> Option<f64> {
    let attribute = attribute?;
    if let Some(string_value) = get_string_literal_attribute_value(attribute) {
        return parse_finite_number(string_value);
    }
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) =
        attribute.value.as_ref()?
    else {
        return None;
    };
    let expression = container.expression.as_expression()?.get_inner_expression();
    match expression {
        oxc_ast::ast::Expression::NumericLiteral(number_literal) => number_literal
            .value
            .is_finite()
            .then_some(number_literal.value),
        oxc_ast::ast::Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::UnaryNegation =>
        {
            let oxc_ast::ast::Expression::NumericLiteral(number_literal) =
                unary_expression.argument.get_inner_expression()
            else {
                return None;
            };
            number_literal
                .value
                .is_finite()
                .then_some(-number_literal.value)
        }
        _ => None,
    }
}

fn has_invalid_native_progress_range(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    let value_attribute = get_authoritative_jsx_attribute(opening_element, "value", false);
    let maximum_attribute = get_authoritative_jsx_attribute(opening_element, "max", false);
    let value = get_static_number_attribute_value(value_attribute);
    let maximum = maximum_attribute
        .map(|attribute| get_static_number_attribute_value(Some(attribute)))
        .unwrap_or(Some(1.0));
    if maximum_attribute.is_some() && maximum.is_none() {
        return false;
    }
    let Some(maximum) = maximum else {
        return false;
    };
    maximum <= 0.0 || value.is_some_and(|value| value < 0.0 || value > maximum)
}

fn has_invalid_aria_progress_range(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    let minimum_attribute =
        get_authoritative_jsx_attribute(opening_element, "aria-valuemin", false);
    let maximum_attribute =
        get_authoritative_jsx_attribute(opening_element, "aria-valuemax", false);
    let current_attribute =
        get_authoritative_jsx_attribute(opening_element, "aria-valuenow", false);
    let minimum = minimum_attribute
        .map(|attribute| get_static_number_attribute_value(Some(attribute)))
        .unwrap_or(Some(0.0));
    let maximum = maximum_attribute
        .map(|attribute| get_static_number_attribute_value(Some(attribute)))
        .unwrap_or(Some(100.0));
    if (minimum_attribute.is_some() && minimum.is_none())
        || (maximum_attribute.is_some() && maximum.is_none())
    {
        return false;
    }
    let (Some(minimum), Some(maximum)) = (minimum, maximum) else {
        return false;
    };
    let current = get_static_number_attribute_value(current_attribute);
    minimum >= maximum || current.is_some_and(|current| current < minimum || current > maximum)
}
