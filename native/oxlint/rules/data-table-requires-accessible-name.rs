use oxc_ast::{
    AstKind,
    ast::{JSXAttribute, JSXAttributeName, JSXElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::ContextHost, globals::VALID_ARIA_ROLES, rule::Rule};

const MESSAGE: &str = "This data table has headers but no accessible name. Add a caption or connect the table to a visible title with aria-labelledby.";
const DATA_TABLE_ROLES: [&str; 3] = ["grid", "table", "treegrid"];

#[derive(Debug, Default, Clone)]
pub struct DataTableRequiresAccessibleName;

declare_oxc_lint!(
    /// Require accessible names for data tables.
    DataTableRequiresAccessibleName,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible names for data tables.",
);

impl Rule for DataTableRequiresAccessibleName {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &crate::context::LintContext<'a>) {
        let generated_image_element_ids = generated_image_jsx_opening_element_ids(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            let opening_element = &element.opening_element;
            if resolve_jsx_element_type(opening_element, ctx)
                .is_none_or(|(element_type, _)| element_type != "table")
                || generated_image_element_ids.contains(&opening_element.node_id.get())
                || data_table_element_is_hidden(opening_element, ctx)
                || data_table_has_hidden_ancestor(node, ctx)
            {
                continue;
            }
            if [
                "aria-hidden",
                "children",
                "dangerouslysetinnerhtml",
                "hidden",
            ]
            .iter()
            .any(|attribute_name| {
                data_table_resolution_is_unknown(opening_element, attribute_name, ctx)
            }) {
                continue;
            }
            let children_resolution =
                resolve_static_jsx_attribute(opening_element, "children", false);
            let inline_html_resolution =
                resolve_static_jsx_attribute(opening_element, "dangerouslysetinnerhtml", false);
            if children_resolution.is_present || inline_html_resolution.is_present {
                continue;
            }
            let role_resolution = resolve_static_jsx_attribute(opening_element, "role", false);
            if data_table_resolution_is_unknown(opening_element, "role", ctx) {
                continue;
            }
            if role_resolution.is_present {
                if let Some(role) = data_table_resolution_static_string(&role_resolution) {
                    let primary_role = role
                        .trim()
                        .to_ascii_lowercase()
                        .split_whitespace()
                        .find(|role_name| VALID_ARIA_ROLES.contains(*role_name))
                        .map(str::to_string);
                    if primary_role
                        .as_deref()
                        .is_some_and(|role_name| !DATA_TABLE_ROLES.contains(&role_name))
                    {
                        continue;
                    }
                } else if data_table_resolution_may_have_non_empty_value(
                    &role_resolution,
                    false,
                    ctx,
                ) {
                    continue;
                }
            }
            if !get_static_jsx_descendant_opening_elements(element, false)
                .iter()
                .any(|header| data_table_header_is_exposed(header, node.id(), ctx))
            {
                continue;
            }
            let caption = data_table_direct_caption(&element.children, ctx);
            let Some(has_accessible_name_attribute) =
                data_table_has_accessible_name_attribute(opening_element, ctx)
            else {
                continue;
            };
            if caption.is_some_and(|caption| {
                !data_table_element_is_hidden(&caption.opening_element, ctx)
                    && object_has_accessible_child(caption, ctx)
            }) || has_accessible_name_attribute
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
        }
    }
}

fn data_table_resolution_is_unknown<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    attribute_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let resolution = resolve_static_jsx_attribute(opening_element, attribute_name, false);
    resolution.is_unknown
        && data_table_has_spread_that_may_affect_attribute(opening_element, attribute_name, ctx)
}

fn data_table_has_spread_that_may_affect_attribute<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    attribute_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    for attribute in opening_element.attributes.iter().rev() {
        match attribute {
            oxc_ast::ast::JSXAttributeItem::Attribute(attribute)
                if data_table_attribute_name(attribute)
                    .is_some_and(|name| name.eq_ignore_ascii_case(attribute_name)) =>
            {
                return false;
            }
            oxc_ast::ast::JSXAttributeItem::SpreadAttribute(spread)
                if can_expression_override_jsx_attribute_with_aliases(
                    &spread.argument,
                    attribute_name,
                    false,
                    ctx,
                ) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn data_table_attribute_name<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match &attribute.name {
        JSXAttributeName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXAttributeName::NamespacedName(_) => None,
    }
}

fn data_table_resolution_static_string<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
) -> Option<&'a str> {
    resolution
        .attribute
        .and_then(|attribute| get_string_literal_attribute_value(attribute))
        .or_else(|| resolution.expression.and_then(get_static_string_expression))
}

