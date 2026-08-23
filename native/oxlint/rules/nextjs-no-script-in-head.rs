use oxc_ast::{
    AstKind,
    ast::{JSXElementName, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "next/script inside next/head is silently ignored. Move <Script> outside <Head> so it actually loads.";

#[derive(Debug, Default, Clone)]
pub struct NextjsNoScriptInHead;

declare_oxc_lint!(
    /// Disallow next/script inside next/head.
    NextjsNoScriptInHead,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow next/script inside next/head.",
);

impl Rule for NextjsNoScriptInHead {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !has_jsx_identifier_name(opening_element, "Script")
            || !is_inside_head_element(node, ctx)
            || !is_next_file_active(ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn is_inside_head_element(node: &AstNode, ctx: &LintContext) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            AstKind::JSXAttribute(_) => return false,
            AstKind::JSXElement(element)
                if has_jsx_identifier_name(&element.opening_element, "Head") =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn has_jsx_identifier_name(opening_element: &JSXOpeningElement, target_name: &str) -> bool {
    match &opening_element.name {
        JSXElementName::Identifier(identifier) => identifier.name == target_name,
        JSXElementName::IdentifierReference(identifier) => identifier.name == target_name,
        _ => false,
    }
}
