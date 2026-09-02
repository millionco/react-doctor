use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const REPEATED_SECTION_SHELL_MIN_COUNT: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct NoRepeatedSectionShells;

declare_oxc_lint!(
    /// Disallow repeated padded section shells on one page.
    NoRepeatedSectionShells,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow repeated padded section shells.",
);

impl Rule for NoRepeatedSectionShells {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_top_level_page_copy_root(element, node, ctx) {
            return;
        }
        let section_shell_count = count_repeated_section_shells(&element.children);
        if section_shell_count < REPEATED_SECTION_SHELL_MIN_COUNT {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This page repeats the same large vertical padding and centered max-width wrapper across {section_shell_count} sections. Vary the composition to reflect the content."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn count_repeated_section_shells(children: &[oxc_ast::ast::JSXChild]) -> usize {
    children
        .iter()
        .map(|child| match child {
            oxc_ast::ast::JSXChild::Element(element) => {
                usize::from(is_repeated_section_shell(element))
                    + count_repeated_section_shells(&element.children)
            }
            oxc_ast::ast::JSXChild::Fragment(fragment) => {
                count_repeated_section_shells(&fragment.children)
            }
            _ => 0,
        })
        .sum()
}

fn is_repeated_section_shell(element: &oxc_ast::ast::JSXElement) -> bool {
    let opening_element = &element.opening_element;
    let oxc_ast::ast::JSXElementName::Identifier(identifier) = &opening_element.name else {
        return false;
    };
    if identifier.name != "section" {
        return false;
    }
    let Some(class_name) = get_static_class_name(opening_element) else {
        return false;
    };
    if !tailwind_class_name_tokens(class_name)
        .into_iter()
        .any(|token| token.variants.is_empty() && is_large_vertical_padding(token.utility))
    {
        return false;
    }
    get_static_direct_jsx_elements(element)
        .into_iter()
        .any(is_centered_max_width_container)
}

fn is_large_vertical_padding(utility: &str) -> bool {
    matches!(
        utility,
        "py-12" | "py-14" | "py-16" | "py-18" | "py-20" | "py-24" | "py-28" | "py-30" | "py-32"
    )
}

fn is_centered_max_width_container(element: &oxc_ast::ast::JSXElement) -> bool {
    let Some(class_name) = get_static_class_name(&element.opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    tokens
        .iter()
        .any(|token| token.variants.is_empty() && token.utility == "mx-auto")
        && tokens.iter().any(|token| {
            let Some(max_width) = token.utility.strip_prefix("max-w-") else {
                return false;
            };
            token.variants.is_empty()
                && !max_width.starts_with("full")
                && !max_width.starts_with("none")
        })
}
