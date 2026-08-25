use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EXCESSIVE_PILL_TREATMENT_MIN_COUNT: usize = 5;
const SHORT_DECORATIVE_LABEL_MAX_CHARACTERS: usize = 32;
static HORIZONTAL_PADDING_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^px-(?:px|[0-9.]+|\[[^\]]+\])$");

#[derive(Debug, Default, Clone)]
pub struct NoExcessivePillTreatment;

declare_oxc_lint!(
    /// Disallow pages that turn too many short labels into pills.
    NoExcessivePillTreatment,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow excessive pill treatments.",
);

impl Rule for NoExcessivePillTreatment {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_top_level_page_copy_root(element, node, ctx) {
            return;
        }
        let mut elements = Vec::new();
        collect_static_jsx_elements(element, &mut elements);
        let pill_count = elements
            .into_iter()
            .filter(|element| is_pill_treatment(element))
            .count();
        if pill_count < EXCESSIVE_PILL_TREATMENT_MIN_COUNT {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This page turns {pill_count} short labels or actions into rounded pills. Reduce the treatment so important controls and metadata remain distinct."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn is_pill_treatment(element: &oxc_ast::ast::JSXElement<'_>) -> bool {
    let static_text = get_static_jsx_text(element);
    let mut text_segments = static_text
        .split(is_js_whitespace)
        .filter(|segment| !segment.is_empty());
    let Some(first_segment) = text_segments.next() else {
        return false;
    };
    let text_length = text_segments
        .fold(first_segment.encode_utf16().count(), |length, segment| {
            length + 1 + segment.encode_utf16().count()
        });
    if text_length > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS {
        return false;
    }
    let Some(class_name) = get_static_class_name(&element.opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    let utilities = tokens
        .iter()
        .filter(|token| token.variants.is_empty())
        .map(|token| token.utility)
        .collect::<Vec<_>>();
    utilities.contains(&"rounded-full")
        && utilities
            .iter()
            .any(|utility| HORIZONTAL_PADDING_PATTERN.is_match(utility))
        && has_visible_tailwind_fill_or_edge(&utilities)
}
