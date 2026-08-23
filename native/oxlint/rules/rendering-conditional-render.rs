use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const NUMERIC_NAME_HINTS: [&str; 5] = ["count", "length", "total", "size", "num"];
const BOOLEAN_NAME_PREFIXES: [&str; 26] = [
    "is", "has", "had", "can", "could", "should", "shall", "will", "would", "did", "does", "was",
    "were", "show", "shows", "hide", "hidden", "allow", "allows", "auto", "enable", "enabled",
    "disable", "disabled", "with", "without",
];
const MESSAGE: &str = "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.";

#[derive(Debug, Default, Clone)]
pub struct RenderingConditionalRender;

declare_oxc_lint!(
    /// Disallow numeric values directly before JSX logical AND expressions.
    RenderingConditionalRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow numeric values directly before JSX logical AND expressions.",
);

impl Rule for RenderingConditionalRender {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::LogicalExpression(logical_expression) = node.kind() else {
            return;
        };
        if !logical_expression.operator.is_and()
            || !matches!(
                strip_parenthesized_expression(&logical_expression.right),
                Expression::JSXElement(_) | Expression::JSXFragment(_)
            )
        {
            return;
        }
        let has_numeric_left_side = match &logical_expression.left {
            Expression::Identifier(identifier) => is_numeric_name(identifier.name.as_str()),
            expression => expression
                .as_member_expression()
                .is_some_and(|member_expression| {
                    member_expression_identifier_property_name(member_expression) == Some("length")
                }),
        };
        if has_numeric_left_side {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(logical_expression.span));
        }
    }
}

fn is_numeric_name(name: &str) -> bool {
    if starts_with_boolean_prefix(name) {
        return false;
    }
    NUMERIC_NAME_HINTS.iter().any(|hint| {
        name == *hint
            || name.ends_with(&format!("{}{}", hint[..1].to_ascii_uppercase(), &hint[1..]))
            || name.ends_with(&format!("_{hint}"))
            || name.ends_with(&format!("_{}", hint.to_ascii_uppercase()))
    })
}

fn starts_with_boolean_prefix(name: &str) -> bool {
    BOOLEAN_NAME_PREFIXES.iter().any(|prefix| {
        name.strip_prefix(prefix).is_some_and(|suffix| {
            suffix.chars().next().is_some_and(|character| {
                character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
            })
        }) || name.starts_with(&format!("{}_", prefix.to_ascii_uppercase()))
    })
}
