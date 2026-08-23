use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXChild},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const FIELD_TAG_NAMES: [&str; 3] = ["input", "select", "textarea"];
const MESSAGE: &str = "This fieldset groups multiple controls without naming the group. Add a direct legend or an explicit accessible name.";

#[derive(Debug, Default, Clone)]
pub struct FieldsetRequiresLegend;

declare_oxc_lint!(
    /// Require grouped fieldset controls to have an accessible name.
    FieldsetRequiresLegend,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require grouped fieldset controls to have an accessible name.",
);

impl Rule for FieldsetRequiresLegend {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let opening_element = &element.opening_element;
        if resolve_jsx_element_type(opening_element, ctx)
            .is_none_or(|(element_type, _)| element_type != "fieldset")
            || opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let mut descendants = Vec::new();
        collect_static_jsx_opening_elements(&element.children, &mut descendants);
        let field_count = descendants
            .iter()
            .filter(|descendant| {
                resolve_jsx_element_type(descendant, ctx)
                    .is_some_and(|(element_type, _)| FIELD_TAG_NAMES.contains(&element_type))
            })
            .take(2)
            .count();
        if field_count < 2 {
            return;
        }
        let has_direct_legend = element.children.iter().any(|child| {
            matches!(
                child,
                JSXChild::Element(child_element)
                    if resolve_jsx_element_type(&child_element.opening_element, ctx)
                        .is_some_and(|(element_type, _)| element_type == "legend")
            )
        });
        if has_direct_legend
            || find_jsx_attribute(opening_element, "aria-label").is_some()
            || find_jsx_attribute(opening_element, "aria-labelledby").is_some()
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}
