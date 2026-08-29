use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeValue, JSXOpeningElement, TemplateLiteral},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
    utils::{
        get_element_type, get_jsx_element_name, get_string_literal_prop_value, has_jsx_prop,
        has_jsx_prop_ignore_case,
    },
};

const MESSAGE: &str = "`autoFocus` moves focus on load, which can disrupt screen reader and keyboard users. Remove it and let users choose where to focus.";

#[derive(Debug, Default, Clone)]
pub struct NoAutofocus;

declare_oxc_lint!(
    /// Prevent unconditional autofocus outside modal surfaces.
    NoAutofocus,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prevent unconditional autofocus outside modal surfaces.",
);

impl Rule for NoAutofocus {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && (!should_use_curated_port_behavior_host(ctx) || !is_non_production_file(ctx))
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(autofocus_attribute) = has_jsx_prop(opening_element, "autoFocus")
            .and_then(oxc_ast::ast::JSXAttributeItem::as_attribute)
        else {
            return;
        };
        if autofocus_attribute
            .value
            .as_ref()
            .is_some_and(is_false_attribute_value)
        {
            return;
        }
        let curated_behavior = should_use_curated_port_behavior(ctx);
        if curated_behavior
            && autofocus_attribute
                .value
                .as_ref()
                .is_some_and(is_dynamic_attribute_value)
        {
            return;
        }
        if ignore_non_dom(ctx)
            && !HTML_TAG.contains(get_element_type(ctx, opening_element).as_ref())
        {
            return;
        }
        if is_inside_modal_dialog(node, curated_behavior, ctx)
            || curated_behavior && is_conditionally_rendered(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(autofocus_attribute.span));
    }
}

fn ignore_non_dom(ctx: &LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("noAutofocus"))
        .and_then(|settings| settings.get("ignoreNonDOM"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or_else(|| should_use_curated_port_behavior(ctx))
}

fn is_false_attribute_value(value: &JSXAttributeValue<'_>) -> bool {
    match value {
        JSXAttributeValue::StringLiteral(literal) => literal.value == "false",
        JSXAttributeValue::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            match strip_parenthesized_expression(expression) {
                Expression::BooleanLiteral(literal) => !literal.value,
                Expression::StringLiteral(literal) => literal.value == "false",
                Expression::TemplateLiteral(template) => {
                    autofocus_static_template_value(template) == Some("false")
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn is_dynamic_attribute_value(value: &JSXAttributeValue<'_>) -> bool {
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return false;
    };
    let Some(expression) = container.expression.as_expression() else {
        return true;
    };
    match strip_parenthesized_expression(expression) {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => false,
        Expression::Identifier(identifier) => identifier.name != "undefined",
        Expression::TemplateLiteral(template) => {
            autofocus_static_template_value(template).is_none()
        }
        _ => true,
    }
}

fn autofocus_static_template_value<'a>(template: &'a TemplateLiteral<'a>) -> Option<&'a str> {
    if !template.expressions.is_empty() || template.quasis.len() != 1 {
        return None;
    }
    let quasi = &template.quasis[0];
    Some(
        quasi
            .value
            .cooked
            .as_ref()
            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
    )
}

fn is_inside_modal_dialog(
    node: &AstNode<'_>,
    should_include_current_element: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let mut should_skip_current_element = !should_include_current_element;
    for ancestor in ctx.nodes().ancestor_kinds(node.id()) {
        let AstKind::JSXElement(element) = ancestor else {
            continue;
        };
        if should_skip_current_element {
            should_skip_current_element = false;
            continue;
        }
        if is_modal_dialog_element(&element.opening_element, ctx) {
            return true;
        }
    }
    false
}

fn is_modal_dialog_element<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if get_jsx_element_name(&opening_element.name) == "dialog"
        || has_jsx_prop_ignore_case(opening_element, "popover").is_some()
        || has_jsx_prop_ignore_case(opening_element, "aria-modal").is_some()
    {
        return true;
    }
    if let Some(role_attribute) = has_jsx_prop_ignore_case(opening_element, "role")
        && get_string_literal_prop_value(role_attribute).is_some_and(|role| {
            matches!(role.to_ascii_lowercase().as_str(), "dialog" | "alertdialog")
        })
    {
        return true;
    }
    get_element_type(ctx, opening_element) == "dialog"
}

fn is_conditionally_rendered(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestor_kinds(node.id()) {
        match ancestor {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            AstKind::ConditionalExpression(_)
            | AstKind::LogicalExpression(_)
            | AstKind::IfStatement(_) => return true,
            _ => {}
        }
    }
    false
}
