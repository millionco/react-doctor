use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeValue, JSXElementName, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Your keyboard users can't tell where they are because outline: none hides the focus ring, so style :focus-visible instead, or add a box-shadow focus ring.";

#[derive(Debug, Default, Clone)]
pub struct NoOutlineNone;

declare_oxc_lint!(
    /// Disallow removing a focus outline without a replacement indicator.
    NoOutlineNone,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow removing focus outlines without a replacement.",
);

impl Rule for NoOutlineNone {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(style_attribute) = node.kind() else {
            return;
        };
        let Some(style) = get_inline_style_object_expression(style_attribute) else {
            return;
        };
        let AstKind::JSXOpeningElement(opening_element) = ctx.nodes().parent_node(node.id()).kind()
        else {
            return;
        };
        if is_not_keyboard_focusable(opening_element)
            || find_jsx_attribute(opening_element, "aria-modal").is_some()
            || find_jsx_attribute(opening_element, "onFocus").is_some()
                && find_jsx_attribute(opening_element, "onBlur").is_some()
            || is_skip_nav_component(&opening_element.name)
        {
            return;
        }
        let Some(outline_property) = get_effective_static_style_property(style, "outline") else {
            return;
        };
        let outline_is_removed = match &outline_property.value {
            Expression::StringLiteral(value) => matches!(value.value.as_str(), "none" | "0"),
            _ => get_static_style_property_number_value(outline_property) == Some(0.0),
        };
        if !outline_is_removed
            || get_effective_static_style_property(style, "boxShadow").is_some()
            || get_static_class_name(opening_element).is_some_and(has_own_focus_ring_class)
            || renders_focus_manager_in_same_function(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(outline_property.span));
    }
}

fn is_not_keyboard_focusable(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(tab_index_attribute) = find_jsx_attribute(opening_element, "tabIndex") else {
        return false;
    };
    if let Some(JSXAttributeValue::ExpressionContainer(container)) = &tab_index_attribute.value
        && let JSXExpression::ConditionalExpression(conditional) = &container.expression
        && !is_literal_expression(&conditional.test)
    {
        return parse_numeric_expression(&conditional.consequent).is_some_and(|value| value < 0.0)
            && parse_numeric_expression(&conditional.alternate).is_some_and(|value| value < 0.0);
    }
    tab_index_attribute
        .value
        .as_ref()
        .and_then(|value| parse_static_jsx_number(value))
        .is_some_and(|value| value < 0.0)
}

fn is_literal_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::BigIntLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::StringLiteral(_)
    )
}

fn parse_numeric_expression(expression: &Expression<'_>) -> Option<f64> {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(value) => Some(value.value),
        Expression::StringLiteral(value) => parse_finite_number(value.value.as_str()),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation =>
        {
            parse_numeric_expression(&unary.argument).map(|value| -value)
        }
        _ => None,
    }
}

fn is_skip_nav_component(element_name: &JSXElementName<'_>) -> bool {
    matches!(
        element_name,
        JSXElementName::Identifier(identifier)
            if identifier.name.to_ascii_lowercase().contains("skipnav")
    ) || matches!(
        element_name,
        JSXElementName::IdentifierReference(identifier)
            if identifier.name.to_ascii_lowercase().contains("skipnav")
    )
}

fn has_own_focus_ring_class(class_name: &str) -> bool {
    let candidates = tailwind_class_name_tokens(class_name)
        .into_iter()
        .filter_map(|token| {
            if !token
                .variants
                .iter()
                .any(|variant| matches!(*variant, "focus" | "focus-visible"))
            {
                return None;
            }
            let focus_style_family = get_focus_style_family(token.utility)?;
            let mut variant_scope = token.variants;
            variant_scope.sort_unstable();
            Some((
                variant_scope,
                focus_style_family,
                token.is_important,
                is_focus_style_adding_utility(token.utility),
            ))
        })
        .collect::<Vec<_>>();
    candidates.iter().any(|candidate| {
        let has_important = candidates
            .iter()
            .any(|other| other.0 == candidate.0 && other.1 == candidate.1 && other.2);
        if !candidate.3 || has_important && !candidate.2 {
            return false;
        }
        candidates.iter().all(|other| {
            other.0 != candidate.0 || other.1 != candidate.1 || has_important && !other.2 || other.3
        })
    })
}

fn get_focus_style_family(utility: &str) -> Option<&'static str> {
    if utility == "ring" || utility.starts_with("ring-") && !utility.starts_with("ring-offset") {
        Some("ring")
    } else if utility == "outline" || utility.starts_with("outline-") {
        Some("outline")
    } else if utility == "shadow" || utility.starts_with("shadow-") {
        Some("shadow")
    } else {
        None
    }
}

fn is_focus_style_adding_utility(utility: &str) -> bool {
    if matches!(utility, "ring" | "outline" | "shadow") {
        return true;
    }
    if utility.starts_with("ring-offset")
        || matches!(utility, "ring-0" | "ring-transparent")
        || matches!(utility, "outline-none" | "outline-0" | "outline-hidden")
        || utility == "shadow-none"
    {
        return false;
    }
    utility.starts_with("ring-")
        || utility.starts_with("outline-")
        || utility.starts_with("shadow-")
}

fn renders_focus_manager_in_same_function(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut scope_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        scope_span = ancestor.span();
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            return false;
        };
        candidate.span().start >= scope_span.start
            && candidate.span().end <= scope_span.end
            && jsx_element_name_trailing_segment(&opening_element.name)
                .is_some_and(|name| name.contains("FocusManager"))
    })
}
