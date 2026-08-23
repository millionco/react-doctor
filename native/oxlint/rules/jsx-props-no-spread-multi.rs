use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct JsxPropsNoSpreadMulti;

declare_oxc_lint!(
    /// Disallow spreading the same prop value more than once.
    JsxPropsNoSpreadMulti,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow spreading the same prop value more than once.",
);

impl Rule for JsxPropsNoSpreadMulti {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let mut seen_names = FxHashSet::default();
        let mut reported_names = FxHashSet::default();
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::SpreadAttribute(spread_attribute) = attribute else {
                continue;
            };
            let Some(name) = flatten_member_expression_name(&spread_attribute.argument) else {
                continue;
            };
            if !seen_names.insert(name.clone()) && reported_names.insert(name.clone()) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "The later spread of `{name}` silently overrides the earlier one."
                    ))
                    .with_label(spread_attribute.span),
                );
            }
        }
    }
}

fn flatten_member_expression_name(expression: &Expression) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::ThisExpression(_) => Some("this".to_string()),
        expression => flatten_member_expression(expression.as_member_expression()?),
    }
}

fn flatten_member_expression(member_expression: &MemberExpression) -> Option<String> {
    let object_name = flatten_member_expression_name(member_expression.object())?;
    let property_name = match member_expression {
        MemberExpression::StaticMemberExpression(member_expression) => {
            member_expression.property.name.as_str()
        }
        MemberExpression::ComputedMemberExpression(member_expression) => {
            let Expression::StringLiteral(string_literal) = &member_expression.expression else {
                return None;
            };
            string_literal.value.as_str()
        }
        MemberExpression::PrivateFieldExpression(_) => return None,
    };
    Some(format!("{object_name}.{property_name}"))
}
