use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeName, JSXAttributeValue, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_ecmascript::StringToNumber;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::UnaryOperator;

use crate::{AstNode, context::LintContext, globals::AriaProperty, rule::Rule};

#[derive(Debug, Clone, Copy)]
enum ReactDoctorAriaPropType {
    Boolean,
    OptionalBoolean,
    Tristate,
    String,
    Id,
    IdList,
    Integer,
    Number,
    Token(&'static [&'static str]),
    TokenList(&'static [&'static str]),
}

#[derive(Debug, Default, Clone)]
pub struct AriaProptypes;

declare_oxc_lint!(
    /// Require readable values for ARIA attributes.
    AriaProptypes,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require valid ARIA attribute values.",
);

impl Rule for AriaProptypes {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let JSXAttributeName::Identifier(identifier) = &attribute.name else {
            return;
        };
        let prop_name = identifier.name.to_ascii_lowercase();
        let Ok(aria_property) = AriaProperty::try_from(prop_name.as_str()) else {
            return;
        };
        let prop_type = react_doctor_aria_prop_type(aria_property);
        let is_valid = attribute.value.as_ref().map_or_else(
            || react_doctor_aria_prop_allows_none(prop_type),
            |value| react_doctor_aria_prop_value_is_valid(prop_type, value),
        );
        if !is_valid {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Screen reader users get no help from `{prop_name}` because its value isn't readable, so set it to {}.",
                    react_doctor_aria_prop_expected_description(prop_type)
                ))
                .with_label(attribute.span),
            );
        }
    }
}

fn react_doctor_aria_prop_allows_none(prop_type: ReactDoctorAriaPropType) -> bool {
    match prop_type {
        ReactDoctorAriaPropType::Boolean
        | ReactDoctorAriaPropType::OptionalBoolean
        | ReactDoctorAriaPropType::Tristate
        | ReactDoctorAriaPropType::String => true,
        ReactDoctorAriaPropType::Token(tokens)
        | ReactDoctorAriaPropType::TokenList(tokens) => tokens.contains(&"true"),
        _ => false,
    }
}

fn react_doctor_aria_prop_value_is_valid(
    prop_type: ReactDoctorAriaPropType,
    value: &JSXAttributeValue,
) -> bool {
    if !react_doctor_aria_prop_is_target_literal(value) {
        return true;
    }
    match prop_type {
        ReactDoctorAriaPropType::Boolean | ReactDoctorAriaPropType::OptionalBoolean => {
            react_doctor_parse_aria_prop_value(value, true)
                .is_some_and(|value| matches!(value.as_str(), "true" | "false"))
        }
        ReactDoctorAriaPropType::Tristate => react_doctor_parse_aria_prop_value(value, true)
            .is_some_and(|value| matches!(value.as_str(), "true" | "false" | "mixed")),
        ReactDoctorAriaPropType::String | ReactDoctorAriaPropType::Id => {
            react_doctor_aria_prop_is_interpolated_template(value)
                || react_doctor_parse_aria_prop_value(value, false).is_some()
        }
        ReactDoctorAriaPropType::Integer | ReactDoctorAriaPropType::Number => {
            if let Some(value) = react_doctor_parse_aria_prop_value(value, false) {
                return value.trim().string_to_number().is_finite();
            }
            matches!(
                value,
                JSXAttributeValue::ExpressionContainer(container)
                    if matches!(container.expression, JSXExpression::NumericLiteral(_))
            )
        }
        ReactDoctorAriaPropType::IdList => {
            react_doctor_aria_prop_is_interpolated_template(value)
                || react_doctor_parse_aria_prop_value(value, false)
                    .is_some_and(|value| value.split_whitespace().next().is_some())
        }
        ReactDoctorAriaPropType::Token(tokens) => react_doctor_parse_aria_prop_value(value, true)
            .is_some_and(|value| tokens.contains(&value.as_str())),
        ReactDoctorAriaPropType::TokenList(tokens) => {
            let Some(value) = react_doctor_parse_aria_prop_value(value, true) else {
                return false;
            };
            let mut values = value.split_whitespace().peekable();
            values.peek().is_some() && values.all(|value| tokens.contains(&value))
        }
    }
}

fn react_doctor_parse_aria_prop_value(
    value: &JSXAttributeValue,
    boolean_as_string: bool,
) -> Option<String> {
    match value {
        JSXAttributeValue::StringLiteral(literal) => {
            Some(literal.value.to_ascii_lowercase())
        }
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(literal) => Some(literal.value.to_ascii_lowercase()),
            JSXExpression::TemplateLiteral(template) => {
                Some(template.single_quasi()?.to_ascii_lowercase())
            }
            JSXExpression::BooleanLiteral(literal) if boolean_as_string => {
                Some(literal.value.to_string())
            }
            JSXExpression::UnaryExpression(unary)
                if boolean_as_string && unary.operator == UnaryOperator::LogicalNot =>
            {
                Some((!react_doctor_expression_to_boolean(&unary.argument)?).to_string())
            }
            _ => None,
        },
        _ => None,
    }
}

fn react_doctor_aria_prop_is_interpolated_template(value: &JSXAttributeValue) -> bool {
    matches!(
        value,
        JSXAttributeValue::ExpressionContainer(container)
            if matches!(&container.expression, JSXExpression::TemplateLiteral(template) if template.single_quasi().is_none())
    )
}

