use oxc_ast::{
    ast::{JSXAttributeItem, JSXChild},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, utils::has_jsx_prop_ignore_case, AstNode};

const DIALOG_MESSAGE: &str = "This DialogContent renders no DialogTitle, so the dialog has no accessible name and assistive technology announces an unnamed dialog. Add a DialogTitle (visually hidden if the design shows no heading) or an aria-label.";
const SHEET_MESSAGE: &str = "This SheetContent renders no SheetTitle, so the dialog has no accessible name and assistive technology announces an unnamed dialog. Add a SheetTitle (visually hidden if the design shows no heading) or an aria-label.";
const ALERT_DIALOG_MESSAGE: &str = "This AlertDialogContent renders no AlertDialogTitle, so the dialog has no accessible name and assistive technology announces an unnamed dialog. Add a AlertDialogTitle (visually hidden if the design shows no heading) or an aria-label.";
const DRAWER_MESSAGE: &str = "This DrawerContent renders no DrawerTitle, so the dialog has no accessible name and assistive technology announces an unnamed dialog. Add a DrawerTitle (visually hidden if the design shows no heading) or an aria-label.";
const NAME_PROVIDING_ATTRIBUTES: [&str; 3] = ["aria-label", "aria-labelledby", "title"];
const DIALOG_SURFACES: [(&str, &str, &str); 4] = [
    ("dialog", "DialogContent", "DialogTitle"),
    ("sheet", "SheetContent", "SheetTitle"),
    ("alert-dialog", "AlertDialogContent", "AlertDialogTitle"),
    ("drawer", "DrawerContent", "DrawerTitle"),
];

#[derive(Debug, Default, Clone)]
pub struct ShadcnDialogContentRequiresTitle;

declare_oxc_lint!(
    /// Require accessible names on shadcn dialog content.
    ShadcnDialogContentRequiresTitle,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible names on shadcn dialog content.",
);

impl Rule for ShadcnDialogContentRequiresTitle {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "shadcn") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        for (module_name, content_component, title_component) in DIALOG_SURFACES {
            if resolve_shadcn_component_name(&opening_element.name, module_name, ctx).as_deref()
                != Some(content_component)
            {
                continue;
            }
            if opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
                || NAME_PROVIDING_ATTRIBUTES.iter().any(|attribute_name| {
                    has_jsx_prop_ignore_case(opening_element, attribute_name).is_some()
                })
            {
                return;
            }
            let parent = ctx.nodes().parent_node(node.id());
            let AstKind::JSXElement(element) = parent.kind() else {
                return;
            };
            if element.children.is_empty() {
                return;
            }
            let scan = scan_static_jsx_subtree_for_part(
                &element.children,
                ctx,
                |child_name| {
                    resolve_shadcn_component_name(child_name, module_name, ctx).as_deref()
                        == Some(title_component)
                        || jsx_element_name_trailing_segment(child_name) == Some(title_component)
                },
                |child_element| {
                    let child_name = &child_element.opening_element.name;
                    if let Some(resolved_part) =
                        resolve_shadcn_component_name(child_name, module_name, ctx)
                    {
                        return resolved_part == "DrawerHeader"
                            && child_element.children.iter().any(|child| {
                                matches!(child, JSXChild::Text(text) if !text.value.trim().is_empty())
                            });
                    }
                    jsx_element_name_trailing_segment(child_name).is_some_and(|name| {
                        name != "Fragment"
                            && name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
                            && resolve_general_shadcn_ui_component_name(child_name, ctx).is_none()
                    })
                },
            );
            if scan.found_part || scan.saw_opaque_content {
                return;
            }
            let message = match module_name {
                "dialog" => DIALOG_MESSAGE,
                "sheet" => SHEET_MESSAGE,
                "alert-dialog" => ALERT_DIALOG_MESSAGE,
                "drawer" => DRAWER_MESSAGE,
                _ => return,
            };
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.name.span()));
            return;
        }
    }
}

fn resolve_shadcn_component_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    module_name: &str,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let api_path = resolve_jsx_import_api_path(
        element_name,
        |module_source| is_shadcn_component_module(module_source, module_name),
        ctx,
    )?;
    let [component_name] = api_path.as_slice() else {
        return None;
    };
    Some(component_name.clone())
}

fn resolve_general_shadcn_ui_component_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let api_path = resolve_jsx_import_api_path(element_name, is_general_shadcn_ui_module, ctx)?;
    let [component_name] = api_path.as_slice() else {
        return None;
    };
    Some(component_name.clone())
}

fn is_shadcn_component_module(module_source: &str, module_name: &str) -> bool {
    let normalized_source = module_source.replace('\\', "/");
    let expected_suffix = format!("/{module_name}");
    normalized_source.ends_with(&expected_suffix)
        && (normalized_source.starts_with("./")
            || normalized_source.starts_with("../")
            || normalized_source == format!("ui/{module_name}")
            || normalized_source.contains("/ui/"))
}

fn is_general_shadcn_ui_module(module_source: &str) -> bool {
    let normalized_source = module_source.replace('\\', "/");
    let Some(ui_tail) = normalized_source.strip_prefix("ui/").or_else(|| {
        normalized_source
            .split_once("/ui/")
            .map(|(_, ui_tail)| ui_tail)
    }) else {
        return false;
    };
    let component_tail = ui_tail.strip_prefix("components/").unwrap_or(ui_tail);
    !component_tail.is_empty() && !component_tail.contains('/')
}
