use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TITLE_CONTROL_ELEMENTS: [&str; 3] = ["a", "button", "summary"];
const MESSAGE: &str = "This title tooltip repeats text that is already visible on the control. Remove it so pointer users do not get redundant help.";

#[derive(Debug, Default, Clone)]
pub struct NoRedundantTitleTooltip;

declare_oxc_lint!(
    /// Disallow title tooltips that repeat visible control text.
    NoRedundantTitleTooltip,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow redundant title tooltips.",
);

impl Rule for NoRedundantTitleTooltip {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if !TITLE_CONTROL_ELEMENTS.contains(&identifier.name.as_str())
            || element
                .children
                .iter()
                .any(|child| matches!(child, oxc_ast::ast::JSXChild::ExpressionContainer(_)))
        {
            return;
        }
        let Some(title_attribute) =
            get_authoritative_jsx_attribute(&element.opening_element, "title", false)
        else {
            return;
        };
        let Some(title) = get_string_literal_attribute_value(title_attribute) else {
            return;
        };
        let normalized_title = normalize_text(title);
        let normalized_visible_text = normalize_text(&get_static_jsx_text(element));
        if normalized_title.is_empty()
            || normalized_visible_text.is_empty()
            || normalized_title != normalized_visible_text
        {
            return;
        }
        if get_static_class_name(&element.opening_element).is_some_and(|class_name| {
            tailwind_class_name_tokens(class_name).iter().any(|token| {
                token.variants.is_empty()
                    && (token.utility == "truncate"
                        || token.utility == "text-ellipsis"
                        || token.utility.starts_with("line-clamp-"))
            })
        }) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(title_attribute.span));
    }
}

fn normalize_text(value: &str) -> String {
    value
        .split(|character| is_js_whitespace(character))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