fn react_doctor_aria_prop_is_target_literal(value: &JSXAttributeValue) -> bool {
    match value {
        JSXAttributeValue::StringLiteral(_) => true,
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(_)
            | JSXExpression::BooleanLiteral(_)
            | JSXExpression::NumericLiteral(_)
            | JSXExpression::BigIntLiteral(_)
            | JSXExpression::TemplateLiteral(_) => true,
            JSXExpression::UnaryExpression(unary) => {
                unary.operator == UnaryOperator::LogicalNot
                    && react_doctor_expression_to_boolean(&unary.argument).is_some()
            }
            _ => false,
        },
        _ => false,
    }
}

fn react_doctor_expression_to_boolean(expression: &Expression) -> Option<bool> {
    match expression {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::StringLiteral(literal) => Some(!literal.value.is_empty()),
        Expression::NumericLiteral(literal) => {
            Some(literal.value != 0.0 && !literal.value.is_nan())
        }
        Expression::NullLiteral(_) => Some(false),
        Expression::TemplateLiteral(template) => Some(!template.single_quasi()?.is_empty()),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            Some(!react_doctor_expression_to_boolean(&unary.argument)?)
        }
        _ => None,
    }
}

fn react_doctor_aria_prop_type(property: AriaProperty) -> ReactDoctorAriaPropType {
    match property {
        AriaProperty::ActiveDescendant | AriaProperty::Details | AriaProperty::ErrorMessage => {
            ReactDoctorAriaPropType::Id
        }
        AriaProperty::Atomic
        | AriaProperty::Busy
        | AriaProperty::Disabled
        | AriaProperty::Modal
        | AriaProperty::Multiline
        | AriaProperty::Multiselectable
        | AriaProperty::Readonly
        | AriaProperty::Required => ReactDoctorAriaPropType::Boolean,
        AriaProperty::BrailleLabel
        | AriaProperty::BrailleRoleDescription
        | AriaProperty::Description
        | AriaProperty::KeyShortcuts
        | AriaProperty::Label
        | AriaProperty::Placeholder
        | AriaProperty::RoleDescription
        | AriaProperty::ValueText => ReactDoctorAriaPropType::String,
        AriaProperty::Checked | AriaProperty::Pressed => ReactDoctorAriaPropType::Tristate,
        AriaProperty::ColCount
        | AriaProperty::ColIndex
        | AriaProperty::ColSpan
        | AriaProperty::Level
        | AriaProperty::PosInSet
        | AriaProperty::RowCount
        | AriaProperty::RowIndex
        | AriaProperty::RowSpan
        | AriaProperty::SetSize => ReactDoctorAriaPropType::Integer,
        AriaProperty::Controls
        | AriaProperty::DescribedBy
        | AriaProperty::FlowTo
        | AriaProperty::LabelledBy
        | AriaProperty::Owns => ReactDoctorAriaPropType::IdList,
        AriaProperty::Expanded
        | AriaProperty::Grabbed
        | AriaProperty::Hidden
        | AriaProperty::Selected => ReactDoctorAriaPropType::OptionalBoolean,
        AriaProperty::ValueMax | AriaProperty::ValueMin | AriaProperty::ValueNow => {
            ReactDoctorAriaPropType::Number
        }
        AriaProperty::AutoComplete => {
            ReactDoctorAriaPropType::Token(&["none", "inline", "list", "both"])
        }
        AriaProperty::Current => ReactDoctorAriaPropType::Token(&[
            "page", "step", "location", "date", "time", "true", "false",
        ]),
        AriaProperty::HasPopup => ReactDoctorAriaPropType::Token(&[
            "false", "true", "menu", "listbox", "tree", "grid", "dialog",
        ]),
        AriaProperty::Invalid => {
            ReactDoctorAriaPropType::Token(&["grammar", "false", "spelling", "true"])
        }
        AriaProperty::Live => {
            ReactDoctorAriaPropType::Token(&["assertive", "off", "polite"])
        }
        AriaProperty::Orientation => {
            ReactDoctorAriaPropType::Token(&["horizontal", "undefined", "vertical"])
        }
        AriaProperty::Sort => {
            ReactDoctorAriaPropType::Token(&["ascending", "descending", "none", "other"])
        }
        AriaProperty::DropEffect => ReactDoctorAriaPropType::TokenList(&[
            "copy", "execute", "link", "move", "none", "popup",
        ]),
        AriaProperty::Relevant => {
            ReactDoctorAriaPropType::TokenList(&["additions", "all", "removals", "text"])
        }
    }
}

fn react_doctor_aria_prop_expected_description(prop_type: ReactDoctorAriaPropType) -> String {
    match prop_type {
        ReactDoctorAriaPropType::Boolean | ReactDoctorAriaPropType::OptionalBoolean => {
            "'true' or 'false'".to_string()
        }
        ReactDoctorAriaPropType::Tristate => "'true', 'false', or 'mixed'".to_string(),
        ReactDoctorAriaPropType::String => "a string value".to_string(),
        ReactDoctorAriaPropType::Integer => "an integer value".to_string(),
        ReactDoctorAriaPropType::Number => "a number value".to_string(),
        ReactDoctorAriaPropType::Id => "a single element ID".to_string(),
        ReactDoctorAriaPropType::IdList => {
            "a space-separated list of element IDs".to_string()
        }
        ReactDoctorAriaPropType::Token(tokens) => format!("one of: {}", tokens.join(", ")),
        ReactDoctorAriaPropType::TokenList(tokens) => {
            format!("a space-separated list of: {}", tokens.join(", "))
        }
    }
}
