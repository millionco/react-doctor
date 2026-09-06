use oxc_ast::{
    AstKind,
    ast::{JSXAttribute, JSXAttributeItem, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::get_element_type,
};

const MESSAGE: &str = "Users can check several of these radios at once and keyboard users can't arrow between them because they share no `name`. Give every radio in this group the same `name` prop.";

#[derive(Debug, Default, Clone)]
pub struct RadioInputMissingName;

declare_oxc_lint!(
    /// Require radio inputs to have a group name.
    RadioInputMissingName,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require radio inputs to have a group name.",
);

impl Rule for RadioInputMissingName {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening) = node.kind() else {
            return;
        };
        if opening
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let element_type = get_element_type(ctx, opening);
        let is_configured_radio = radio_input_configured_components(ctx)
            .any(|component| component == element_type.as_ref());
        if !is_configured_radio {
            if element_type != "input"
                || find_jsx_attribute(opening, "type").and_then(radio_input_static_string_value)
                    != Some("radio")
            {
                return;
            }
        } else if radio_input_has_named_group_ancestor(node, element_type.as_ref(), ctx) {
            return;
        }
        if find_jsx_attribute(opening, "name")
            .is_some_and(|attribute| radio_input_name_may_create_group(attribute, ctx))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening.span));
    }
}

fn radio_input_configured_components<'a>(
    ctx: &'a LintContext<'_>,
) -> impl Iterator<Item = &'a str> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("radioInputMissingName.radioComponents"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
}

fn radio_input_static_string_value<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(value) => Some(value.value.as_str()),
        _ => None,
    }
}

fn radio_input_name_may_create_group(attribute: &JSXAttribute<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(value) = &attribute.value else {
        return false;
    };
    match value {
        JSXAttributeValue::StringLiteral(value) => !value.value.trim().is_empty(),
        JSXAttributeValue::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return true;
            };
            let expression = expression.get_inner_expression();
            match expression {
                oxc_ast::ast::Expression::BooleanLiteral(_)
                | oxc_ast::ast::Expression::NullLiteral(_) => false,
                oxc_ast::ast::Expression::StringLiteral(value) => !value.value.trim().is_empty(),
                oxc_ast::ast::Expression::Identifier(identifier)
                    if identifier.name == "undefined"
                        && ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .is_none() =>
                {
                    false
                }
                oxc_ast::ast::Expression::UnaryExpression(unary)
                    if is_literal_void_expression(unary) =>
                {
                    false
                }
                _ => true,
            }
        }
        _ => true,
    }
}

fn radio_input_has_named_group_ancestor(
    opening_node: &AstNode<'_>,
    element_type: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let expected_group_name = format!("{element_type}.Group");
    ctx.nodes().ancestors(opening_node.id()).any(|ancestor| {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        crate::utils::get_jsx_element_name(&element.opening_element.name)
            == expected_group_name.as_str()
            && find_jsx_attribute(&element.opening_element, "name")
                .is_some_and(|attribute| radio_input_name_may_create_group(attribute, ctx))
    })
}
