use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This text button applies equal padding on every side, which makes the control feel boxy. Use separate horizontal and vertical padding with more space on the inline axis.";

#[derive(Debug, Default, Clone)]
pub struct NoSymmetricTextButtonPadding;

declare_oxc_lint!(
    /// Disallow symmetric padding on static text buttons.
    NoSymmetricTextButtonPadding,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow symmetric text button padding.",
);

impl Rule for NoSymmetricTextButtonPadding {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !matches!(
            &element.opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "button"
        ) || element
            .children
            .iter()
            .any(|child| matches!(child, oxc_ast::ast::JSXChild::ExpressionContainer(_)))
            || get_static_jsx_text(element)
                .trim_matches(|character| is_js_whitespace(character))
                .is_empty()
        {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let has_symmetric_padding = tokens
            .iter()
            .any(|token| token.variants.is_empty() && is_padding_utility(token.utility, "p-"));
        let has_axis_padding = tokens.iter().any(|token| {
            token.variants.is_empty()
                && ["px-", "py-", "pt-", "pr-", "pb-", "pl-", "pe-", "ps-"]
                    .iter()
                    .any(|prefix| is_padding_utility(token.utility, prefix))
        });
        if !has_symmetric_padding || has_axis_padding {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_padding_utility(value: &str, prefix: &str) -> bool {
    let Some(scale) = value.strip_prefix(prefix) else {
        return false;
    };
    scale == "px"
        || (!scale.is_empty()
            && scale
                .bytes()
                .all(|character| character.is_ascii_digit() || character == b'.'))
        || (scale.starts_with('[')
            && scale.ends_with(']')
            && scale.len() > 2
            && !scale[1..scale.len() - 1].contains(']'))
}
