use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TRAFFIC_LIGHT_COLORS: [&str; 3] = ["red", "yellow", "green"];
const TRAFFIC_LIGHT_SIZES: [&str; 5] = ["size-2", "size-2.5", "size-3", "size-3.5", "size-4"];
const MESSAGE: &str = "This preview recreates browser traffic-light controls as decoration. Let the product image carry the demonstration without imitation chrome.";

#[derive(Debug, Default, Clone)]
pub struct NoFakeBrowserChrome;

declare_oxc_lint!(
    /// Disallow decorative browser traffic-light controls in framed previews.
    NoFakeBrowserChrome,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow decorative browser chrome.",
);

impl Rule for NoFakeBrowserChrome {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let is_framed_preview = tokens
            .iter()
            .any(|token| token.variants.is_empty() && token.utility == "overflow-hidden")
            && tokens.iter().any(|token| {
                token.variants.is_empty()
                    && (token.utility == "rounded" || token.utility.starts_with("rounded-"))
            })
            && tokens.iter().any(|token| {
                token.variants.is_empty()
                    && (token.utility == "border" || token.utility.starts_with("border-"))
            });
        if !is_framed_preview || !contains_traffic_light_group(element) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn contains_traffic_light_group(element: &oxc_ast::ast::JSXElement) -> bool {
    let direct_elements = get_static_direct_jsx_elements(element);
    if direct_elements.len() == TRAFFIC_LIGHT_COLORS.len()
        && direct_elements
            .iter()
            .zip(TRAFFIC_LIGHT_COLORS)
            .all(|(child, color)| is_traffic_light(child, color))
    {
        return true;
    }
    direct_elements
        .iter()
        .any(|child| contains_traffic_light_group(child))
}

fn is_traffic_light(element: &oxc_ast::ast::JSXElement, color: &str) -> bool {
    if !get_static_jsx_text(element)
        .trim_matches(|character| is_js_whitespace(character))
        .is_empty()
    {
        return false;
    }
    let Some(class_name) = get_static_class_name(&element.opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    tokens
        .iter()
        .any(|token| token.variants.is_empty() && token.utility == "rounded-full")
        && tokens
            .iter()
            .any(|token| token.variants.is_empty() && TRAFFIC_LIGHT_SIZES.contains(&token.utility))
        && tokens.iter().any(|token| {
            token.variants.is_empty() && matches_traffic_light_color(token.utility, color)
        })
}

fn matches_traffic_light_color(utility: &str, color: &str) -> bool {
    ["400", "500", "600"]
        .iter()
        .any(|shade| utility == format!("bg-{color}-{shade}"))
}
