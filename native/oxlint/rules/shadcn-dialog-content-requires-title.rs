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
