use std::collections::HashSet;

use oxc_ast::{
    ast::{JSXAttribute, JSXAttributeValue, JSXExpression, JSXOpeningElement},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::{get_element_type, get_jsx_element_name, has_jsx_prop_ignore_case},
    AstNode,
};

const MESSAGE_MISSING_HREF: &str = "Keyboard users can't reach this link because it has no `href`, so add a real `href` (or use `<button>` for actions).";
const MESSAGE_INCORRECT_HREF: &str = "Keyboard users can't reach this link because its `href` goes nowhere (`#`, `javascript:`, or empty), so point it at a real destination.";
const MESSAGE_CANT_BE_ANCHOR: &str = "Keyboard users can't trigger this link because it's a click handler with no real `href`, so use `<button>` instead.";

#[derive(Debug, Default, Clone)]
pub struct AnchorIsValid;

#[derive(Debug)]
struct AnchorIsValidSettings {
    valid_hrefs: HashSet<String>,
    href_attribute_names: Vec<String>,
    components: HashSet<String>,
    aspects: Option<HashSet<String>>,
    curated_behavior: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum HrefValueKind {
    Nullish,
    Invalid,
    Valid,
}

declare_oxc_lint!(
    /// Require anchors to have reachable destinations and button semantics for actions.
    AnchorIsValid,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require anchors to have valid destinations.",
);

impl Rule for AnchorIsValid {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && (!should_use_curated_port_behavior_host(ctx) || !is_non_production_file(ctx))
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = resolve_anchor_is_valid_settings(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            check_anchor_is_valid(opening_element, node, &settings, ctx);
        }
    }
}

fn check_anchor_is_valid<'a>(
    opening_element: &JSXOpeningElement<'a>,
    node: &AstNode<'a>,
    settings: &AnchorIsValidSettings,
    ctx: &LintContext<'a>,
) {
    let element_type = get_element_type(ctx, opening_element);
    if element_type != "a"
        && (settings.curated_behavior
            || !settings
                .components
                .contains(get_jsx_element_name(&opening_element.name).as_ref()))
    {
        return;
    }
    if settings.curated_behavior {
        check_curated_anchor(opening_element, node, settings, ctx);
    } else {
        check_upstream_anchor(opening_element, settings, ctx);
    }
}

fn check_curated_anchor<'a>(
    opening_element: &JSXOpeningElement<'a>,
    node: &AstNode<'a>,
    settings: &AnchorIsValidSettings,
    ctx: &LintContext<'a>,
) {
    let href_attribute = settings
        .href_attribute_names
        .iter()
        .find_map(|attribute_name| {
            has_jsx_prop_ignore_case(opening_element, attribute_name)
                .and_then(oxc_ast::ast::JSXAttributeItem::as_attribute)
        });
    if let Some(href_attribute) = href_attribute {
        let Some(href_value) = href_attribute.value.as_ref() else {
            report_anchor_is_valid(opening_element, MESSAGE_INCORRECT_HREF, ctx);
            return;
        };
        let href_candidates = get_static_jsx_attribute_string_values(href_attribute, ctx);
        let every_candidate_is_invalid = href_candidates.as_ref().is_some_and(|candidates| {
            !candidates.is_empty()
                && candidates
                    .iter()
                    .all(|candidate| is_invalid_anchor_href(candidate, &settings.valid_hrefs))
        }) || (href_candidates.is_none()
            && is_nullish_or_fragment_href(href_value));
        if every_candidate_is_invalid {
            let has_on_click = has_jsx_prop_ignore_case(opening_element, "onclick").is_some();
            if !has_on_click
                && href_candidates
                    .as_ref()
                    .is_some_and(|candidates| candidates.iter().all(|candidate| candidate == "#"))
            {
                return;
            }
            report_anchor_is_valid(
                opening_element,
                if has_on_click {
                    MESSAGE_CANT_BE_ANCHOR
                } else {
                    MESSAGE_INCORRECT_HREF
                },
                ctx,
            );
        }
        return;
    }
    if has_any_jsx_spread_attribute(opening_element)
        || is_direct_child_of_link_component(node, ctx)
        || is_keyboard_operable_widget_anchor(opening_element)
    {
        return;
    }
    report_anchor_is_valid(opening_element, MESSAGE_MISSING_HREF, ctx);
}

fn check_upstream_anchor(
    opening_element: &JSXOpeningElement<'_>,
    settings: &AnchorIsValidSettings,
    ctx: &LintContext<'_>,
) {
    let mut has_href = false;
    let mut has_invalid_href = false;
    for attribute_name in &settings.href_attribute_names {
        let Some(attribute) = has_jsx_prop_ignore_case(opening_element, attribute_name)
            .and_then(oxc_ast::ast::JSXAttributeItem::as_attribute)
        else {
            continue;
        };
        match upstream_href_value_kind(attribute) {
            HrefValueKind::Nullish => {}
            HrefValueKind::Invalid => {
                has_href = true;
                has_invalid_href = true;
            }
            HrefValueKind::Valid => has_href = true,
        }
    }
    let has_spread = has_any_jsx_spread_attribute(opening_element);
    let has_on_click = has_jsx_prop_ignore_case(opening_element, "onclick").is_some();
    if !has_href {
        if !has_spread
            && has_anchor_is_valid_aspect(settings, "noHref")
            && (!has_on_click || !has_anchor_is_valid_aspect(settings, "preferButton"))
        {
            report_anchor_is_valid(opening_element, MESSAGE_MISSING_HREF, ctx);
        }
        if !has_spread && has_on_click && has_anchor_is_valid_aspect(settings, "preferButton") {
            report_anchor_is_valid(opening_element, MESSAGE_CANT_BE_ANCHOR, ctx);
        }
        return;
    }
    if has_invalid_href {
        if has_on_click && has_anchor_is_valid_aspect(settings, "preferButton") {
            report_anchor_is_valid(opening_element, MESSAGE_CANT_BE_ANCHOR, ctx);
        } else if has_anchor_is_valid_aspect(settings, "invalidHref") {
            report_anchor_is_valid(opening_element, MESSAGE_INCORRECT_HREF, ctx);
        }
    }
}

