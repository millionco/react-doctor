use oxc_ast::{
    AstKind,
    ast::{Expression, MemberExpression, PropertyKey},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule, utils::is_es6_component};

const ALWAYS_MESSAGE: &str = "This class uses a state field instead of the configured constructor pattern, so state setup is inconsistent across the codebase.";
const NEVER_MESSAGE: &str = "This class sets state in the constructor instead of the configured class-field pattern, so state setup is inconsistent across the codebase.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StateMode {
    Always,
    Never,
}

#[derive(Debug, Default, Clone)]
pub struct StateInConstructor;

declare_oxc_lint!(
    /// Enforce one React class-state initialization pattern.
    StateInConstructor,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Enforce a consistent class-state initialization pattern.",
);

impl Rule for StateInConstructor {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let Some(mode) = state_mode(ctx) else {
            return;
        };
        let report = match node.kind() {
            AstKind::PropertyDefinition(property_definition)
                if mode == StateMode::Always
                    && !property_definition.r#static
                    && is_state_key(&property_definition.key)
                    && is_inside_es6_component(node, ctx) =>
            {
                Some((ALWAYS_MESSAGE, property_definition.key.span()))
            }
            AstKind::AssignmentExpression(assignment_expression)
                if mode == StateMode::Never
                    && is_inside_constructor(node, ctx)
                    && is_inside_es6_component(node, ctx) =>
            {
                assignment_expression
                    .left
                    .as_simple_assignment_target()
                    .and_then(|target| target.as_member_expression())
                    .filter(|member_expression| is_this_state(member_expression))
                    .map(|member_expression| (NEVER_MESSAGE, member_expression.span()))
            }
            _ => None,
        };
        let Some((message, span)) = report else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(span));
    }
}

fn is_state_key(key: &PropertyKey) -> bool {
    match key {
        PropertyKey::StaticIdentifier(identifier) => identifier.name == "state",
        PropertyKey::StringLiteral(string_literal) => string_literal.value == "state",
        _ => false,
    }
}

fn is_this_state(member_expression: &MemberExpression) -> bool {
    let (object, has_state_property) = match member_expression {
        MemberExpression::StaticMemberExpression(member_expression) => (
            &member_expression.object,
            member_expression.property.name == "state",
        ),
        MemberExpression::ComputedMemberExpression(member_expression) => (
            &member_expression.object,
            matches!(
                &member_expression.expression,
                Expression::Identifier(identifier) if identifier.name == "state"
            ) || matches!(
                &member_expression.expression,
                Expression::StringLiteral(string_literal) if string_literal.value == "state"
            ),
        ),
        MemberExpression::PrivateFieldExpression(_) => return false,
    };
    has_state_property && matches!(object, Expression::ThisExpression(_))
}

fn is_inside_es6_component<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)))
        .is_some_and(is_es6_component)
}

fn is_inside_constructor<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::MethodDefinition(method_definition)
                if method_definition.kind.is_constructor() =>
            {
                return true;
            }
            AstKind::Class(_) => return false,
            _ => {}
        }
    }
    false
}

fn state_mode(ctx: &LintContext) -> Option<StateMode> {
    let configured_mode = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("stateInConstructor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("mode"));
    match configured_mode {
        None | Some(serde_json::Value::Null) => Some(StateMode::Always),
        Some(serde_json::Value::String(mode)) if mode == "always" => Some(StateMode::Always),
        Some(serde_json::Value::String(mode)) if mode == "never" => Some(StateMode::Never),
        _ => None,
    }
}
