use oxc_ast::{AstKind, ast::BindingPattern};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    AstNode,
    context::LintContext,
    rule::{DefaultRuleConfig, Rule},
    utils::is_react_function_call,
};

const REQUIRE_DESTRUCTURE_MESSAGE: &str = "`useState` should be destructured as `[value, setValue]` so readers can see the state value and setter together.";
const NAMING_CONVENTION_MESSAGE: &str =
    "This `useState` setter does not match its value name, so updates are harder to trace.";

#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
struct HookUseStateConfig {
    allow_destructured_state: bool,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema)]
pub struct HookUseState(HookUseStateConfig);

declare_oxc_lint!(
    /// Enforces useState pair destructuring and symmetric setter names.
    HookUseState,
    react_doctor_native,
    style,
    pending,
    config = HookUseState,
    version = "0.1.0",
    short_description = "Enforces useState pair destructuring and symmetric setter names.",
);

impl Rule for HookUseState {
    fn from_configuration(value: serde_json::Value) -> Result<Self, serde_json::Error> {
        DefaultRuleConfig::<Self>::from_value(value).map(DefaultRuleConfig::into_inner)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(state_call) = node.kind() else {
            return;
        };
        if !is_react_function_call(state_call, "useState") {
            return;
        }
        let expression_root = transparent_expression_root(node, ctx);
        let expression_parent = ctx.nodes().parent_node(expression_root.id());
        if matches!(expression_parent.kind(), AstKind::ReturnStatement(_))
            || matches!(
                expression_parent.kind(),
                AstKind::ArrowFunctionExpression(arrow_function)
                    if arrow_function
                        .get_expression()
                        .is_some_and(|expression| expression.span() == expression_root.kind().span())
            )
        {
            return;
        }

        let parent = ctx.nodes().parent_node(node.id());
        let AstKind::VariableDeclarator(declarator) = parent.kind() else {
            ctx.diagnostic(require_destructure_diagnostic(state_call.span));
            return;
        };
        let BindingPattern::ArrayPattern(array_pattern) = &declarator.id else {
            ctx.diagnostic(require_destructure_diagnostic(declarator.span));
            return;
        };
        if array_pattern.elements.len() != 2 || array_pattern.rest.is_some() {
            ctx.diagnostic(require_destructure_diagnostic(array_pattern.span));
            return;
        }
        let Some(value_pattern) = &array_pattern.elements[0] else {
            return;
        };
        let Some(setter_pattern) = &array_pattern.elements[1] else {
            return;
        };
        if setter_pattern.is_destructuring_pattern() {
            ctx.diagnostic(require_destructure_diagnostic(array_pattern.span));
            return;
        }
        if value_pattern.is_destructuring_pattern() {
            if !self.0.allow_destructured_state {
                ctx.diagnostic(require_destructure_diagnostic(array_pattern.span));
            }
            return;
        }
        let Some(value_name) = value_pattern.get_identifier_name() else {
            return;
        };
        let Some(setter_name) = setter_pattern.get_identifier_name() else {
            return;
        };
        let Some((lowercase_prefix, suffix)) = split_leading_lowercase(value_name.as_str()) else {
            ctx.diagnostic(naming_convention_diagnostic(array_pattern.span));
            return;
        };
        let expected_setter_names = expected_setter_names(lowercase_prefix, suffix);
        if expected_setter_names
            .iter()
            .any(|expected_name| expected_name == setter_name.as_str())
        {
            return;
        }
        ctx.diagnostic(naming_convention_diagnostic(array_pattern.span));
    }
}

fn require_destructure_diagnostic(span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(REQUIRE_DESTRUCTURE_MESSAGE).with_label(span)
}

fn naming_convention_diagnostic(span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(NAMING_CONVENTION_MESSAGE).with_label(span)
}

fn split_leading_lowercase(name: &str) -> Option<(&str, &str)> {
    let split_index = name
        .chars()
        .take_while(char::is_ascii_lowercase)
        .map(char::len_utf8)
        .sum();
    (split_index > 0).then(|| name.split_at(split_index))
}

fn expected_setter_names(prefix: &str, suffix: &str) -> [String; 2] {
    let mut capitalized_prefix = prefix.chars();
    let first_name = format!(
        "set{}{}{}",
        capitalized_prefix
            .next()
            .into_iter()
            .flat_map(char::to_uppercase)
            .collect::<String>(),
        capitalized_prefix.as_str(),
        suffix
    );
    [first_name, format!("set{}{suffix}", prefix.to_uppercase())]
}