fn upstream_href_value_kind(attribute: &JSXAttribute<'_>) -> HrefValueKind {
    let Some(value) = attribute.value.as_ref() else {
        return HrefValueKind::Nullish;
    };
    match value {
        JSXAttributeValue::StringLiteral(string_literal) => {
            upstream_href_string_kind(string_literal.value.as_str())
        }
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::Identifier(identifier) if identifier.name == "undefined" => {
                HrefValueKind::Nullish
            }
            JSXExpression::NullLiteral(_) => HrefValueKind::Nullish,
            JSXExpression::StringLiteral(string_literal) => {
                upstream_href_string_kind(string_literal.value.as_str())
            }
            JSXExpression::TemplateLiteral(template_literal)
                if template_literal.expressions.is_empty()
                    && template_literal.quasis.len() == 1 =>
            {
                let quasi = &template_literal.quasis[0];
                upstream_href_string_kind(
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
                )
            }
            _ => HrefValueKind::Valid,
        },
        JSXAttributeValue::Fragment(_) => HrefValueKind::Nullish,
        _ => HrefValueKind::Valid,
    }
}

fn upstream_href_string_kind(value: &str) -> HrefValueKind {
    if is_intrinsically_invalid_anchor_href(value) {
        HrefValueKind::Invalid
    } else {
        HrefValueKind::Valid
    }
}

fn is_nullish_or_fragment_href(value: &JSXAttributeValue<'_>) -> bool {
    matches!(value, JSXAttributeValue::Fragment(_))
        || matches!(
            value,
            JSXAttributeValue::ExpressionContainer(container)
                if matches!(
                    &container.expression,
                    JSXExpression::Identifier(identifier) if identifier.name == "undefined"
                ) || matches!(&container.expression, JSXExpression::NullLiteral(_))
        )
}

fn is_invalid_anchor_href(value: &str, valid_hrefs: &HashSet<String>) -> bool {
    !valid_hrefs.contains(value) && is_intrinsically_invalid_anchor_href(value)
}

fn is_intrinsically_invalid_anchor_href(value: &str) -> bool {
    let without_leading_non_word = value.trim_start_matches(|character: char| {
        !character.is_ascii_alphanumeric() && character != '_'
    });
    value.is_empty() || value == "#" || without_leading_non_word.starts_with("javascript:")
}

fn is_direct_child_of_link_component(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let element_node = ctx.nodes().parent_node(node.id());
    if !matches!(element_node.kind(), AstKind::JSXElement(_)) {
        return false;
    }
    let wrapper_node = ctx.nodes().parent_node(element_node.id());
    let AstKind::JSXElement(wrapper) = wrapper_node.kind() else {
        return false;
    };
    let wrapper_name = get_jsx_element_name(&wrapper.opening_element.name);
    let last_segment = wrapper_name
        .rsplit('.')
        .next()
        .unwrap_or(wrapper_name.as_ref());
    last_segment == "Link" || (last_segment.ends_with("Link") && last_segment.len() > 4)
}

fn is_keyboard_operable_widget_anchor(opening_element: &JSXOpeningElement<'_>) -> bool {
    has_jsx_prop_ignore_case(opening_element, "role").is_some()
        && has_jsx_prop_ignore_case(opening_element, "tabindex").is_some()
        && (has_jsx_prop_ignore_case(opening_element, "onkeydown").is_some()
            || has_jsx_prop_ignore_case(opening_element, "onkeyup").is_some())
}

fn has_anchor_is_valid_aspect(settings: &AnchorIsValidSettings, aspect: &str) -> bool {
    settings
        .aspects
        .as_ref()
        .is_none_or(|aspects| aspects.contains(aspect))
}

fn resolve_anchor_is_valid_settings(ctx: &LintContext<'_>) -> AnchorIsValidSettings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("anchorIsValid"))
        .and_then(serde_json::Value::as_object);
    let string_array = |name| {
        rule_settings
            .and_then(|settings| settings.get(name))
            .and_then(serde_json::Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
    };
    let mut href_attribute_names = ctx.settings().jsx_a11y.attributes.get("href").map_or_else(
        || vec!["href".to_string()],
        |names| names.iter().map(ToString::to_string).collect(),
    );
    href_attribute_names.extend(string_array("specialLink").unwrap_or_default());
    AnchorIsValidSettings {
        valid_hrefs: string_array("validHrefs")
            .unwrap_or_default()
            .into_iter()
            .collect(),
        href_attribute_names,
        components: string_array("components")
            .unwrap_or_default()
            .into_iter()
            .collect(),
        aspects: string_array("aspects").map(|aspects| aspects.into_iter().collect()),
        curated_behavior: should_use_curated_port_behavior(ctx),
    }
}

fn report_anchor_is_valid(
    opening_element: &JSXOpeningElement<'_>,
    message: &'static str,
    ctx: &LintContext<'_>,
) {
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.name.span()));
}
