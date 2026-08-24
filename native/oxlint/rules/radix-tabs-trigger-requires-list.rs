use crate::{context::LintContext, rule::Rule, AstNode};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

const MESSAGE: &str = "This Tabs.Trigger is outside Tabs.List, so it misses the tablist grouping and roving keyboard focus Radix provides through the list. Nest it inside Tabs.List.";

#[derive(Debug, Default, Clone)]
pub struct RadixTabsTriggerRequiresList;

declare_oxc_lint!(
    /// Require Radix tabs triggers to be inside Tabs.List.
    RadixTabsTriggerRequiresList,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require Radix tabs triggers to be inside Tabs.List.",
);

impl Rule for RadixTabsTriggerRequiresList {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "radix-ui") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_radix_tabs_part_name(&opening_element.name, ctx) != Some("Trigger")
            || !jsx_part_is_inside_root_without_required_ancestor(node, ctx, |ancestor_name| {
                match resolve_radix_tabs_part_name(ancestor_name, ctx) {
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

fn resolve_radix_tabs_part_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    if let Some(api_path) = resolve_jsx_import_api_path(
        element_name,
        |module_source| module_source == "@radix-ui/react-tabs",
        ctx,
    ) {
        let [part_name] = api_path.as_slice() else {
            return None;
        };
        return radix_tabs_part(part_name);
    }
    let api_path = resolve_jsx_import_api_path(
        element_name,
        |module_source| module_source == "radix-ui",
        ctx,
    )?;
    let [namespace, part_name] = api_path.as_slice() else {
        return None;
    };
    if namespace != "Tabs" {
        return None;
    }
    radix_tabs_part(part_name)
}

fn radix_tabs_part(part_name: &str) -> Option<&'static str> {
    match part_name {
        "Trigger" => Some("Trigger"),
        "List" => Some("List"),
        "Root" => Some("Root"),
        _ => None,
    }
}
