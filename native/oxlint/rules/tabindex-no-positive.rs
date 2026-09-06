use oxc_ast::{ast::JSXAttributeItem, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
    AstNode,
};

const MESSAGE: &str = "Keyboard users get jumped out of the normal order by a positive `tabIndex`, so use `0` or `-1`.";

#[derive(Debug, Default, Clone)]
pub struct TabindexNoPositive;

declare_oxc_lint!(
    /// Disallow positive tabindex values.
    TabindexNoPositive,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow positive tabindex values.",
);

impl Rule for TabindexNoPositive {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(JSXAttributeItem::Attribute(attribute)) =
            has_jsx_prop_ignore_case(opening_element, "tabIndex")
        else {
            return;
        };
        let Some(value) = attribute.value.as_ref() else {
            return;
        };
        if parse_static_jsx_number(value).is_some_and(|value| value > 0.0) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }
}
