use oxc_ast::{
    AstKind, MemberExpressionKind,
    ast::{
        Expression, JSXAttribute, JSXAttributeName, JSXAttributeValue, JSXExpression,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::get_parent_component,
};

const STRING_IN_REF_MESSAGE: &str =
    "Your component can't reach this node because string refs don't work in modern React.";
const THIS_REFS_MESSAGE: &str =
    "Your component can't reach its nodes because `this.refs` is empty in modern React.";

#[derive(Debug, Default, Clone)]
pub struct NoStringRefs;

declare_oxc_lint!(
    /// Disallow legacy string refs and this.refs access.
    NoStringRefs,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow legacy React string refs.",
);

impl Rule for NoStringRefs {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let report = match node.kind() {
            AstKind::JSXAttribute(attribute)
                if is_string_literal_ref_attribute(attribute, no_template_literals(ctx)) =>
            {
                Some((STRING_IN_REF_MESSAGE, attribute.span))
            }
            member_kind if member_kind.is_member_expression_kind() => {
                let Some(member_expression) = member_kind.as_member_expression_kind() else {
                    return;
                };
                if is_this_refs(member_expression) && get_parent_component(node, ctx).is_some() {
                    Some((THIS_REFS_MESSAGE, member_expression.span()))
                } else {
                    None
                }
            }
            _ => None,
        };
        let Some((message, span)) = report else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(span));
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }
}

fn is_string_literal_ref_attribute(attribute: &JSXAttribute, no_templates: bool) -> bool {
    if !matches!(
        &attribute.name,
        JSXAttributeName::Identifier(identifier) if identifier.name == "ref"
    ) {
        return false;
    }
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(_)) => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            matches!(container.expression, JSXExpression::StringLiteral(_))
                || (no_templates
                    && matches!(container.expression, JSXExpression::TemplateLiteral(_)))
        }
        _ => false,
    }
}

fn is_this_refs(member_expression: MemberExpressionKind) -> bool {
    let (object, has_refs_property) = match member_expression {
        MemberExpressionKind::Static(member_expression) => (
            &member_expression.object,
            member_expression.property.name == "refs",
        ),
        MemberExpressionKind::Computed(member_expression) => (
            &member_expression.object,
            matches!(
                &member_expression.expression,
                Expression::Identifier(identifier) if identifier.name == "refs"
            ),
        ),
        MemberExpressionKind::PrivateField(_) => return false,
    };
    has_refs_property && matches!(object, Expression::ThisExpression(_))
}

fn no_template_literals(ctx: &LintContext) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("noStringRefs"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("noTemplateLiterals"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}
