use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName, JSXChild, JSXElementName, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str =
    "Your users see this comment as text on the page because `//` & `/*` aren't hidden in JSX.";
const LITERAL_TEXT_TAGS: [&str; 5] = ["code", "pre", "kbd", "samp", "tt"];
const STYLING_ATTRIBUTE_NAMES: [&str; 3] = ["className", "class", "style"];

#[derive(Debug, Default, Clone)]
pub struct JsxNoCommentTextnodes;

declare_oxc_lint!(
    /// Disallow accidental comment text rendered as JSX children.
    JsxNoCommentTextnodes,
    react_doctor_native,
    suspicious,
    version = "0.1.0",
    short_description = "Disallow accidental comment text rendered as JSX children.",
);

impl Rule for JsxNoCommentTextnodes {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXText(jsx_text) = node.kind() else {
            return;
        };
        if !has_comment_like_pattern(&jsx_text.value, follows_expression_container(node, ctx))
            || is_inside_literal_text_tag(node, ctx)
            || is_deliberate_styled_comment_token(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(jsx_text.span));
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }
}

fn has_comment_like_pattern(text: &str, follows_expression_container: bool) -> bool {
    text.split('\n').enumerate().any(|(line_index, raw_line)| {
        let trimmed = raw_line.trim();
        if trimmed.starts_with("/*") {
            return true;
        }
        let Some(comment_body) = trimmed.strip_prefix("//") else {
            return false;
        };
        let trimmed_comment_body = comment_body.trim_start();
        if trimmed_comment_body.is_empty() {
            return false;
        }
        !(line_index == 0
            && follows_expression_container
            && trimmed_comment_body
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_digit))
    })
}

fn follows_expression_container(node: &AstNode, ctx: &LintContext) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let children = match parent.kind() {
        AstKind::JSXElement(element) => &element.children,
        AstKind::JSXFragment(fragment) => &fragment.children,
        _ => return false,
    };
    let Some(child_index) = children
        .iter()
        .position(|child| child.span() == node.span())
    else {
        return false;
    };
    if child_index == 0 {
        return false;
    }
    matches!(
        &children[child_index - 1],
        JSXChild::ExpressionContainer(container)
            if !matches!(container.expression, JSXExpression::EmptyExpression(_))
    )
}

fn is_inside_literal_text_tag(node: &AstNode, ctx: &LintContext) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        matches!(
            &element.opening_element.name,
            JSXElementName::Identifier(identifier)
                if LITERAL_TEXT_TAGS.contains(&identifier.name.as_str())
        )
    })
}

fn is_deliberate_styled_comment_token(node: &AstNode, ctx: &LintContext) -> bool {
    let AstKind::JSXText(jsx_text) = node.kind() else {
        return false;
    };
    let trimmed = jsx_text.value.trim();
    if !trimmed.starts_with("//") && !trimmed.starts_with("/*") {
        return false;
    }
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::JSXElement(element) = parent.kind() else {
        return false;
    };
    if element.children.iter().any(|child| match child {
        JSXChild::Text(text) => text.span != jsx_text.span && !text.value.trim().is_empty(),
        _ => child.span() != jsx_text.span,
    }) {
        return false;
    }
    element.opening_element.attributes.iter().any(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier)
                if STYLING_ATTRIBUTE_NAMES.contains(&identifier.name.as_str())
        )
    })
}
