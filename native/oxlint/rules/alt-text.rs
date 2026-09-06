use oxc_ast::{
    AstKind,
    ast::{JSXAttribute, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, rule::Rule, utils::has_jsx_prop_ignore_case};

const MISSING_ALT_PROP: &str = "Screen reader users cannot access this image without `alt`. Add `alt=\"image_description\"`, or `alt=\"\"` if it is decorative.";
const MISSING_ALT_VALUE: &str = "Screen reader users cannot access this image because its `alt` is empty or invalid. Add a short description, or `alt=\"\"` if it is decorative.";
const ARIA_LABEL_VALUE: &str = "Screen reader users hear nothing here because `aria-label` has no value, so give it a short description.";
const ARIA_LABELLEDBY_VALUE: &str = "Screen reader users hear nothing here because `aria-labelledby` has no value, so point it at the id of the text that labels this.";
const PREFER_ALT: &str = "Screen readers skip a decorative image more reliably with `alt=\"\"` than `role=\"presentation\"`, so use `alt=\"\"` instead.";
const MESSAGE_OBJECT: &str = "Screen reader users cannot use this `<object>` because assistive tech cannot describe it, so add `alt`, `aria-label`, `aria-labelledby`, `title`, or inner fallback text.";
const MESSAGE_AREA: &str = "Blind users can't use this `<area>` of the image map because screen readers can't describe it, so add `alt`, `aria-label`, or `aria-labelledby`.";
const MESSAGE_INPUT_IMAGE: &str = "Blind users can't use this image button because screen readers can't describe it, so add `alt`, `aria-label`, or `aria-labelledby`.";

#[derive(Debug, Default, Clone)]
pub struct AltText;

declare_oxc_lint!(
    /// Require accessible text alternatives for image content.
    AltText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible text alternatives for image content.",
);

impl Rule for AltText {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && (!should_use_curated_port_behavior_host(ctx)
                || !is_generated_image_render_filename(ctx))
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let curated_behavior = should_use_curated_port_behavior(ctx);
        let generated_opening_element_ids = curated_behavior
            .then(|| generated_image_jsx_opening_element_ids(ctx))
            .unwrap_or_default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if curated_behavior
                && (is_local_test_scaffold_jsx(node, ctx)
                    || generated_opening_element_ids.contains(&node.id())
                    || has_any_jsx_spread_attribute(opening_element))
            {
                continue;
            }
            check_opening_element(opening_element, node, curated_behavior, ctx);
        }
    }
}

fn check_opening_element<'a>(
    opening_element: &'a JSXOpeningElement<'a>,
    node: &AstNode<'a>,
    curated_behavior: bool,
    ctx: &LintContext<'a>,
) {
    let element_type = get_element_type(ctx, opening_element);
    let element_type = element_type.as_ref();
    if configured_element_class_enabled(ctx, "img")
        && (element_type == "img" || configured_alias_matches(ctx, "img", element_type))
    {
        if !curated_behavior || !is_hidden_from_screen_reader(opening_element, ctx) {
            check_image(opening_element, ctx);
        }
        return;
    }
    if configured_element_class_enabled(ctx, "object")
        && (element_type == "object" || configured_alias_matches(ctx, "object", element_type))
    {
        if let AstKind::JSXElement(element) = ctx.nodes().parent_kind(node.id()) {
            check_object(opening_element, element, ctx);
        }
        return;
    }
    if configured_element_class_enabled(ctx, "area")
        && (element_type == "area" || configured_alias_matches(ctx, "area", element_type))
    {
        check_area(opening_element, ctx);
        return;
    }
    if configured_element_class_enabled(ctx, "input[type=\"image\"]")
        && ((element_type.eq_ignore_ascii_case("input")
            && has_jsx_prop_ignore_case(opening_element, "type")
                .and_then(JSXAttributeItem::as_attribute)
                .and_then(|attribute| get_string_literal_attribute_value(attribute))
                .is_some_and(|value| value.eq_ignore_ascii_case("image")))
            || configured_alias_matches(ctx, "input[type=\"image\"]", element_type))
    {
        check_input_image(opening_element, ctx);
    }
}

fn check_image(opening_element: &JSXOpeningElement<'_>, ctx: &LintContext<'_>) {
    if let Some(alt_attribute) = jsx_attribute(opening_element, "alt") {
        if !is_valid_alt_attribute(alt_attribute) {
            report(opening_element, MISSING_ALT_VALUE, ctx);
        }
        return;
    }
    if jsx_attribute(opening_element, "role").is_some_and(is_presentation_role) {
        report(opening_element, PREFER_ALT, ctx);
        return;
    }
    if let Some(aria_label_attribute) = jsx_attribute(opening_element, "aria-label") {
        if !aria_label_has_value(aria_label_attribute) {
            report(opening_element, ARIA_LABEL_VALUE, ctx);
        }
        return;
    }
    if let Some(aria_labelledby_attribute) = jsx_attribute(opening_element, "aria-labelledby") {
        if !aria_label_has_value(aria_labelledby_attribute) {
            report(opening_element, ARIA_LABELLEDBY_VALUE, ctx);
        }
        return;
    }
    report(opening_element, MISSING_ALT_PROP, ctx);
}

