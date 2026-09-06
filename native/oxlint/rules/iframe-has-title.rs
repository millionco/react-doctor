use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeName, JSXAttributeValue, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    globals::VALID_ARIA_ROLES,
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

const MESSAGE: &str = "Screen reader users cannot identify this `<iframe>` because it has no title. Add a `title` that describes its content.";

#[derive(Debug, Default, Clone)]
pub struct IframeHasTitle;

declare_oxc_lint!(
    /// Require iframe elements to have a descriptive title.
    IframeHasTitle,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require iframe elements to have a descriptive title.",
);

impl Rule for IframeHasTitle {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if is_local_test_scaffold_jsx(node, ctx)
            || resolve_configured_jsx_element_type(opening_element, ctx) != "iframe"
            || is_inside_statically_hidden_iframe_subtree(node, opening_element, ctx)
            || has_statically_negative_tab_index(opening_element)
            || has_statically_decorative_role(opening_element, ctx)
        {
            return;
        }
        let Some(title_attribute) =
            has_jsx_prop_ignore_case(opening_element, "title").and_then(|item| item.as_attribute())
        else {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
            return;
        };
        if is_missing_or_empty_title(title_attribute.value.as_ref()) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(title_attribute.span));
        }
    }
}

fn is_statically_aria_hidden(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "aria-hidden", false)
    else {
        return false;
    };
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(string_literal)) => string_literal.value == "true",
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            let expression = expression.get_inner_expression();
            matches!(
                expression,
                Expression::BooleanLiteral(boolean_literal) if boolean_literal.value
            ) || matches!(
                expression,
                Expression::StringLiteral(string_literal) if string_literal.value == "true"
            )
        }
        _ => false,
    }
}

fn has_statically_negative_tab_index(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "tabIndex", false)
    else {
        return false;
    };
    let Some(value) = attribute.value.as_ref() else {
        return false;
    };
    if matches!(
        value,
        JSXAttributeValue::ExpressionContainer(container)
            if matches!(
                container.expression.as_expression().map(Expression::get_inner_expression),
                Some(Expression::ConditionalExpression(conditional_expression))
                    if !is_literal_expression(&conditional_expression.test)
            )
    ) {
        return false;
    }
    parse_static_jsx_number(value).is_some_and(|tab_index| tab_index < 0.0)
}

fn is_literal_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::StringLiteral(_)
    )
}

fn has_statically_decorative_role<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "role", false) else {
        return false;
    };
    let Some(role_candidates) = get_static_jsx_attribute_string_values(attribute, ctx) else {
        return false;
    };
    !role_candidates.is_empty()
        && role_candidates.iter().all(|candidate| {
            candidate
                .split(|character| is_js_whitespace(character))
                .find(|role| VALID_ARIA_ROLES.contains(role))
                .is_some_and(|role| matches!(role, "none" | "presentation"))
        })
}

fn is_inside_statically_hidden_iframe_subtree<'a>(
    node: &AstNode<'a>,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_statically_aria_hidden(opening_element) {
        return true;
    }
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                if !matches!(
                    &attribute.name,
                    JSXAttributeName::Identifier(identifier) if identifier.name == "children"
                ) {
                    return false;
                }
            }
            AstKind::JSXElement(element) => {
                let ancestor_opening_element = &element.opening_element;
                if is_scoped_react_fragment_element(&ancestor_opening_element.name, ctx) {
                    continue;
                }
                let JSXElementName::Identifier(identifier) = &ancestor_opening_element.name else {
                    return false;
                };
                if identifier
                    .name
                    .chars()
                    .next()
                    .is_none_or(|character| !character.to_lowercase().eq(std::iter::once(character)))
                {
                    return false;
                }
                if is_statically_aria_hidden(ancestor_opening_element) {
                    return true;
                }
            }
            AstKind::CallExpression(_)
            | AstKind::NewExpression(_)
            | AstKind::VariableDeclarator(_)
            | AstKind::AssignmentExpression(_)
            | AstKind::ObjectProperty(_)
            | AstKind::Function(_)
            | AstKind::ArrowFunctionExpression(_)
            | AstKind::Program(_) => return false,
            _ => {}
        }
    }
    false
}

fn is_missing_or_empty_title(value: Option<&JSXAttributeValue<'_>>) -> bool {
    match value {
        None => true,
        Some(JSXAttributeValue::StringLiteral(string_literal)) => string_literal
            .value
            .trim_matches(|character| is_js_whitespace(character))
            .is_empty(),
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            match expression.get_inner_expression() {
                Expression::StringLiteral(string_literal) => string_literal
                    .value
                    .trim_matches(|character| is_js_whitespace(character))
                    .is_empty(),
                Expression::Identifier(identifier) => identifier.name == "undefined",
                Expression::TemplateLiteral(template_literal)
                    if template_literal.expressions.is_empty()
                        && template_literal.quasis.len() == 1 =>
                {
                    let quasi = &template_literal.quasis[0];
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                        .is_empty()
                }
                Expression::BooleanLiteral(_)
                | Expression::NullLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::BigIntLiteral(_)
                | Expression::RegExpLiteral(_) => true,
                _ => false,
            }
        }
        _ => false,
    }
}
