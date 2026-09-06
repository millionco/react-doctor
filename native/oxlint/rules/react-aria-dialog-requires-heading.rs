use oxc_ast::{ast::JSXAttributeItem, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, utils::has_jsx_prop_ignore_case, AstNode};

const MESSAGE: &str = "This Dialog renders no Heading, so it has no accessible name and assistive technology announces an unnamed dialog. Add a <Heading slot=\"title\"> (visually hidden if the design shows no heading) or an aria-label.";
const NAME_PROVIDING_ATTRIBUTES: [&str; 2] = ["aria-label", "aria-labelledby"];

#[derive(Debug, Default, Clone)]
pub struct ReactAriaDialogRequiresHeading;

declare_oxc_lint!(
    /// Require accessible names on React Aria dialogs.
    ReactAriaDialogRequiresHeading,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible names on React Aria dialogs.",
);

impl Rule for ReactAriaDialogRequiresHeading {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "react-aria") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_react_aria_component_name(&opening_element.name, ctx).as_deref()
            != Some("Dialog")
            || is_inside_react_aria_dialog_trigger(node, ctx)
            || opening_element
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
        let AstKind::JSXElement(dialog_element) = parent.kind() else {
            return;
        };
        if dialog_element.children.is_empty() {
            return;
        }
        let scan = scan_static_jsx_subtree_for_part(
            &dialog_element.children,
            ctx,
            |child_element| is_react_aria_heading(child_element, ctx),
            |child_element| {
                if resolve_react_aria_component_name(&child_element.opening_element.name, ctx)
                    .is_some()
                {
                    return false;
                }
                jsx_element_name_trailing_segment(&child_element.opening_element.name).is_some_and(
                    |name| {
                        name != "Fragment"
                            && name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
                    },
                )
            },
        );
        if scan.found_part || scan.saw_opaque_content {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
    }
}

fn is_react_aria_heading<'a>(
    element: &oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if resolve_react_aria_component_name(&element.opening_element.name, ctx).as_deref()
        != Some("Heading")
    {
        return jsx_element_name_trailing_segment(&element.opening_element.name) == Some("Heading");
    }
    let Some(slot_attribute) = find_jsx_attribute(&element.opening_element, "slot") else {
        return false;
    };
    if !jsx_attribute_may_have_non_empty_value(Some(slot_attribute), false, Some(ctx)) {
        return false;
    }
    get_static_jsx_attribute_string_values(slot_attribute, ctx).is_none_or(|slot_values| {
        !slot_values.is_empty() && slot_values.iter().all(|slot_value| slot_value == "title")
    })
}

fn is_inside_react_aria_dialog_trigger(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(ancestor.kind(), AstKind::JSXAttribute(_)) {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::JSXElement(element)
                if resolve_react_aria_component_name(&element.opening_element.name, ctx).as_deref()
                    == Some("DialogTrigger")
        ) {
            return true;
        }
    }
    false
}
