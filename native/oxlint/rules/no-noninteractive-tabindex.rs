use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXChild,
        JSXElement, JSXExpression, JSXOpeningElement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::UnaryOperator;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
    utils::{has_jsx_prop_ignore_case, is_interactive_element, is_interactive_role},
};

const MESSAGE: &str = "Keyboard users get stuck focusing this element they can't act on because `tabIndex` makes it tabbable, so remove it.";
const KEYBOARD_HANDLER_NAMES: [&str; 3] = ["onkeydown", "onkeyup", "onkeypress"];
const FOCUS_HANDLER_NAMES: [&str; 2] = ["onfocus", "onblur"];
const LIBRARY_SURFACE_HANDLER_NAMES: [&str; 8] = [
    "onmousedown",
    "onmouseup",
    "onmousemove",
    "oncontextmenu",
    "onpointerdown",
    "onpointerup",
    "onpointermove",
    "onwheel",
];
const DEFAULT_ALLOWED_ROLES: [&str; 4] = ["tabpanel", "region", "dialog", "alertdialog"];

#[derive(Debug, Default, Clone)]
pub struct NoNoninteractiveTabindex;

declare_oxc_lint!(
    /// Disallow non-negative tabIndex on non-interactive elements.
    NoNoninteractiveTabindex,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow tabindex on non-interactive elements.",
);

impl Rule for NoNoninteractiveTabindex {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(JSXAttributeItem::Attribute(tab_index_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "tabindex")
        else {
            return;
        };
        let Some(tab_index_value) = tab_index_attribute.value.as_ref() else {
            return;
        };
        if no_noninteractive_tabindex_is_conditionally_tabbable(tab_index_value) {
            return;
        }
        let settings = no_noninteractive_tabindex_settings(ctx);
        let numeric_value = no_noninteractive_tabindex_parse_numeric_value(tab_index_value);
        if numeric_value.is_none() {
            if matches!(tab_index_value, JSXAttributeValue::ExpressionContainer(_))
                && !settings.allow_expression_values
                && !no_noninteractive_tabindex_has_named_attribute(
                    opening_element,
                    &KEYBOARD_HANDLER_NAMES,
                )
                && !no_noninteractive_tabindex_has_named_attribute(
                    opening_element,
                    &FOCUS_HANDLER_NAMES,
                )
                && !has_any_jsx_spread_attribute(opening_element)
            {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(tab_index_attribute.span));
            }
            return;
        }
        let numeric_value = numeric_value.expect("checked numeric tabIndex");
        if numeric_value < 0.0 || numeric_value.fract() != 0.0 {
            return;
        }
        let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
        if settings.tags.iter().any(|tag| tag == &element_type)
            || !HTML_TAG.contains(element_type.as_str())
            || element_type == "pre"
            || is_interactive_element(&element_type, opening_element)
            || no_noninteractive_tabindex_has_named_attribute(
                opening_element,
                &KEYBOARD_HANDLER_NAMES,
            )
            || no_noninteractive_tabindex_has_named_attribute(opening_element, &FOCUS_HANDLER_NAMES)
            || has_any_jsx_spread_attribute(opening_element)
            || has_jsx_prop_ignore_case(opening_element, "aria-label").is_some()
            || has_jsx_prop_ignore_case(opening_element, "aria-labelledby").is_some()
            || no_noninteractive_tabindex_is_tooltip_trigger(node, ctx)
            || no_noninteractive_tabindex_has_scrollable_class(opening_element)
            || no_noninteractive_tabindex_is_library_surface(opening_element)
            || no_noninteractive_tabindex_is_focus_trap_sentinel(node, opening_element, ctx)
        {
            return;
        }
        let Some(JSXAttributeItem::Attribute(role_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "role")
        else {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(tab_index_attribute.span));
            return;
        };
        if no_noninteractive_tabindex_role_suppresses(role_attribute, &settings) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(tab_index_attribute.span));
    }
}

