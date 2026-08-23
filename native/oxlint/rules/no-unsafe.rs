use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    config::ReactVersion,
    context::LintContext,
    rule::Rule,
    utils::{get_parent_component, is_es5_component},
    AstNode,
};

#[derive(Debug, Default, Clone)]
pub struct NoUnsafe;

declare_oxc_lint!(
    /// Disallow unsafe legacy React lifecycle methods.
    NoUnsafe,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unsafe legacy React lifecycle methods.",
);

impl Rule for NoUnsafe {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::MethodDefinition(method_definition) => {
                let Some(method_name) = method_definition.key.static_name() else {
                    return;
                };
                if is_active_unsafe_method(method_name.as_ref(), ctx)
                    && get_parent_component(node, ctx).is_some()
                {
                    report_unsafe_method(method_name.as_ref(), method_definition.key.span(), ctx);
                }
            }
            AstKind::ObjectProperty(object_property) => {
                let Some(method_name) = object_property.key.static_name() else {
                    return;
                };
                if !is_active_unsafe_method(method_name.as_ref(), ctx) {
                    return;
                }
                if ctx.nodes().ancestors(node.id()).any(is_es5_component) {
                    report_unsafe_method(method_name.as_ref(), object_property.key.span(), ctx);
                }
            }
            _ => {}
        }
    }
}

fn is_active_unsafe_method(method_name: &str, ctx: &LintContext) -> bool {
    match method_name {
        "UNSAFE_componentWillMount"
        | "UNSAFE_componentWillReceiveProps"
        | "UNSAFE_componentWillUpdate" => ctx
            .settings()
            .react
            .version
            .as_ref()
            .is_none_or(ReactVersion::supports_unsafe_lifecycle_prefix),
        "componentWillMount" | "componentWillReceiveProps" | "componentWillUpdate" => {
            check_aliases(ctx)
        }
        _ => false,
    }
}

fn check_aliases(ctx: &LintContext) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("noUnsafe"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("checkAliases"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn report_unsafe_method(method_name: &str, span: oxc_span::Span, ctx: &LintContext) {
    let message = format!(
        "`{method_name}` runs during unsafe legacy render timing and is deprecated, so React may double-invoke or remove it."
    );
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(span));
}
