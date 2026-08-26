use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Your users see no live updates because `onChange` on text inputs in Preact core only fires on blur, so use `onInput` instead. `preact/compat` handles this for you.";
const EXEMPT_INPUT_TYPES: [&str; 3] = ["checkbox", "radio", "file"];

#[derive(Debug, Default, Clone)]
pub struct PreactPreferOninput;

declare_oxc_lint!(
    /// Prefer onInput for text-like controls in Preact core.
    PreactPreferOninput,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prefer onInput for text-like controls in Preact core.",
);

impl Rule for PreactPreferOninput {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
            return;
        };
        if element_type != "textarea"
            && (element_type != "input"
                || find_jsx_attribute(opening_element, "type")
                    .and_then(|attribute| attribute.value.as_ref())
                    .and_then(|value| get_direct_string_literal_attribute_value(value))
                    .is_some_and(|input_type| EXEMPT_INPUT_TYPES.contains(&input_type)))
        {
            return;
        }
        let Some(on_change_attribute) = find_jsx_attribute(opening_element, "onChange") else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(on_change_attribute.span));
    }
}
