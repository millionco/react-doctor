use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const CANONICAL_INPUT_GROUP_PARTS: [&str; 3] = [
    "InputGroupAddon",
    "InputGroupInput",
    "InputGroupTextarea",
];

#[derive(Debug, Default, Clone)]
pub struct ShadcnInputGroupNoRawControls;

declare_oxc_lint!(
    /// Disallow raw controls directly inside shadcn InputGroup.
    ShadcnInputGroupNoRawControls,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow raw controls directly inside shadcn InputGroup.",
);

impl Rule for ShadcnInputGroupNoRawControls {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "shadcn") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_shadcn_component_name(&opening_element.name, "input-group", ctx).as_deref()
            != Some("InputGroup")
        {
            return;
        }
        let parent = ctx.nodes().parent_node(node.id());
        let AstKind::JSXElement(group_element) = parent.kind() else {
            return;
        };
        let mut direct_child_elements = Vec::new();
        visit_static_jsx_children(
            &group_element.children,
            &mut |child_element| {
                direct_child_elements.push(child_element);
                false
            },
            &mut || {},
            &mut || {},
        );
        if !direct_child_elements.iter().any(|child_element| {
            resolve_shadcn_component_name(
                &child_element.opening_element.name,
                "input-group",
                ctx,
            )
            .is_some_and(|component_name| {
                CANONICAL_INPUT_GROUP_PARTS.contains(&component_name.as_str())
            })
        }) {
            return;
        }
        for child_element in direct_child_elements {
            let child_opening_element = &child_element.opening_element;
            let Some((native_tag, replacement)) = raw_control_contract(child_opening_element, ctx)
            else {
                continue;
            };
            if find_jsx_attribute(child_opening_element, "type")
                .and_then(|attribute| get_string_literal_attribute_value(attribute))
                == Some("hidden")
            {
                continue;
            }
            let child_name = child_opening_element
                .name
                .span()
                .source_text(ctx.source_text());
            let child_name = if child_name.is_empty() {
                native_tag
            } else {
                child_name
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This {child_name} sits directly inside InputGroup, so it keeps its own border and focus ring and the group's shared focus and error styling never applies. Use {replacement} instead."
                ))
                .with_label(child_opening_element.span),
            );
        }
    }
}

fn raw_control_contract<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'static str, &'static str)> {
    let element_name = &opening_element.name;
    if matches!(
        element_name,
        oxc_ast::ast::JSXElementName::Identifier(identifier) if identifier.name == "input"
    )
        || resolve_shadcn_component_name(element_name, "input", ctx).as_deref() == Some("Input")
    {
        return Some(("input", "InputGroupInput"));
    }
    if matches!(
        element_name,
        oxc_ast::ast::JSXElementName::Identifier(identifier) if identifier.name == "textarea"
    )
        || resolve_shadcn_component_name(element_name, "textarea", ctx).as_deref()
            == Some("Textarea")
    {
        return Some(("textarea", "InputGroupTextarea"));
    }
    if matches!(
        element_name,
        oxc_ast::ast::JSXElementName::Identifier(identifier) if identifier.name == "button"
    )
        || resolve_shadcn_component_name(element_name, "button", ctx).as_deref() == Some("Button")
    {
        return Some((
            "button",
            "InputGroupButton inside an InputGroupAddon",
        ));
    }
    None
}
