use oxc_ast::{
    ast::{Class, ClassElement, Expression, MemberExpression, PropertyKey},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::Span;

use crate::{context::LintContext, rule::Rule, AstNode};

#[derive(Debug, Default, Clone)]
pub struct NoRedundantShouldComponentUpdate;

declare_oxc_lint!(
    /// Disallow shouldComponentUpdate on PureComponent classes.
    NoRedundantShouldComponentUpdate,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow shouldComponentUpdate on PureComponent classes.",
);

impl Rule for NoRedundantShouldComponentUpdate {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::Class(class) = node.kind() else {
            return;
        };
        if !is_pure_component_super(class) {
            return;
        }
        let Some(report_span) = find_should_component_update(class) else {
            return;
        };
        let class_name = class
            .name()
            .map_or("<anonymous class>", |name| name.as_str());
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "`shouldComponentUpdate` fights PureComponent's built-in check in `{class_name}` & can skip needed updates."
            ))
            .with_label(report_span),
        );
    }
}

fn is_pure_component_super(class: &Class) -> bool {
    let Some(super_class) = class.heritage_expression() else {
        return false;
    };
    match super_class {
        Expression::Identifier(identifier) => identifier.name == "PureComponent",
        expression => {
            let Some(member_expression) = expression.as_member_expression() else {
                return false;
            };
            if !matches!(member_expression.object(), Expression::Identifier(identifier) if identifier.name == "React")
            {
                return false;
            }
            match member_expression {
                MemberExpression::StaticMemberExpression(member_expression) => {
                    member_expression.property.name == "PureComponent"
                }
                MemberExpression::ComputedMemberExpression(member_expression) => {
                    matches!(&member_expression.expression, Expression::Identifier(identifier) if identifier.name == "PureComponent")
                }
                MemberExpression::PrivateFieldExpression(_) => false,
            }
        }
    }
}

fn find_should_component_update(class: &Class) -> Option<Span> {
    class.body.body.iter().find_map(|element| {
        let key = match element {
            ClassElement::MethodDefinition(method) => &method.key,
            ClassElement::PropertyDefinition(property) => &property.key,
            _ => return None,
        };
        match key {
            PropertyKey::StaticIdentifier(identifier)
                if identifier.name == "shouldComponentUpdate" =>
            {
                Some(identifier.span)
            }
            PropertyKey::Identifier(identifier) if identifier.name == "shouldComponentUpdate" => {
                Some(identifier.span)
            }
            PropertyKey::StringLiteral(string_literal)
                if string_literal.value == "shouldComponentUpdate" =>
            {
                Some(string_literal.span)
            }
            _ => None,
        }
    })
}
