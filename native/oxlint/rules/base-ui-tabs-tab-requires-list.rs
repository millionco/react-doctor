use crate::{context::LintContext, rule::Rule, AstNode};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

const MESSAGE: &str = "This Tabs.Tab is outside Tabs.List, so it misses the tablist grouping and arrow-key focus handling Base UI provides through the list. Nest it inside Tabs.List.";

#[derive(Debug, Default, Clone)]
pub struct BaseUiTabsTabRequiresList;

declare_oxc_lint!(
    /// Require Base UI tabs to be inside Tabs.List.
    BaseUiTabsTabRequiresList,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require Base UI tabs to be inside Tabs.List.",
);

impl Rule for BaseUiTabsTabRequiresList {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "base-ui") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_base_ui_tabs_part_name(&opening_element.name, ctx) != Some("Tab")
            || !jsx_part_is_inside_root_without_required_ancestor(node, ctx, |ancestor_name| {
                match resolve_base_ui_tabs_part_name(ancestor_name, ctx) {
                    Some("List") => Some(JsxPartAncestorClassification::Required),
                    Some("Root") => Some(JsxPartAncestorClassification::Root),
                    _ => None,
                }
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn resolve_base_ui_tabs_part_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    let api_path = resolve_jsx_import_api_path(
        element_name,
        |module_source| {
            matches!(
                module_source,
                "@base-ui/react"
                    | "@base-ui/react/tabs"
                    | "@base-ui-components/react"
                    | "@base-ui-components/react/tabs"
            )
        },
        ctx,
    )?;
    match api_path.as_slice() {
        [part_name] => base_ui_tabs_part(part_name),
        [namespace, part_name] if namespace == "Tabs" => base_ui_tabs_part(part_name),
        _ => None,
    }
}

fn base_ui_tabs_part(part_name: &str) -> Option<&'static str> {
    match part_name {
        "Tab" => Some("Tab"),
        "List" => Some("List"),
        "Root" => Some("Root"),
        _ => None,
    }
}
