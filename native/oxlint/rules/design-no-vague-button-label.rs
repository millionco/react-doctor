use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const VAGUE_BUTTON_LABELS: [&str; 10] = [
    "continue",
    "submit",
    "ok",
    "okay",
    "click here",
    "here",
    "yes",
    "no",
    "go",
    "done",
];

#[derive(Debug, Default, Clone)]
pub struct DesignNoVagueButtonLabel;

declare_oxc_lint!(
    /// Disallow vague button labels.
    DesignNoVagueButtonLabel,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow vague button labels.",
);

impl Rule for DesignNoVagueButtonLabel {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let Some(tag_name) = get_opening_element_tag_name(&element.opening_element, ctx) else {
            return;
        };
        if !is_button_like_tag_name(tag_name) {
            return;
        }
        let Some(label_text) = collect_jsx_label_text(&element.children) else {
            return;
        };
        if label_text.is_empty() {
            return;
        }
        let normalized_label = normalize_button_label(&label_text);
        if !VAGUE_BUTTON_LABELS.contains(&normalized_label.as_str()) {
            return;
        }
        if normalized_label == "continue"
            && has_enclosing_form_with_previous_step_control(node, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Screen reader users may not know what \"{label_text}\" does. Use a specific action label."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn is_button_like_tag_name(tag_name: &str) -> bool {
    matches!(tag_name, "button" | "Button")
}

fn is_previous_step_control_tag_name(tag_name: &str) -> bool {
    is_button_like_tag_name(tag_name) || matches!(tag_name, "a" | "Link")
}

fn normalize_button_label(label_text: &str) -> String {
    label_text
        .to_lowercase()
        .trim_end_matches(['.', '!', '?', '…'])
        .trim()
        .to_string()
}

fn collect_jsx_label_text(children: &[oxc_ast::ast::JSXChild]) -> Option<String> {
    if children.is_empty() {
        return None;
    }
    let mut label_text = String::new();
    for child in children {
        match child {
            oxc_ast::ast::JSXChild::Text(text) => label_text.push_str(text.value.as_str()),
            oxc_ast::ast::JSXChild::ExpressionContainer(container) => {
                let expression = container.expression.as_expression()?;
                match expression {
                    oxc_ast::ast::Expression::StringLiteral(string_literal) => {
                        label_text.push_str(string_literal.value.as_str());
                    }
                    oxc_ast::ast::Expression::TemplateLiteral(template_literal)
                        if template_literal.expressions.is_empty()
                            && template_literal.quasis.len() == 1 =>
                    {
                        let quasi = &template_literal.quasis[0];
                        label_text.push_str(
                            quasi
                                .value
                                .cooked
                                .as_ref()
                                .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
                        );
                    }
                    _ => return None,
                }
            }
            oxc_ast::ast::JSXChild::Fragment(fragment) => {
                label_text.push_str(&collect_jsx_label_text(&fragment.children)?);
            }
            oxc_ast::ast::JSXChild::Element(_) => return None,
            _ => {}
        }
    }
    Some(label_text.trim().to_string())
}

fn has_enclosing_form_with_previous_step_control<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        if get_opening_element_tag_name(&element.opening_element, ctx) == Some("form") {
            return has_previous_step_control(&element.children, ctx);
        }
    }
    false
}

fn has_previous_step_control<'a>(
    children: &'a [oxc_ast::ast::JSXChild<'a>],
    ctx: &LintContext<'a>,
) -> bool {
    for child in children {
        match child {
            oxc_ast::ast::JSXChild::Fragment(fragment) => {
                if has_previous_step_control(&fragment.children, ctx) {
                    return true;
                }
            }
            oxc_ast::ast::JSXChild::Element(element) => {
                let tag_name = get_opening_element_tag_name(&element.opening_element, ctx);
                if tag_name.is_some_and(is_previous_step_control_tag_name)
                    && collect_jsx_label_text(&element.children)
                        .is_some_and(|label_text| matches!(normalize_button_label(&label_text).as_str(), "back" | "previous"))
                {
                    return true;
                }
                if has_previous_step_control(&element.children, ctx) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}