fn no_noninteractive_tabindex_parse_numeric_value(value: &JSXAttributeValue<'_>) -> Option<f64> {
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return parse_static_jsx_number(value);
    };
    let expression = container.expression.as_expression()?;
    no_noninteractive_tabindex_parse_numeric_expression(expression)
}

fn no_noninteractive_tabindex_parse_numeric_expression(expression: &Expression<'_>) -> Option<f64> {
    let Expression::ConditionalExpression(conditional) = expression.get_inner_expression() else {
        return parse_static_expression(expression);
    };
    let selected =
        if no_noninteractive_tabindex_literal_truthiness(&conditional.test).unwrap_or(true) {
            &conditional.consequent
        } else {
            &conditional.alternate
        };
    no_noninteractive_tabindex_parse_numeric_expression(selected)
}

fn no_noninteractive_tabindex_literal_truthiness(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(value) => Some(value.value),
        Expression::NullLiteral(_) => Some(false),
        Expression::NumericLiteral(value) => Some(value.value != 0.0),
        Expression::BigIntLiteral(value) => Some(!value.is_zero()),
        Expression::StringLiteral(value) => Some(!value.value.is_empty()),
        Expression::RegExpLiteral(_) => Some(true),
        _ => None,
    }
}

struct NoNoninteractiveTabindexSettings {
    tags: Vec<String>,
    roles: Vec<String>,
    allow_expression_values: bool,
}

fn no_noninteractive_tabindex_settings(ctx: &LintContext<'_>) -> NoNoninteractiveTabindexSettings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("noNoninteractiveTabindex"));
    let string_array = |name: &str| {
        rule_settings
            .and_then(|settings| settings.get(name))
            .and_then(serde_json::Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
    };
    NoNoninteractiveTabindexSettings {
        tags: string_array("tags").unwrap_or_default(),
        roles: string_array("roles").unwrap_or_else(|| {
            DEFAULT_ALLOWED_ROLES
                .iter()
                .map(ToString::to_string)
                .collect()
        }),
        allow_expression_values: rule_settings
            .and_then(|settings| settings.get("allowExpressionValues"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
    }
}

fn no_noninteractive_tabindex_has_named_attribute(
    opening_element: &JSXOpeningElement<'_>,
    attribute_names: &[&str],
) -> bool {
    attribute_names
        .iter()
        .any(|name| has_jsx_prop_ignore_case(opening_element, name).is_some())
}

fn no_noninteractive_tabindex_is_conditionally_tabbable(value: &JSXAttributeValue<'_>) -> bool {
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return false;
    };
    let JSXExpression::ConditionalExpression(conditional) = &container.expression else {
        return false;
    };
    if no_noninteractive_tabindex_is_literal_expression(&conditional.test) {
        return false;
    }
    [&conditional.consequent, &conditional.alternate]
        .iter()
        .any(|branch| {
            no_noninteractive_tabindex_numeric_expression(branch).is_some_and(|value| value < 0.0)
                || no_noninteractive_tabindex_is_non_focusable_branch(branch)
        })
}

fn no_noninteractive_tabindex_is_literal_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::NullLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::RegExpLiteral(_)
    )
}

fn no_noninteractive_tabindex_numeric_expression(expression: &Expression<'_>) -> Option<f64> {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(value) => Some(value.value),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::UnaryNegation => {
            let Expression::NumericLiteral(value) = unary.argument.get_inner_expression() else {
                return None;
            };
            Some(-value.value)
        }
        _ => None,
    }
}

fn no_noninteractive_tabindex_is_non_focusable_branch(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::BooleanLiteral(value) => !value.value,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
        _ => false,
    }
}

fn no_noninteractive_tabindex_role_suppresses(
    role_attribute: &JSXAttribute<'_>,
    settings: &NoNoninteractiveTabindexSettings,
) -> bool {
    match role_attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(value)) => {
            value.value.split_whitespace().next().is_some_and(|role| {
                is_interactive_role(role) || settings.roles.iter().any(|allowed| allowed == role)
            })
        }
        Some(JSXAttributeValue::ExpressionContainer(_)) => settings.allow_expression_values,
        _ => false,
    }
}

