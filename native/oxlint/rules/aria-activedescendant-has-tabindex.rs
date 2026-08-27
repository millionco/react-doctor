use oxc_ast::{
    AstKind,
    ast::JSXAttributeItem,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    globals::HTML_TAG,
    rule::Rule,
    utils::{get_element_type, has_jsx_prop_ignore_case, is_interactive_element},
};

const MESSAGE: &str = "Keyboard users can't focus this element with `aria-activedescendant` because it isn't tabbable, so add `tabIndex={0}`.";

#[derive(Debug, Default, Clone)]
pub struct AriaActivedescendantHasTabindex;

declare_oxc_lint!(
    /// Require tabbable aria-activedescendant owners.
    AriaActivedescendantHasTabindex,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require tabbable aria-activedescendant owners.",
);

impl Rule for AriaActivedescendantHasTabindex {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if has_jsx_prop_ignore_case(opening_element, "aria-activedescendant").is_none() {
            return;
        }
        let element_type = get_element_type(ctx, opening_element);
        if !HTML_TAG.contains(element_type.as_ref()) {
            return;
        }
        if let Some(JSXAttributeItem::Attribute(tab_index_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "tabIndex")
        {
            let should_report = tab_index_attribute
                .value
                .as_ref()
                .and_then(|value| parse_static_jsx_number(value))
                .is_some_and(|tab_index| tab_index < -1.0);
            if !should_report {
                return;
            }
        } else if is_interactive_element(&element_type, opening_element)
            || can_content_editable_be_tabbable(node, opening_element, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
    }
}
