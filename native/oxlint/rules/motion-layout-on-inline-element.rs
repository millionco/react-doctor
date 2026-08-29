use crate::{AstNode, context::LintContext, rule::Rule};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeValue, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
const MESSAGE: &str = "Motion cannot apply its transform-based layout animation while this element is display: inline. Use inline-block, block, flex, or grid.";
#[derive(Debug, Default, Clone)]
pub struct MotionLayoutOnInlineElement;
declare_oxc_lint!(
    /// Disallows Motion layout animation on inline elements.
    MotionLayoutOnInlineElement,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow Motion layout animation on inline elements."
);
impl Rule for MotionLayoutOnInlineElement {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(open) = node.kind() else {
            return;
        };
        if open
            .attributes
            .iter()
            .any(|a| matches!(a, oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)))
            || !is_proven_motion_jsx_element(&open.name, ctx)
        {
            return;
        }
        let enabled = motion_layout_attribute(open, "layoutId").is_some()
            || motion_layout_attribute(open, "layout").is_some_and(motion_layout_enabled);
        if !enabled {
            return;
        }
        if let Some(style) = motion_layout_attribute(open, "style") {
            let Some(object) = motion_layout_style_object(style) else {
                return;
            };
            let mut display = None;
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return;
                };
                let Some(name) = property.key.static_name() else {
                    return;
                };
                if name == "display" {
                    display = Some(property);
                }
            }
            if let Some(display) = display {
                if matches!(display.value.get_inner_expression(), Expression::StringLiteral(value) if value.value == "inline")
                {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(display.span));
                }
                return;
            }
        }
        if open.attributes.iter().filter(|attribute| matches!(attribute, oxc_ast::ast::JSXAttributeItem::Attribute(attribute) if matches!(&attribute.name, oxc_ast::ast::JSXAttributeName::Identifier(identifier) if identifier.name == "className"))).count() > 1 {
            return;
        }
        let Some(class) = motion_layout_attribute(open, "className") else {
            return;
        };
        let Some(value) = motion_layout_string(class) else {
            return;
        };
        let tokens = value
            .split_ascii_whitespace()
            .filter(|t| !t.contains(':'))
            .map(|token| token.trim_start_matches('!').trim_end_matches('!'))
            .collect::<Vec<_>>();
        if tokens.contains(&"inline")
            && !tokens
                .iter()
                .any(|token| motion_layout_display_token(token) && *token != "inline")
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(class.span));
        }
    }
}
fn motion_layout_enabled(a: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    if a.value.is_none() {
        return true;
    }
    matches!(
        motion_layout_string(a),
        Some("position" | "preserve-aspect" | "size")
    ) || matches!(a.value.as_ref(),Some(JSXAttributeValue::ExpressionContainer(c))if matches!(c.expression.as_expression().map(Expression::get_inner_expression),Some(Expression::BooleanLiteral(v))if v.value))
}
fn motion_layout_string<'a>(a: &'a oxc_ast::ast::JSXAttribute<'a>) -> Option<&'a str> {
    match a.value.as_ref()? {
        JSXAttributeValue::StringLiteral(v) => Some(v.value.as_str()),
        JSXAttributeValue::ExpressionContainer(c) => {
            match c.expression.as_expression()?.get_inner_expression() {
                Expression::StringLiteral(v) => Some(v.value.as_str()),
                Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
                    t.quasis.first().map(|q| q.value.raw.as_str())
                }
                _ => None,
            }
        }
        _ => None,
    }
}
fn motion_layout_style_object<'a>(
    a: &'a oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    let JSXAttributeValue::ExpressionContainer(c) = a.value.as_ref()? else {
        return None;
    };
    let Expression::ObjectExpression(object) = c.expression.as_expression()?.get_inner_expression()
    else {
        return None;
    };
    Some(object)
}
fn motion_layout_attribute<'a, 'b>(
    opening: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    name: &str,
) -> Option<&'b oxc_ast::ast::JSXAttribute<'a>> {
    opening.attributes.iter().rev().find_map(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        matches!(&attribute.name, oxc_ast::ast::JSXAttributeName::Identifier(identifier) if identifier.name == name)
            .then_some(attribute.as_ref())
    })
}
fn motion_layout_display_token(token: &str) -> bool {
    matches!(
        token,
        "block"
            | "inline-block"
            | "inline"
            | "flex"
            | "inline-flex"
            | "table"
            | "inline-table"
            | "table-caption"
            | "table-cell"
            | "table-column"
            | "table-column-group"
            | "table-footer-group"
            | "table-header-group"
            | "table-row-group"
            | "table-row"
            | "flow-root"
            | "grid"
            | "inline-grid"
            | "contents"
            | "list-item"
            | "hidden"
    )
}
