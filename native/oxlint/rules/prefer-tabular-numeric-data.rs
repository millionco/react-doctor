use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const NUMERIC_FORMAT_METHODS: [&str; 4] =
    ["toExponential", "toFixed", "toLocaleString", "toPrecision"];
const NUMERIC_FORMAT_NAMES: [&str; 8] = [
    "amount", "currency", "money", "number", "percent", "price", "score", "total",
];
const MESSAGE: &str = "This table cell renders a changing formatted number with proportional figures. Add `tabular-nums` to the numeric column or an ancestor.";

#[derive(Debug, Default, Clone)]
pub struct PreferTabularNumericData;

declare_oxc_lint!(
    /// Require tabular numerals for dynamically formatted table values.
    PreferTabularNumericData,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Prefer tabular numerals for numeric table data.",
);

impl Rule for PreferTabularNumericData {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !matches!(
            &element.opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "td"
        ) || has_inherited_tabular_numerals(element, node, ctx)
            || !element.children.iter().any(|child| {
                let oxc_ast::ast::JSXChild::ExpressionContainer(container) = child else {
                    return false;
                };
                container
                    .expression
                    .as_expression()
                    .is_some_and(is_numeric_formatting_expression)
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn has_inherited_tabular_numerals(
    element: &oxc_ast::ast::JSXElement,
    node: &AstNode,
    ctx: &LintContext,
) -> bool {
    has_tabular_numeral_class(&element.opening_element)
        || ctx.nodes().ancestors(node.id()).any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::JSXElement(element)
                    if has_tabular_numeral_class(&element.opening_element)
            )
        })
}

fn has_tabular_numeral_class(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    get_static_class_name(opening_element).is_some_and(|class_name| {
        tailwind_class_name_tokens(class_name).iter().any(|token| {
            token.variants.is_empty() && matches!(token.utility, "tabular-nums" | "font-mono")
        })
    })
}

fn is_numeric_formatting_expression(expression: &oxc_ast::ast::Expression) -> bool {
    let oxc_ast::ast::Expression::CallExpression(call_expression) =
        expression.get_inner_expression()
    else {
        return false;
    };
    match call_expression.callee.get_inner_expression() {
        oxc_ast::ast::Expression::Identifier(identifier) => {
            is_numeric_format_function_name(identifier.name.as_str())
        }
        oxc_ast::ast::Expression::StaticMemberExpression(member_expression) => {
            NUMERIC_FORMAT_METHODS.contains(&member_expression.property.name.as_str())
        }
        _ => false,
    }
}

fn is_numeric_format_function_name(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    let candidate = lowercase_name
        .strip_prefix("format")
        .unwrap_or(lowercase_name.as_str());
    NUMERIC_FORMAT_NAMES.contains(&candidate)
}
