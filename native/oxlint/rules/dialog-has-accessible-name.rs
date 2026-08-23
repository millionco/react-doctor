use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::{get_string_literal_prop_value, has_jsx_prop_ignore_case},
};

const MESSAGE: &str = "This dialog has no accessible name, so screen readers announce it as just “dialog.” Add `aria-label` or point `aria-labelledby` at its heading.";

#[derive(Debug, Default, Clone)]
pub struct DialogHasAccessibleName;

declare_oxc_lint!(
    /// Require accessible names on dialog elements.
    DialogHasAccessibleName,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible names on dialog elements.",
);

impl Rule for DialogHasAccessibleName {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !matches!(
            &opening_element.name,
            JSXElementName::Identifier(_) | JSXElementName::IdentifierReference(_)
        ) {
            return;
        }
        let Some((element_name, element_name_span)) =
            resolve_jsx_element_type(opening_element, ctx)
        else {
            return;
        };
        if element_name.chars().next().is_some_and(char::is_uppercase)
            || (!element_name.eq("dialog") && !has_dialog_role(opening_element))
            || opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
            || ["aria-label", "aria-labelledby", "title"]
                .iter()
                .any(|attribute_name| {
                    has_jsx_prop_ignore_case(opening_element, attribute_name).is_some()
                })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element_name_span));
    }
}

fn has_dialog_role(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    has_jsx_prop_ignore_case(opening_element, "role")
        .and_then(get_string_literal_prop_value)
        .is_some_and(|role| matches!(role, "dialog" | "alertdialog"))
}
