use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This control remains keyboard-focusable inside an aria-hidden subtree, so focus can move to content assistive technology cannot perceive. Remove it from the tab order or stop hiding its ancestor.";
const BOOTSTRAP_MODAL_DISMISS_ATTRIBUTE_NAMES: [&str; 2] =
    ["data-bs-dismiss", "data-dismiss"];

#[derive(Debug, Default, Clone)]
pub struct NoFocusableContentInAriaHidden;

declare_oxc_lint!(
    /// Disallow focusable content inside an aria-hidden subtree.
    NoFocusableContentInAriaHidden,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow focusable content inside an aria-hidden subtree.",
);

impl Rule for NoFocusableContentInAriaHidden {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let element_type = resolve_jsx_element_type_name(opening_element, ctx);
        if element_type
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
            || !is_focusable_jsx_opening_element(opening_element, &element_type, false)
        {
            return;
        }
        let Some(hidden_ancestor) = hidden_aria_ancestor(node, ctx) else {
            return;
        };
        if is_bootstrap_managed_modal(hidden_ancestor) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn hidden_aria_ancestor<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::JSXElement<'a>> {
    ctx.nodes()
        .ancestors(node.id())
        .skip(1)
        .find_map(|ancestor| {
            let AstKind::JSXElement(element) = ancestor.kind() else {
                return None;
            };
            is_statically_aria_hidden(&element.opening_element).then_some(element)
        })
}

fn is_statically_aria_hidden(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let oxc_ast::ast::JSXElementName::Identifier(identifier) = &opening_element.name else {
        return false;
    };
    if identifier
        .name
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_uppercase)
    {
        return false;
    }
    let Some(attribute) =
        get_authoritative_jsx_attribute(opening_element, "aria-hidden", false)
    else {
        return false;
    };
    match attribute.value.as_ref() {
        None => true,
        Some(oxc_ast::ast::JSXAttributeValue::StringLiteral(literal)) => literal.value == "true",
        Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) => matches!(
            &container.expression,
            oxc_ast::ast::JSXExpression::BooleanLiteral(literal) if literal.value
        ) || matches!(
            &container.expression,
            oxc_ast::ast::JSXExpression::StringLiteral(literal) if literal.value == "true"
        ),
        _ => false,
    }
}

fn is_bootstrap_managed_modal(
    element: &oxc_ast::ast::JSXElement<'_>,
) -> bool {
    let opening_element = &element.opening_element;
    let Some(class_name) = get_authoritative_jsx_attribute(opening_element, "className", false)
        .and_then(|attribute| get_string_literal_attribute_value(attribute))
    else {
        return false;
    };
    if !tailwind_class_name_tokens(class_name)
        .iter()
        .any(|token| token.raw_token == "modal")
    {
        return false;
    }
    get_static_jsx_descendant_opening_elements(element, false)
        .into_iter()
        .any(|descendant| {
            BOOTSTRAP_MODAL_DISMISS_ATTRIBUTE_NAMES
                .iter()
                .any(|attribute_name| {
                    get_authoritative_jsx_attribute(descendant, attribute_name, false)
                        .and_then(|attribute| get_string_literal_attribute_value(attribute))
                        == Some("modal")
                })
        })
}
