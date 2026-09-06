use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule, utils::is_es5_component};

const ALWAYS_MESSAGE: &str = "`createReactClass` is legacy and adds a dependency, so this component diverges from modern React class syntax.";
const NEVER_MESSAGE: &str = "This component uses an ES6 class where `createReactClass` is configured, so component style is inconsistent across the codebase.";

#[derive(Debug, Default, Clone)]
pub struct PreferEs6Class;

declare_oxc_lint!(
    /// Enforce the configured React class style.
    PreferEs6Class,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Enforce the configured React class style.",
);

impl Rule for PreferEs6Class {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let mode = prefer_es6_class_mode(ctx);
        match node.kind() {
            AstKind::CallExpression(call_expression)
                if mode == "always" && is_es5_component(node) =>
            {
                ctx.diagnostic(
                    OxcDiagnostic::warn(ALWAYS_MESSAGE).with_label(call_expression.span()),
                );
            }
            AstKind::Class(class) if mode != "always" && is_react_es6_component(node) => {
                ctx.diagnostic(
                    OxcDiagnostic::warn(NEVER_MESSAGE).with_label(
                        class
                            .id
                            .as_ref()
                            .map_or(class.span, |identifier| identifier.span),
                    ),
                );
            }
            _ => {}
        }
    }
}

fn prefer_es6_class_mode<'a>(ctx: &'a LintContext<'_>) -> &'a str {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("preferEs6Class"))
        .and_then(|settings| settings.get("mode"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("always")
}
