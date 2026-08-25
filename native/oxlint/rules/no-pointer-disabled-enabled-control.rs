use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This enabled control disables pointer events, so mouse and touch users cannot operate it. Remove `pointer-events: none` or mark the control unavailable.";

#[derive(Debug, Default, Clone)]
pub struct NoPointerDisabledEnabledControl;

declare_oxc_lint!(
    /// Disallow pointer-disabled controls that remain keyboard enabled.
    NoPointerDisabledEnabledControl,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow pointer-disabled enabled controls.",
);

impl Rule for NoPointerDisabledEnabledControl {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &opening_element.name else {
            return;
        };
        let tag_name = identifier.name.as_str();
        if !["a", "button", "input", "select", "textarea"].contains(&tag_name)
            || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            })
            || ["aria-disabled", "disabled", "hidden", "inert"]
                .iter()
                .any(|attribute_name| {
                    find_jsx_attribute_ignore_case(opening_element, attribute_name).is_some()
                })
            || tag_name == "input" && !is_provably_non_hidden_input(opening_element, ctx)
            || !is_focusable_jsx_opening_element(opening_element, tag_name, false)
        {
            return;
        }

        let class_name_attribute = find_jsx_attribute(opening_element, "className");
        let class_name = class_name_attribute.and_then(|_| get_static_class_name(opening_element));
        if class_name_attribute.is_some() && class_name.is_none() {
            return;
        }
        let style_attribute = find_jsx_attribute(opening_element, "style");
        let style =
            style_attribute.and_then(|attribute| get_inline_style_object_expression(attribute));
        if style_attribute.is_some()
            && style.is_none_or(|style| {
                style.properties.iter().any(|property| match property {
                    oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
                        property.key.static_name().is_none()
                    }
                    oxc_ast::ast::ObjectPropertyKind::SpreadProperty(_) => true,
                })
            })
        {
            return;
        }

        let has_pointer_disabled_class = class_name.is_some_and(|class_name| {
            tailwind_class_name_tokens(class_name)
                .iter()
                .any(|token| token.variants.is_empty() && token.utility == "pointer-events-none")
        });
        let pointer_events_property =
            style.and_then(|style| get_effective_static_style_property(style, "pointerEvents"));
        let has_pointer_disabled = if let Some(property) = pointer_events_property {
            let oxc_ast::ast::Expression::StringLiteral(value) = &property.value else {
                return;
            };
            value.value == "none"
        } else {
            has_pointer_disabled_class
        };
        if !has_pointer_disabled {
            return;
        }
        let diagnostic_span = pointer_events_property.map_or_else(
            || class_name_attribute.map_or(opening_element.span, |attribute| attribute.span),
            |property| property.span,
        );
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(diagnostic_span));
    }
}

fn find_jsx_attribute_ignore_case<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    target_name: &str,
) -> Option<&'b oxc_ast::ast::JSXAttribute<'a>> {
    opening_element.attributes.iter().find_map(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        matches!(
            &attribute.name,
            oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                if identifier.name.eq_ignore_ascii_case(target_name)
        )
        .then_some(attribute.as_ref())
    })
}

fn is_provably_non_hidden_input<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(type_attribute) = find_jsx_attribute_ignore_case(opening_element, "type") else {
        return true;
    };
    get_static_jsx_attribute_string_values(type_attribute, ctx).is_some_and(|values| {
        values
            .iter()
            .all(|value| !value.eq_ignore_ascii_case("hidden"))
    })
}
