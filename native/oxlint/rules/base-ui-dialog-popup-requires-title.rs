use std::cell::Cell;

use oxc_ast::{
    ast::{JSXAttributeItem, JSXAttributeValue},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, utils::has_jsx_prop_ignore_case, AstNode};

const DIALOG_MESSAGE: &str = "This Dialog.Popup renders no Dialog.Title, so the dialog has no accessible name and assistive technology announces an unnamed dialog. Add a Title part (visually hidden if the design shows no heading) or an aria-label.";
const ALERT_DIALOG_MESSAGE: &str = "This AlertDialog.Popup renders no AlertDialog.Title, so the dialog has no accessible name and assistive technology announces an unnamed dialog. Add a Title part (visually hidden if the design shows no heading) or an aria-label.";
const NAME_PROVIDING_ATTRIBUTES: [&str; 3] = ["aria-label", "aria-labelledby", "title"];

#[derive(Debug, Default, Clone)]
pub struct BaseUiDialogPopupRequiresTitle;

declare_oxc_lint!(
    /// Require accessible names on Base UI dialog popups.
    BaseUiDialogPopupRequiresTitle,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible names on Base UI dialog popups.",
);

impl Rule for BaseUiDialogPopupRequiresTitle {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "base-ui") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        for surface_name in ["Dialog", "AlertDialog"] {
            if resolve_base_ui_dialog_part_name(&opening_element.name, surface_name, ctx)
                != Some("Popup")
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
                || find_jsx_attribute(opening_element, "render")
                    .is_some_and(render_prop_may_provide_name)
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
            let found_title = Cell::new(false);
            let saw_opaque_content = Cell::new(false);
            visit_static_jsx_children(
                &element.children,
                &mut |child_element| {
                    let child_name = &child_element.opening_element.name;
                    if is_base_ui_dialog_title_name(child_name, surface_name, ctx) {
                        found_title.set(true);
                        return false;
                    }
                    if find_jsx_attribute(&child_element.opening_element, "render").is_some_and(
                        |attribute| render_attribute_contains_title(attribute, surface_name, ctx),
                    ) {
                        found_title.set(true);
                    }
                    if resolve_base_ui_dialog_part_name(child_name, surface_name, ctx).is_none()
                        && jsx_element_name_trailing_segment(child_name).is_some_and(|name| {
                            name != "Fragment"
                                && name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
                        })
                    {
                        saw_opaque_content.set(true);
                    }
                    true
                },
                &mut || saw_opaque_content.set(true),
            );
            if found_title.get() || saw_opaque_content.get() {
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

fn resolve_base_ui_dialog_part_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    surface_name: &str,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    let api_path = resolve_jsx_import_api_path(
        element_name,
        |module_source| match surface_name {
            "Dialog" => matches!(
                module_source,
                "@base-ui/react"
                    | "@base-ui/react/dialog"
                    | "@base-ui-components/react"
                    | "@base-ui-components/react/dialog"
            ),
            "AlertDialog" => matches!(
                module_source,
                "@base-ui/react"
                    | "@base-ui/react/alert-dialog"
                    | "@base-ui-components/react"
                    | "@base-ui-components/react/alert-dialog"
            ),
            _ => false,
        },
        ctx,
    )?;
    let [namespace, part_name] = api_path.as_slice() else {
        return None;
    };
    if namespace != surface_name {
        return None;
    }
    match part_name.as_str() {
        "Popup" => Some("Popup"),
        "Title" => Some("Title"),
        _ => Some("Part"),
    }
}

fn is_base_ui_dialog_title_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    surface_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_base_ui_dialog_part_name(element_name, surface_name, ctx) == Some("Title")
        || jsx_element_name_trailing_segment(element_name).is_some_and(|name| {
            name == "Title"
                || (surface_name == "Dialog" && name == "DialogTitle")
                || (surface_name == "AlertDialog" && name == "AlertDialogTitle")
        })
}

fn render_prop_may_provide_name(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return true;
    };
    let Some(oxc_ast::ast::Expression::JSXElement(element)) = container
        .expression
        .as_expression()
        .map(oxc_ast::ast::Expression::get_inner_expression)
    else {
        return true;
    };
    element
        .opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        || NAME_PROVIDING_ATTRIBUTES.iter().any(|attribute_name| {
            has_jsx_prop_ignore_case(&element.opening_element, attribute_name).is_some()
        })
}

fn render_attribute_contains_title<'a>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    surface_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(value) = &attribute.value else {
        return false;
    };
    let value_span = value.span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            return false;
        };
        let candidate_span = opening_element.span;
        candidate_span.start >= value_span.start
            && candidate_span.end <= value_span.end
            && is_base_ui_dialog_title_name(&opening_element.name, surface_name, ctx)
    })
}
