use oxc_ast::{AstKind, ast::FunctionType};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TABLE_ELEMENTS: [&str; 7] = ["table", "thead", "tbody", "tfoot", "tr", "td", "th"];
const ROW_GROUPS: [&str; 3] = ["thead", "tbody", "tfoot"];

#[derive(Debug, Default, Clone)]
pub struct HtmlNoInvalidTableNesting;

declare_oxc_lint!(
    /// Disallow invalid table element nesting.
    HtmlNoInvalidTableNesting,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow invalid table element nesting.",
);

impl Rule for HtmlNoInvalidTableNesting {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some((tag_name, name_span)) = resolve_jsx_element_type(opening_element, ctx) else {
            return;
        };
        if !starts_with_lowercase(tag_name) || !TABLE_ELEMENTS.contains(&tag_name) {
            return;
        }
        let element_node = ctx.nodes().parent_node(node.id());
        if !matches!(element_node.kind(), AstKind::JSXElement(_)) {
            return;
        }
        if tag_name == "table" {
            if has_enclosing_table(element_node, ctx) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(
                        "Your users see a broken table because a `<table>` can't sit directly inside another table element. To nest a table, put it inside a `<td>` or `<th>` cell.",
                    )
                    .with_label(name_span),
                );
            }
            return;
        }
        let Some(actual_parent) = find_closest_host_ancestor(element_node, ctx) else {
            return;
        };
        let expected_parent = if ROW_GROUPS.contains(&tag_name) {
            if actual_parent == "table" {
                return;
            }
            "`<table>`"
        } else if tag_name == "tr" {
            if ROW_GROUPS.contains(&actual_parent) || actual_parent == "table" {
                return;
            }
            "`<thead>`, `<tbody>`, or `<tfoot>`"
        } else {
            if actual_parent == "tr" {
                return;
            }
            "`<tr>`"
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users see a rearranged table because `<{tag_name}>` must sit directly inside {expected_parent}, not `<{actual_parent}>`, so the browser fixes the markup for you. Put it in the right parent."
            ))
            .with_label(name_span),
        );
    }
}

fn starts_with_lowercase(value: &str) -> bool {
    value
        .chars()
        .next()
        .is_some_and(|first_character| first_character.to_lowercase().eq(std::iter::once(first_character)))
}

fn find_closest_host_ancestor<'a>(
    element_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a str> {
    let mut previous = element_node;
    for ancestor in ctx.nodes().ancestors(element_node.id()) {
        if let AstKind::JSXElement(element) = ancestor.kind() {
            let Some((tag_name, _)) = resolve_jsx_element_type(&element.opening_element, ctx) else {
                return None;
            };
            if tag_name.is_empty() {
                previous = ancestor;
                continue;
            }
            return starts_with_lowercase(tag_name).then_some(tag_name);
        }
        if !is_render_flow_step(ancestor, previous) {
            return None;
        }
        previous = ancestor;
    }
    None
}

fn is_render_flow_step(parent: &AstNode<'_>, child: &AstNode<'_>) -> bool {
    match parent.kind() {
        AstKind::ParenthesizedExpression(_)
        | AstKind::TSAsExpression(_)
        | AstKind::TSSatisfiesExpression(_)
        | AstKind::TSTypeAssertion(_)
        | AstKind::TSNonNullExpression(_)
        | AstKind::TSInstantiationExpression(_)
        | AstKind::ChainExpression(_)
        | AstKind::JSXExpressionContainer(_)
        | AstKind::JSXFragment(_)
        | AstKind::ConditionalExpression(_)
        | AstKind::LogicalExpression(_)
        | AstKind::ReturnStatement(_)
        | AstKind::FunctionBody(_)
        | AstKind::BlockStatement(_)
        | AstKind::IfStatement(_)
        | AstKind::SwitchStatement(_)
        | AstKind::SwitchCase(_)
        | AstKind::ArrayExpression(_) => true,
        AstKind::ArrowFunctionExpression(function) => function.body.span() == child.span(),
        AstKind::Function(function) => {
            function.r#type == FunctionType::FunctionExpression
                && function
                    .body
                    .as_ref()
                    .is_some_and(|body| body.span == child.span())
        }
        AstKind::CallExpression(_) => match child.kind() {
            AstKind::ArrowFunctionExpression(_) => true,
            AstKind::Function(function) => function.r#type == FunctionType::FunctionExpression,
            _ => false,
        },
        _ => false,
    }
}

fn has_enclosing_table(element_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(element_node.id()) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        let Some((tag_name, _)) = resolve_jsx_element_type(&element.opening_element, ctx) else {
            return false;
        };
        if !starts_with_lowercase(tag_name) {
            return false;
        }
        if tag_name == "table" {
            return true;
        }
        if matches!(tag_name, "td" | "th") {
            return false;
        }
    }
    false
}
