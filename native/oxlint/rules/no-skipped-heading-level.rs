use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct NoSkippedHeadingLevel;

declare_oxc_lint!(
    /// Disallow heading hierarchies that skip a level.
    NoSkippedHeadingLevel,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow heading hierarchies that skip a level.",
);

impl Rule for NoSkippedHeadingLevel {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_document_root(&element.opening_element)
            || ctx.nodes().ancestors(node.id()).any(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::JSXElement(ancestor_element)
                        if is_document_root(&ancestor_element.opening_element)
                )
            })
        {
            return;
        }
        let mut opening_elements = vec![element.opening_element.as_ref()];
        collect_static_jsx_opening_elements(&element.children, &mut opening_elements);
        let mut previous_heading_level = None;
        for opening_element in opening_elements {
            let Some(heading_level) = get_heading_level(opening_element) else {
                continue;
            };
            if let Some(previous_level) = previous_heading_level
                && heading_level > previous_level + 1
            {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This heading jumps from h{previous_level} to h{heading_level}. Use the next level so the document outline stays coherent."
                    ))
                    .with_label(opening_element.span),
                );
            }
            previous_heading_level = Some(heading_level);
        }
    }
}

fn get_raw_element_name<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
) -> Option<&'a str> {
    let JSXElementName::Identifier(identifier) = &opening_element.name else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn is_document_root(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    matches!(get_raw_element_name(opening_element), Some("article" | "main"))
}

fn get_heading_level(opening_element: &oxc_ast::ast::JSXOpeningElement) -> Option<u8> {
    let element_name = get_raw_element_name(opening_element)?;
    let element_name_bytes = element_name.as_bytes();
    if element_name_bytes.len() != 2
        || element_name_bytes[0] != b'h'
        || !(b'1'..=b'6').contains(&element_name_bytes[1])
    {
        return None;
    }
    Some(element_name_bytes[1] - b'0')
}
