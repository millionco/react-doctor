use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, rule::Rule, utils::has_jsx_prop_ignore_case};

const DEFAULT_HEADING_TAGS: [&str; 6] = ["h1", "h2", "h3", "h4", "h5", "h6"];
const MESSAGE: &str = "Blind users can't use this heading to navigate because screen readers skip it empty, so add text, `aria-label`, or `aria-labelledby`.";

#[derive(Debug, Default, Clone)]
pub struct HeadingHasContent;

declare_oxc_lint!(
    /// Require accessible heading content.
    HeadingHasContent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible heading content.",
);

impl Rule for HeadingHasContent {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let element_type = get_element_type(ctx, opening_element);
        if !DEFAULT_HEADING_TAGS.contains(&element_type.as_ref())
            && !configured_heading_components(ctx).is_some_and(|components| {
                components
                    .iter()
                    .any(|component| component == element_type.as_ref())
            })
        {
            return;
        }
        if let AstKind::JSXElement(element) = ctx.nodes().parent_kind(node.id())
            && object_has_accessible_child(element, ctx)
        {
            return;
        }
        if is_hidden_from_screen_reader(opening_element, ctx)
            || ["aria-label", "aria-labelledby"]
                .iter()
                .any(|attribute_name| {
                    has_jsx_prop_ignore_case(opening_element, attribute_name).is_some()
                })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn configured_heading_components<'a>(
    ctx: &'a LintContext<'_>,
) -> Option<&'a Vec<serde_json::Value>> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("headingHasContent"))
        .and_then(|settings| settings.get("components"))
        .and_then(serde_json::Value::as_array)
}