fn data_table_resolution_expression<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    if let Some(expression) = resolution.expression {
        return Some(expression.get_inner_expression());
    }
    let attribute = resolution.attribute?;
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) =
        attribute.value.as_ref()?
    else {
        return None;
    };
    Some(container.expression.as_expression()?.get_inner_expression())
}

fn data_table_resolution_may_have_non_empty_value<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
    boolean_values_render: bool,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if let Some(attribute) = resolution.attribute {
        return jsx_attribute_may_have_non_empty_value(
            Some(attribute),
            boolean_values_render,
            Some(ctx),
        );
    }
    let Some(expression) = resolution
        .expression
        .map(oxc_ast::ast::Expression::get_inner_expression)
    else {
        return false;
    };
    if let Some(static_string) = get_static_string_expression(expression) {
        return !static_string.trim().is_empty();
    }
    match expression {
        oxc_ast::ast::Expression::BooleanLiteral(_) => boolean_values_render,
        oxc_ast::ast::Expression::NumericLiteral(_) => true,
        oxc_ast::ast::Expression::NullLiteral(_)
        | oxc_ast::ast::Expression::BigIntLiteral(_)
        | oxc_ast::ast::Expression::RegExpLiteral(_) => false,
        oxc_ast::ast::Expression::UnaryExpression(unary) if is_literal_void_expression(unary) => {
            false
        }
        oxc_ast::ast::Expression::Identifier(identifier) if identifier.name == "undefined" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some(),
        _ => true,
    }
}

fn data_table_has_accessible_name_attribute<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<bool> {
    for attribute_name in ["aria-label", "aria-labelledby", "title"] {
        let resolution = resolve_static_jsx_attribute(opening_element, attribute_name, false);
        if resolution.is_unknown
            && data_table_has_spread_that_may_affect_attribute(opening_element, attribute_name, ctx)
        {
            return None;
        }
        if data_table_resolution_may_have_non_empty_value(
            &resolution,
            attribute_name.starts_with("aria-"),
            ctx,
        ) {
            return Some(true);
        }
    }
    Some(false)
}

fn data_table_direct_caption<'a>(
    children: &'a [oxc_ast::ast::JSXChild<'a>],
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'a JSXElement<'a>> {
    for child in children {
        match child {
            oxc_ast::ast::JSXChild::Element(element)
                if resolve_jsx_element_type(&element.opening_element, ctx)
                    .is_some_and(|(element_type, _)| element_type == "caption") =>
            {
                return Some(element);
            }
            oxc_ast::ast::JSXChild::Fragment(fragment) => {
                if let Some(caption) = data_table_direct_caption(&fragment.children, ctx) {
                    return Some(caption);
                }
            }
            _ => {}
        }
    }
    None
}

fn data_table_header_is_exposed<'a>(
    header: &oxc_ast::ast::JSXOpeningElement<'a>,
    table_node_id: oxc_syntax::node::NodeId,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if resolve_jsx_element_type(header, ctx).is_none_or(|(element_type, _)| element_type != "th") {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(header.node_id.get()) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        if data_table_element_is_hidden(&element.opening_element, ctx) {
            return false;
        }
        if resolve_jsx_element_type(&element.opening_element, ctx)
            .is_some_and(|(element_type, _)| element_type == "table")
        {
            return ancestor.id() == table_node_id;
        }
    }
    false
}

fn data_table_has_hidden_ancestor(
    node: &AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::JSXElement(element)
                if data_table_element_is_hidden(&element.opening_element, ctx)
        )
    })
}

fn data_table_element_is_hidden<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if is_hidden_from_screen_reader(opening_element, ctx) {
        return true;
    }
    let hidden = resolve_static_jsx_attribute(opening_element, "hidden", false);
    if hidden.is_present {
        if hidden
            .attribute
            .is_some_and(|attribute| attribute.value.is_none())
        {
            return true;
        }
        if data_table_resolution_static_string(&hidden).is_some_and(|value| !value.is_empty()) {
            return true;
        }
        if matches!(data_table_resolution_expression(&hidden), Some(oxc_ast::ast::Expression::BooleanLiteral(value)) if value.value)
        {
            return true;
        }
    }
    let aria_hidden = resolve_static_jsx_attribute(opening_element, "aria-hidden", false);
    aria_hidden.is_present
        && (aria_hidden
            .attribute
            .is_some_and(|attribute| attribute.value.is_none())
            || data_table_resolution_static_string(&aria_hidden)
                .is_some_and(|value| value.eq_ignore_ascii_case("true"))
            || matches!(data_table_resolution_expression(&aria_hidden), Some(oxc_ast::ast::Expression::BooleanLiteral(value)) if value.value))
}
