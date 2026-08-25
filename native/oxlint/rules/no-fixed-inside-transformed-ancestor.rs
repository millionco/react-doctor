use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This fixed element sits inside a transformed ancestor, which makes that ancestor its containing block instead of the viewport. Move the overlay outside or use intentional local positioning.";
const TRANSFORM_PROPERTY_NAMES: [&str; 6] = [
    "transform",
    "translate",
    "rotate",
    "scale",
    "perspective",
    "filter",
];
const INERT_TRANSFORM_CLASSES: [&str; 5] = [
    "perspective-none",
    "rotate-none",
    "scale-none",
    "transform-none",
    "translate-none",
];

#[derive(Debug, Default, Clone)]
pub struct NoFixedInsideTransformedAncestor;

declare_oxc_lint!(
    /// Disallow viewport-fixed elements inside transformed ancestors.
    NoFixedInsideTransformedAncestor,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow fixed elements inside transformed ancestors.",
);

impl Rule for NoFixedInsideTransformedAncestor {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if has_jsx_spread_attribute(opening_element) || !is_fixed(opening_element) {
            return;
        }
        let has_transformed_ancestor = ctx.nodes().ancestors(node.id()).skip(1).any(|ancestor| {
            let AstKind::JSXElement(element) = ancestor.kind() else {
                return false;
            };
            let ancestor_opening_element = &element.opening_element;
            let Some((element_type, _)) = resolve_jsx_element_type(ancestor_opening_element, ctx)
            else {
                return false;
            };
            !element_type
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_uppercase)
                && !has_jsx_spread_attribute(ancestor_opening_element)
                && is_transformed(ancestor_opening_element)
        });
        if !has_transformed_ancestor {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn has_jsx_spread_attribute(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)))
}

fn is_fixed(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    has_static_class(opening_element, |utility| utility == "fixed")
        || has_static_inline_property(opening_element, "position", Some("fixed"))
}

fn is_transformed(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    has_static_class(opening_element, |utility| {
        !INERT_TRANSFORM_CLASSES.contains(&utility) && is_transform_class(utility)
    }) || TRANSFORM_PROPERTY_NAMES
        .iter()
        .any(|property_name| has_static_inline_property(opening_element, property_name, None))
}

fn is_transform_class(utility: &str) -> bool {
    utility == "transform"
        || utility.starts_with("transform-")
        || utility.starts_with("translate-")
        || utility.starts_with("rotate-")
        || utility.starts_with("scale-")
        || utility.starts_with("skew-")
        || utility.starts_with("perspective-")
        || utility == "will-change-transform"
}

fn has_static_class(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    predicate: impl Fn(&str) -> bool,
) -> bool {
    get_static_class_name(opening_element).is_some_and(|class_name| {
        tailwind_class_name_tokens(class_name)
            .iter()
            .any(|token| token.variants.is_empty() && predicate(token.utility))
    })
}

fn has_static_inline_property(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    property_name: &str,
    expected_value: Option<&str>,
) -> bool {
    let Some(style) = find_jsx_attribute(opening_element, "style")
        .and_then(|attribute| get_inline_style_object_expression(attribute))
    else {
        return false;
    };
    let Some(property) = get_effective_static_style_property(style, property_name) else {
        return false;
    };
    let string_value = match &property.value {
        Expression::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
        _ => None,
    };
    if let Some(expected_value) = expected_value {
        return string_value == Some(expected_value);
    }
    string_value.map_or_else(
        || get_static_style_property_number_value(property).is_some(),
        |value| value != "none",
    )
}
