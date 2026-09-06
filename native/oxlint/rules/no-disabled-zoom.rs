use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MINIMUM_ACCESSIBLE_ZOOM_SCALE: f64 = 2.0;
const USER_SCALABLE_MESSAGE: &str = "Your users can't pinch to zoom because user-scalable=no blocks it, which fails accessibility (WCAG 1.4.4). Remove it & fix the layout if it breaks at 200%.";

#[derive(Debug, Default, Clone)]
pub struct NoDisabledZoom;

declare_oxc_lint!(
    /// Disallow viewport settings that prevent zooming.
    NoDisabledZoom,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow viewport settings that prevent zooming.",
);

impl Rule for NoDisabledZoom {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx)
            .is_none_or(|(element_name, _)| element_name != "meta")
        {
            return;
        }
        let Some("viewport") = find_jsx_attribute(opening_element, "name")
            .and_then(|attribute| attribute.value.as_ref())
            .and_then(|value| get_direct_string_literal_attribute_value(value))
        else {
            return;
        };
        let Some(content) = find_jsx_attribute(opening_element, "content")
            .and_then(|attribute| attribute.value.as_ref())
            .and_then(|value| get_direct_string_literal_attribute_value(value))
            .filter(|content| !content.is_empty())
        else {
            return;
        };
        let has_user_scalable_no = has_directive_value_prefix(content, "user-scalable", "no");
        let restrictive_maximum_scale = find_numeric_directive_value(content, "maximum-scale")
            .filter(|value| {
                parse_javascript_float_prefix(value)
                    .is_some_and(|scale| scale < MINIMUM_ACCESSIBLE_ZOOM_SCALE)
            });
        let message = match (has_user_scalable_no, restrictive_maximum_scale) {
            (true, Some(maximum_scale)) => format!(
                "Your users can't pinch to zoom because user-scalable=no & maximum-scale={maximum_scale} block it, which fails accessibility (WCAG 1.4.4). Remove both & fix the layout if it breaks at 200%."
            ),
            (true, None) => USER_SCALABLE_MESSAGE.to_string(),
            (false, Some(maximum_scale)) => format!(
                "Your users can't zoom past 200% because maximum-scale={maximum_scale} blocks it, which fails accessibility (WCAG 1.4.4). Use maximum-scale=5 or remove it."
            ),
            (false, None) => return,
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
    }
}

fn find_directive_value_start<'a>(content: &'a str, directive_name: &str) -> Option<&'a str> {
    content.char_indices().find_map(|(start_index, _)| {
        let candidate = content.get(start_index..)?;
        let (candidate_name, remaining_content) =
            candidate.split_at_checked(directive_name.len())?;
        if !candidate_name.eq_ignore_ascii_case(directive_name) {
            return None;
        }
        let remaining_content =
            remaining_content.trim_start_matches(|character| is_js_whitespace(character));
        let remaining_content = remaining_content.strip_prefix('=')?;
        Some(remaining_content.trim_start_matches(|character| is_js_whitespace(character)))
    })
}

fn find_numeric_directive_value<'a>(content: &'a str, directive_name: &str) -> Option<&'a str> {
    let mut remaining_content = content;
    while let Some(value) = find_directive_value_start(remaining_content, directive_name) {
        let value_end = value
            .char_indices()
            .find_map(|(index, character)| {
                (!character.is_ascii_digit() && character != '.').then_some(index)
            })
            .unwrap_or(value.len());
        if value_end > 0 {
            return Some(&value[..value_end]);
        }
        if value.is_empty() {
            return None;
        }
        let next_character_length = value.chars().next()?.len_utf8();
        remaining_content = &value[next_character_length..];
    }
    None
}

fn has_directive_value_prefix(content: &str, directive_name: &str, prefix: &str) -> bool {
    let mut remaining_content = content;
    while let Some(value) = find_directive_value_start(remaining_content, directive_name) {
        if value
            .get(..prefix.len())
            .is_some_and(|value_prefix| value_prefix.eq_ignore_ascii_case(prefix))
        {
            return true;
        }
        let Some(next_character) = value.chars().next() else {
            return false;
        };
        remaining_content = &value[next_character.len_utf8()..];
    }
    false
}

fn parse_javascript_float_prefix(value: &str) -> Option<f64> {
    (1..=value.len()).rev().find_map(|end_index| {
        value
            .is_char_boundary(end_index)
            .then(|| value[..end_index].parse().ok())
            .flatten()
    })
}
