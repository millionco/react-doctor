use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SHORT_DECORATIVE_LABEL_MAX_CHARACTERS: usize = 32;
const PREFORMATTED_ELEMENT_NAMES: [&str; 5] = ["code", "kbd", "pre", "samp", "var"];
const MESSAGE: &str = "This persistent navigation label uses uppercase tracking as decoration. Use ordinary interface casing and spacing for faster scanning.";

#[derive(Debug, Default, Clone)]
pub struct NoUppercaseTrackedNavigationLabel;

declare_oxc_lint!(
    /// Disallow uppercase tracking on persistent navigation labels.
    NoUppercaseTrackedNavigationLabel,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow uppercase tracked navigation labels.",
);

impl Rule for NoUppercaseTrackedNavigationLabel {
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
        if PREFORMATTED_ELEMENT_NAMES.contains(&identifier.name.as_str())
            || element
                .children
                .iter()
                .any(|child| matches!(child, oxc_ast::ast::JSXChild::ExpressionContainer(_)))
            || !is_inside_navigation(node, ctx)
        {
            return;
        }
        let text = normalize_js_whitespace(&get_static_jsx_text(element));
        let text_length = text.encode_utf16().count();
        if text.is_empty() || text_length > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let has_uppercase = tokens
            .iter()
            .any(|token| token.variants.is_empty() && token.utility == "uppercase");
        let has_tracking = tokens
            .iter()
            .any(|token| token.variants.is_empty() && token.utility.starts_with("tracking-"));
        if !has_uppercase || !has_tracking {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn normalize_js_whitespace(value: &str) -> String {
    value
        .split(|character| is_js_whitespace(character))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
