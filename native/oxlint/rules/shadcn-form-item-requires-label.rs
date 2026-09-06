use std::cell::Cell;

use oxc_ast::{ast::JSXAttributeItem, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, utils::has_jsx_prop_ignore_case, AstNode};

const MESSAGE: &str = "This FormItem wraps a FormControl but renders no FormLabel, so the field has no accessible name. Add a FormLabel (visually hidden if the design shows no label) or an aria-label on the control.";
const LABEL_ATTRIBUTES: [&str; 2] = ["aria-label", "aria-labelledby"];

#[derive(Debug, Default, Clone)]
pub struct ShadcnFormItemRequiresLabel;

declare_oxc_lint!(
    /// Require accessible labels on shadcn form items.
    ShadcnFormItemRequiresLabel,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible labels on shadcn form items.",
);

impl Rule for ShadcnFormItemRequiresLabel {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "shadcn") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_shadcn_component_name(&opening_element.name, "form", ctx).as_deref()
            != Some("FormItem")
        {
            return;
        }
        let parent = ctx.nodes().parent_node(node.id());
        let AstKind::JSXElement(form_item) = parent.kind() else {
            return;
        };
        if form_item.children.is_empty() {
            return;
        }
        let has_control = Cell::new(false);
        let has_label = Cell::new(false);
        let saw_unprovable_content = Cell::new(false);
        visit_static_jsx_children(
            &form_item.children,
            &mut |element| {
                let child_opening_element = &element.opening_element;
                if is_shadcn_form_label_name(&child_opening_element.name, ctx) {
                    has_label.set(true);
                    return false;
                }
                let resolved_part =
                    resolve_shadcn_component_name(&child_opening_element.name, "form", ctx);
                if (resolved_part.as_deref() == Some("FormControl")
                    || is_inside_shadcn_form_control(child_opening_element, form_item, ctx))
                    && has_form_label_attribute(child_opening_element)
                {
                    has_label.set(true);
                    return false;
                }
                if has_unknown_form_spread(child_opening_element) {
                    saw_unprovable_content.set(true);
                }
                if resolved_part.as_deref() == Some("FormControl") {
                    has_control.set(true);
                    return true;
                }
                if resolved_part.is_none()
                    && jsx_element_name_trailing_segment(&child_opening_element.name).is_some_and(
                        |name| {
                            name != "Fragment"
                                && name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
                                && resolve_general_shadcn_ui_component_name(
                                    &child_opening_element.name,
                                    ctx,
                                )
                                .is_none()
                        },
                    )
                {
                    saw_unprovable_content.set(true);
                }
                true
            },
            &mut || saw_unprovable_content.set(true),
            &mut || {},
        );
        if !has_control.get() || has_label.get() || saw_unprovable_content.get() {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
    }
}

fn is_shadcn_form_label_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_shadcn_component_name(element_name, "form", ctx).as_deref() == Some("FormLabel")
        || matches!(
            jsx_element_name_trailing_segment(element_name),
            Some("label" | "FormLabel" | "Label")
        )
}

fn has_form_label_attribute(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    LABEL_ATTRIBUTES
        .iter()
        .any(|attribute_name| has_jsx_prop_ignore_case(opening_element, attribute_name).is_some())
}

fn has_unknown_form_spread(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        let JSXAttributeItem::SpreadAttribute(spread_attribute) = attribute else {
            return false;
        };
        let oxc_ast::ast::Expression::Identifier(identifier) =
            spread_attribute.argument.get_inner_expression()
        else {
            return true;
        };
        !is_react_hook_form_field_name(identifier.name.as_str())
    })
}

fn is_react_hook_form_field_name(identifier_name: &str) -> bool {
    identifier_name == "field"
        || identifier_name
            .strip_prefix("field")
            .and_then(|suffix| suffix.as_bytes().first())
            .is_some_and(u8::is_ascii_uppercase)
}

fn is_inside_shadcn_form_control<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    form_item: &oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(opening_element.node_id.get()) {
        if ancestor.id() == form_item.node_id.get() {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::JSXElement(element)
                if resolve_shadcn_component_name(&element.opening_element.name, "form", ctx)
                    .as_deref()
                    == Some("FormControl")
        ) {
            return true;
        }
    }
    false
}
