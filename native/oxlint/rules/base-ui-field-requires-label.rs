use std::cell::Cell;

use oxc_ast::{ast::JSXAttributeItem, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, utils::has_jsx_prop_ignore_case, AstNode};

const MESSAGE: &str = "This Field.Root wraps a Field.Control but renders no Field.Label, so the field has no accessible name. Add a Field.Label (visually hidden if the design shows no label) or an aria-label on the control.";
const LABEL_ATTRIBUTES: [&str; 2] = ["aria-label", "aria-labelledby"];

#[derive(Debug, Default, Clone)]
pub struct BaseUiFieldRequiresLabel;

declare_oxc_lint!(
    /// Require accessible labels on Base UI fields.
    BaseUiFieldRequiresLabel,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible labels on Base UI fields.",
);

impl Rule for BaseUiFieldRequiresLabel {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "base-ui") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_base_ui_field_part_name(&opening_element.name, ctx) != Some("Root") {
            return;
        }
        let parent = ctx.nodes().parent_node(node.id());
        let AstKind::JSXElement(field_root) = parent.kind() else {
            return;
        };
        if field_root.children.is_empty() {
            return;
        }
        let has_control = Cell::new(false);
        let has_label = Cell::new(false);
        let saw_unprovable_content = Cell::new(false);
        visit_static_jsx_children(
            &field_root.children,
            &mut |element| {
                let child_opening_element = &element.opening_element;
                if is_base_ui_field_label_name(&child_opening_element.name, ctx) {
                    has_label.set(true);
                    return false;
                }
                let resolved_part =
                    resolve_base_ui_field_part_name(&child_opening_element.name, ctx);
                if (resolved_part == Some("Control")
                    || is_inside_base_ui_field_control(child_opening_element, field_root, ctx))
                    && has_label_attribute(child_opening_element)
                {
                    has_label.set(true);
                    return false;
                }
                if child_opening_element
                    .attributes
                    .iter()
                    .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
                {
                    saw_unprovable_content.set(true);
                }
                if find_jsx_attribute(child_opening_element, "render")
                    .is_some_and(|attribute| render_attribute_contains_label(attribute, ctx))
                {
                    has_label.set(true);
                }
                if resolved_part == Some("Control") {
                    has_control.set(true);
                    return true;
                }
                if resolved_part.is_none()
                    && jsx_element_name_trailing_segment(&child_opening_element.name).is_some_and(
                        |name| {
                            name != "Fragment"
                                && name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
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

fn resolve_base_ui_field_part_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    let api_path = resolve_jsx_import_api_path(
        element_name,
        |module_source| {
            matches!(
                module_source,
                "@base-ui/react"
                    | "@base-ui/react/field"
                    | "@base-ui-components/react"
                    | "@base-ui-components/react/field"
            )
        },
        ctx,
    )?;
    let [namespace, part_name] = api_path.as_slice() else {
        return None;
    };
    if namespace != "Field" {
        return None;
    }
    match part_name.as_str() {
        "Root" => Some("Root"),
        "Control" => Some("Control"),
        "Label" => Some("Label"),
        _ => Some("Part"),
    }
}

fn is_base_ui_field_label_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_base_ui_field_part_name(element_name, ctx) == Some("Label")
        || matches!(
            jsx_element_name_trailing_segment(element_name),
            Some("label" | "Label" | "FieldLabel")
        )
}

fn has_label_attribute(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    LABEL_ATTRIBUTES
        .iter()
        .any(|attribute_name| has_jsx_prop_ignore_case(opening_element, attribute_name).is_some())
}

fn is_inside_base_ui_field_control<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    field_root: &oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(opening_element.node_id.get()) {
        if ancestor.id() == field_root.node_id.get() {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::JSXElement(element)
                if resolve_base_ui_field_part_name(&element.opening_element.name, ctx)
                    == Some("Control")
        ) {
            return true;
        }
    }
    false
}

fn render_attribute_contains_label<'a>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
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
            && has_label_attribute(opening_element)
    })
}