fn check_object<'a>(
    opening_element: &'a JSXOpeningElement<'a>,
    element: &'a oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
) {
    if ["aria-label", "aria-labelledby"]
        .iter()
        .any(|name| jsx_attribute(opening_element, name).is_some_and(aria_label_has_value))
        || jsx_attribute(opening_element, "title")
            .and_then(|attribute| get_string_literal_attribute_value(attribute))
            .is_some_and(|value| !value.is_empty())
        || object_has_accessible_child(element, ctx)
    {
        return;
    }
    report(opening_element, MESSAGE_OBJECT, ctx);
}

fn check_area(opening_element: &JSXOpeningElement<'_>, ctx: &LintContext<'_>) {
    if has_accessible_aria_label(opening_element) {
        return;
    }
    if jsx_attribute(opening_element, "alt")
        .is_none_or(|attribute| !is_valid_alt_attribute(attribute))
    {
        report(opening_element, MESSAGE_AREA, ctx);
    }
}

fn check_input_image(opening_element: &JSXOpeningElement<'_>, ctx: &LintContext<'_>) {
    if has_accessible_aria_label(opening_element) {
        return;
    }
    if jsx_attribute(opening_element, "alt")
        .is_none_or(|attribute| !is_valid_alt_attribute(attribute))
    {
        report(opening_element, MESSAGE_INPUT_IMAGE, ctx);
    }
}

fn has_accessible_aria_label(opening_element: &JSXOpeningElement<'_>) -> bool {
    ["aria-label", "aria-labelledby"]
        .iter()
        .any(|name| jsx_attribute(opening_element, name).is_some_and(aria_label_has_value))
}

fn jsx_attribute<'a>(
    opening_element: &'a JSXOpeningElement<'a>,
    name: &'a str,
) -> Option<&'a JSXAttribute<'a>> {
    has_jsx_prop_ignore_case(opening_element, name).and_then(JSXAttributeItem::as_attribute)
}

fn is_valid_alt_attribute(attribute: &JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        None => false,
        Some(JSXAttributeValue::ExpressionContainer(container)) => container
            .expression
            .as_expression()
            .is_none_or(|expression| !may_evaluate_to_undefined_or_null(expression)),
        Some(_) => true,
    }
}

fn may_evaluate_to_undefined_or_null(expression: &oxc_ast::ast::Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::Identifier(identifier) => identifier.name == "undefined",
        oxc_ast::ast::Expression::NullLiteral(_) => true,
        oxc_ast::ast::Expression::ConditionalExpression(conditional) => {
            may_evaluate_to_undefined_or_null(&conditional.consequent)
                || may_evaluate_to_undefined_or_null(&conditional.alternate)
        }
        _ => false,
    }
}

fn is_presentation_role(attribute: &JSXAttribute<'_>) -> bool {
    get_string_literal_attribute_value(attribute)
        .is_some_and(|value| matches!(value, "presentation" | "none"))
}

fn aria_label_has_value(attribute: &JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        None => false,
        Some(JSXAttributeValue::StringLiteral(string_literal)) => !string_literal.value.is_empty(),
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::Identifier(identifier) => identifier.name != "undefined",
            JSXExpression::StringLiteral(string_literal) => !string_literal.value.is_empty(),
            _ => true,
        },
        Some(_) => true,
    }
}

fn configured_element_class_enabled(ctx: &LintContext<'_>, element_class: &str) -> bool {
    configured_alt_text_settings(ctx)
        .and_then(|settings| settings.get("elements"))
        .and_then(serde_json::Value::as_array)
        .is_none_or(|elements| {
            elements
                .iter()
                .any(|element| element.as_str() == Some(element_class))
        })
}

fn configured_alias_matches(ctx: &LintContext<'_>, element_class: &str, name: &str) -> bool {
    configured_alt_text_settings(ctx)
        .and_then(|settings| settings.get(element_class))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|aliases| aliases.iter().any(|alias| alias.as_str() == Some(name)))
}

fn configured_alt_text_settings<'a>(
    ctx: &'a LintContext<'_>,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("altText"))
        .and_then(serde_json::Value::as_object)
}

fn report(opening_element: &JSXOpeningElement<'_>, message: &'static str, ctx: &LintContext<'_>) {
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
}
