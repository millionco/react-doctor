use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MINIMUM_FORM_CONTROL_FONT_SIZE_PX: f64 = 16.0;
const FORM_CONTROL_TAG_NAMES: [&str; 3] = ["input", "select", "textarea"];
const NON_TEXTUAL_INPUT_TYPES: [&str; 10] = [
    "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
];

#[derive(Debug, Default, Clone)]
pub struct NoSmallFormControlText;

declare_oxc_lint!(
    /// Disallow mobile form-control text smaller than 16px.
    NoSmallFormControlText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow small mobile form-control text.",
);

impl Rule for NoSmallFormControlText {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some((tag_name, _)) = resolve_jsx_element_type(opening_element, ctx) else {
            return;
        };
        if !FORM_CONTROL_TAG_NAMES.contains(&tag_name) {
            return;
        }
        if tag_name == "input" && !is_textual_input(opening_element) {
            return;
        }
        let class_name = get_static_class_name(opening_element);
        let has_tailwind = has_capability_or_unspecified(ctx, "tailwind");
        if let Some(class_name) = class_name
            && has_tailwind
        {
            let Some(visibility_at_breakpoints) =
                get_tailwind_visibility_at_breakpoints(class_name)
            else {
                return;
            };
            if !visibility_at_breakpoints[0] && !visibility_at_breakpoints[1] {
                return;
            }
        }
        let Some(effective_size) = get_static_effective_font_size(opening_element, has_tailwind)
        else {
            return;
        };
        if effective_size <= 0.0 || effective_size >= MINIMUM_FORM_CONTROL_FONT_SIZE_PX {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This {tag_name} uses {effective_size}px text on mobile. Use at least {MINIMUM_FORM_CONTROL_FONT_SIZE_PX}px for readable controls and stable mobile focus."
            ))
            .with_label(opening_element.span),
        );
    }
}

fn is_textual_input(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    let type_attribute = get_authoritative_jsx_attribute(opening_element, "type", true);
    let Some(type_attribute) = type_attribute else {
        return find_jsx_attribute(opening_element, "type").is_none()
            && !opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            });
    };
    if let Some(input_type) = get_string_literal_attribute_value(type_attribute) {
        let lowercase_input_type = input_type.to_ascii_lowercase();
        return !NON_TEXTUAL_INPUT_TYPES.contains(&lowercase_input_type.as_str());
    }
    is_statically_omitted_input_type(type_attribute)
}

fn is_statically_omitted_input_type(attribute: &oxc_ast::ast::JSXAttribute) -> bool {
    let Some(value) = &attribute.value else {
        return true;
    };
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) = value else {
        return false;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::NullLiteral(_) => true,
        oxc_ast::ast::Expression::Identifier(identifier) => identifier.name == "undefined",
        oxc_ast::ast::Expression::UnaryExpression(unary_expression) => {
            unary_expression.operator == oxc_syntax::operator::UnaryOperator::Void
        }
        oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) => !boolean_literal.value,
        _ => false,
    }
}
