use oxc_ast::{ast::JSXAttributeItem, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, utils::has_jsx_prop_ignore_case, AstNode};

const DIALOG_MESSAGE: &str = "This Dialog.Content renders no Dialog.Title, so the dialog has no accessible name and Radix logs an accessibility error at runtime. Add a Title part (wrapped in VisuallyHidden if the design shows no heading) or an aria-label.";
const ALERT_DIALOG_MESSAGE: &str = "This AlertDialog.Content renders no AlertDialog.Title, so the dialog has no accessible name and Radix logs an accessibility error at runtime. Add a Title part (wrapped in VisuallyHidden if the design shows no heading) or an aria-label.";
const NAME_PROVIDING_ATTRIBUTES: [&str; 3] = ["aria-label", "aria-labelledby", "title"];

#[derive(Debug, Default, Clone)]
pub struct RadixDialogContentRequiresTitle;

declare_oxc_lint!(
    /// Require accessible names on Radix dialog content.
    RadixDialogContentRequiresTitle,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible names on Radix dialog content.",
);

impl Rule for RadixDialogContentRequiresTitle {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "radix-ui") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        for surface_name in ["Dialog", "AlertDialog"] {
            if resolve_radix_dialog_part_name(&opening_element.name, surface_name, ctx)
                != Some("Content")
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
                |child_name| is_radix_dialog_title_name(child_name, surface_name, ctx),
                |child_element| {
                    let child_name = &child_element.opening_element.name;
                    resolve_radix_dialog_part_name(child_name, surface_name, ctx).is_none()
                        && jsx_element_name_trailing_segment(child_name).is_some_and(|name| {
                            name != "Fragment"
                                && name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
                        })
                },
            );
            if scan.found_part || scan.saw_opaque_content {
                return;
            }
            let message = if surface_name == "Dialog" {
                DIALOG_MESSAGE
            } else {
                ALERT_DIALOG_MESSAGE
            };
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.name.span()));
            return;
        }
    }
}

fn resolve_radix_dialog_part_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    surface_name: &str,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    let primitive_module = match surface_name {
        "Dialog" => "@radix-ui/react-dialog",
        "AlertDialog" => "@radix-ui/react-alert-dialog",
        _ => return None,
    };
    if let Some(api_path) = resolve_jsx_import_api_path(
        element_name,
        |module_source| module_source == primitive_module,
        ctx,
    ) {
        let [part_name] = api_path.as_slice() else {
            return None;
        };
        return radix_dialog_part(part_name);
    }
    let api_path = resolve_jsx_import_api_path(
        element_name,
        |module_source| module_source == "radix-ui",
        ctx,
    )?;
    let [namespace, part_name] = api_path.as_slice() else {
        return None;
    };
    if namespace != surface_name {
        return None;
    }
    radix_dialog_part(part_name)
}

fn radix_dialog_part(part_name: &str) -> Option<&'static str> {
    match part_name {
        "Content" => Some("Content"),
        "Title" => Some("Title"),
        _ => Some("Part"),
    }
}

fn is_radix_dialog_title_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    surface_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_radix_dialog_part_name(element_name, surface_name, ctx) == Some("Title")
        || jsx_element_name_trailing_segment(element_name).is_some_and(|name| {
            name == "Title"
                || (surface_name == "Dialog" && name == "DialogTitle")
                || (surface_name == "AlertDialog" && name == "AlertDialogTitle")
        })
}
