use oxc_ast::{AstKind, ast::ClassElement};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::LintContext,
    rule::Rule,
    utils::{expression_contains_jsx, function_contains_jsx},
};

const MESSAGE: &str = "This class component keeps behavior in lifecycle methods, so state and effects are harder to follow than in a hook-based function component.";

#[derive(Debug, Default, Clone)]
pub struct PreferFunctionComponent;

declare_oxc_lint!(
    /// Prefer React function components over class components.
    PreferFunctionComponent,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Prefer React function components over class components.",
);

impl Rule for PreferFunctionComponent {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::Class(class) = node.kind() else {
            return;
        };
        let settings = prefer_function_component_settings(ctx);
        if !is_react_es6_component(node)
            && (!settings.allow_jsx_utility_class || !class_body_contains_jsx(class))
        {
            return;
        }
        if settings.allow_error_boundary && is_error_boundary(class) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(MESSAGE).with_label(
                class
                    .id
                    .as_ref()
                    .map_or(class.span, |identifier| identifier.span),
            ),
        );
    }
}

struct PreferFunctionComponentSettings {
    allow_error_boundary: bool,
    allow_jsx_utility_class: bool,
}

fn prefer_function_component_settings(ctx: &LintContext<'_>) -> PreferFunctionComponentSettings {
    let settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("preferFunctionComponent"));
    PreferFunctionComponentSettings {
        allow_error_boundary: settings
            .and_then(|settings| settings.get("allowErrorBoundary"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
        allow_jsx_utility_class: settings
            .and_then(|settings| settings.get("allowJsxUtilityClass"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}

fn is_error_boundary(class: &oxc_ast::ast::Class<'_>) -> bool {
    class.body.body.iter().any(|element| {
        let ClassElement::MethodDefinition(method) = element else {
            return false;
        };
        matches!(
            method.key.static_name().as_deref(),
            Some("componentDidCatch" | "getDerivedStateFromError")
        )
    })
}

fn class_body_contains_jsx(class: &oxc_ast::ast::Class<'_>) -> bool {
    class.body.body.iter().any(|element| match element {
        ClassElement::MethodDefinition(method) => function_contains_jsx(&method.value),
        ClassElement::PropertyDefinition(property) => property
            .value
            .as_ref()
            .is_some_and(|value| expression_contains_jsx(value)),
        _ => false,
    })
}
