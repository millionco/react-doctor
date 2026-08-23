use std::collections::HashSet;

use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct IframeTitleUnique;

declare_oxc_lint!(
    /// Require unique frame titles within one static JSX tree.
    IframeTitleUnique,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require unique frame titles within one static JSX tree.",
);

impl Rule for IframeTitleUnique {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let Some(opening_elements) = get_static_jsx_tree_opening_elements(node, ctx) else {
            return;
        };
        let mut seen_titles = HashSet::new();
        for opening_element in opening_elements {
            let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
                continue;
            };
            if element_type != "iframe" && element_type != "frame" {
                continue;
            }
            let Some(title_attribute) =
                get_authoritative_jsx_attribute(opening_element, "title", false)
            else {
                continue;
            };
            let Some(raw_title) = get_string_literal_attribute_value(title_attribute) else {
                continue;
            };
            let normalized_title = normalize_frame_title(raw_title);
            if normalized_title.is_empty() || seen_titles.insert(normalized_title) {
                continue;
            }
            let trimmed_title = raw_title.trim_matches(is_js_whitespace);
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Another frame in this static JSX tree already uses the title \"{trimmed_title}\". Give each frame a title that identifies its distinct purpose."
                ))
                .with_label(title_attribute.span),
            );
        }
    }
}

fn normalize_frame_title(title: &str) -> String {
    let mut normalized_title = String::new();
    let mut has_pending_space = false;
    for character in title.chars() {
        if is_js_whitespace(character) {
            has_pending_space = !normalized_title.is_empty();
            continue;
        }
        if has_pending_space {
            normalized_title.push(' ');
            has_pending_space = false;
        }
        normalized_title.extend(character.to_lowercase());
    }
    normalized_title
}