fn no_noninteractive_tabindex_is_tooltip_like(element: &JSXElement<'_>) -> bool {
    let name = crate::utils::get_jsx_element_name(&element.opening_element.name);
    let lowercase = name.to_ascii_lowercase();
    lowercase.contains("tooltip") || lowercase.contains("popover")
}

fn no_noninteractive_tabindex_is_tooltip_trigger(
    opening_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let element_node = ctx.nodes().parent_node(opening_node.id());
    let AstKind::JSXElement(element) = element_node.kind() else {
        return false;
    };
    if element.children.iter().any(|child| {
        matches!(child, JSXChild::Element(child_element)
            if no_noninteractive_tabindex_is_tooltip_like(child_element))
    }) {
        return true;
    }
    let mut current = ctx.nodes().parent_node(element_node.id());
    loop {
        match current.kind() {
            AstKind::JSXElement(parent_element) => {
                return no_noninteractive_tabindex_is_tooltip_like(parent_element);
            }
            AstKind::VariableDeclarator(declarator) => {
                return matches!(&declarator.id, BindingPattern::BindingIdentifier(identifier)
                    if identifier.name.to_ascii_lowercase().contains("trigger"));
            }
            AstKind::JSXExpressionContainer(_)
            | AstKind::JSXFragment(_)
            | AstKind::ParenthesizedExpression(_) => {
                current = ctx.nodes().parent_node(current.id());
            }
            _ => return false,
        }
    }
}

fn no_noninteractive_tabindex_has_scrollable_class(
    opening_element: &JSXOpeningElement<'_>,
) -> bool {
    let Some(class_name) = has_jsx_prop_ignore_case(opening_element, "classname")
        .and_then(JSXAttributeItem::as_attribute)
        .and_then(no_noninteractive_tabindex_direct_string_value)
    else {
        return false;
    };
    class_name.split_whitespace().any(|token| {
        matches!(
            token.rsplit(':').next().unwrap_or(token),
            "overflow-auto"
                | "overflow-scroll"
                | "overflow-x-auto"
                | "overflow-x-scroll"
                | "overflow-y-auto"
                | "overflow-y-scroll"
        )
    })
}

fn no_noninteractive_tabindex_direct_string_value<'a>(
    attribute: &'a JSXAttribute<'a>,
) -> Option<&'a str> {
    let Some(JSXAttributeValue::StringLiteral(value)) = attribute.value.as_ref() else {
        return None;
    };
    Some(value.value.as_str())
}

fn no_noninteractive_tabindex_is_library_surface(opening_element: &JSXOpeningElement<'_>) -> bool {
    has_jsx_prop_ignore_case(opening_element, "ref").is_some()
        && no_noninteractive_tabindex_has_named_attribute(
            opening_element,
            &LIBRARY_SURFACE_HANDLER_NAMES,
        )
}

fn no_noninteractive_tabindex_is_focus_trap_sentinel(
    opening_node: &AstNode<'_>,
    opening_element: &JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let element_node = ctx.nodes().parent_node(opening_node.id());
    let AstKind::JSXElement(element) = element_node.kind() else {
        return false;
    };
    if element.closing_element.is_some()
        || opening_element.attributes.iter().any(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return true;
            };
            let oxc_ast::ast::JSXAttributeName::Identifier(name) = &attribute.name else {
                return true;
            };
            let lowercase = name.name.to_ascii_lowercase();
            !matches!(
                lowercase.as_str(),
                "tabindex" | "ref" | "key" | "style" | "classname" | "aria-hidden"
            ) && !lowercase.starts_with("data-")
        })
    {
        return false;
    }
    let container_node = ctx.nodes().parent_node(element_node.id());
    let AstKind::JSXElement(container) = container_node.kind() else {
        return false;
    };
    container.children.iter().any(|sibling| {
        matches!(sibling, JSXChild::Element(sibling_element)
            if sibling_element.span != element_node.span())
    })
}
