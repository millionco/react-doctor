use crate::{context::LintContext, rule::Rule, AstNode};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

const MESSAGE: &str = "This TabsTrigger is outside TabsList, so the library cannot provide the expected tablist grouping and keyboard behavior. Nest it inside TabsList.";

#[derive(Debug, Default, Clone)]
pub struct ShadcnTabsTriggerRequiresList;

declare_oxc_lint!(
    /// Require shadcn tabs triggers to be inside TabsList.
    ShadcnTabsTriggerRequiresList,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require shadcn tabs triggers to be inside TabsList.",
);

impl Rule for ShadcnTabsTriggerRequiresList {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "shadcn") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_shadcn_tabs_component_name(&opening_element.name, ctx) != Some("TabsTrigger")
            || !jsx_part_is_inside_root_without_required_ancestor(node, ctx, |ancestor_name| {
                match resolve_shadcn_tabs_component_name(ancestor_name, ctx) {
                    Some("TabsList") => Some(JsxPartAncestorClassification::Required),
                    Some("Tabs") => Some(JsxPartAncestorClassification::Root),
                    _ => None,
                }
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn resolve_shadcn_tabs_component_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    let api_path = resolve_jsx_import_api_path(
        element_name,
        |module_source| {
            let normalized_source = module_source.replace('\\', "/");
            normalized_source.ends_with("/tabs")
                && ((normalized_source.starts_with("./") || normalized_source.starts_with("../"))
                    || normalized_source == "ui/tabs"
                    || normalized_source.contains("/ui/"))
        },
        ctx,
    )?;
    let [component_name] = api_path.as_slice() else {
        return None;
    };
    match component_name.as_str() {
        "Tabs" => Some("Tabs"),
        "TabsList" => Some("TabsList"),
        "TabsTrigger" => Some("TabsTrigger"),
        _ => None,
    }
}
