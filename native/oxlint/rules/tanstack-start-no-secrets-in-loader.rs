use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct TanstackStartNoSecretsInLoader;

declare_oxc_lint!(
    /// Disallow secret environment variables in isomorphic TanStack Start loaders.
    TanstackStartNoSecretsInLoader,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow secrets in TanStack Start loaders.",
);

impl Rule for TanstackStartNoSecretsInLoader {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::StaticMemberExpression(secret_access) = node.kind() else {
            return;
        };
        let Some(environment_source) = environment_source(&secret_access.object, ctx) else {
            return;
        };
        let environment_variable = secret_access.property.name.as_str();
        if !is_likely_secret(environment_variable) {
            return;
        }

        let mut route_property = None;
        for ancestor in ctx.nodes().ancestors(node.id()) {
            if let AstKind::CallExpression(call_expression) = ancestor.kind() {
                if call_expression
                    .callee
                    .as_member_expression()
                    .is_some_and(|member| member.static_property_name() == Some("handler"))
                    && walk_tanstack_server_fn_chain(call_expression).is_server_fn_chain
                {
                    return;
                }
                if let Some((property_span, property_name)) = route_property.as_ref()
                    && let Some(options) = get_tanstack_route_options_object(call_expression)
                    && options.properties.iter().any(|property| {
                        matches!(
                            property,
                            ObjectPropertyKind::ObjectProperty(property)
                                if property.span == *property_span
                        )
                    })
                {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(format!(
                            "Reading {environment_source}.{environment_variable} in {property_name} leaks this secret to the client, where anyone can read it."
                        ))
                        .with_label(secret_access.span),
                    );
                    return;
                }
            }
            if let AstKind::ObjectProperty(property) = ancestor.kind()
                && let Some(property_name) = property.key.static_name()
                && matches!(property_name.as_ref(), "loader" | "beforeLoad")
            {
                route_property = Some((property.span, property_name.to_string()));
            }
        }
    }
}

fn environment_source(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<&'static str> {
    let Expression::StaticMemberExpression(environment_member) = expression.get_inner_expression()
    else {
        return None;
    };
    if environment_member.property.name != "env" {
        return None;
    }
    match environment_member.object.get_inner_expression() {
        Expression::Identifier(identifier) if identifier.name == "process" => Some("process.env"),
        expression => {
            let span = expression.span();
            let source = &ctx.source_text()[span.start as usize..span.end as usize];
            matches!(source, "import.meta" | "new.target").then_some("import.meta.env")
        }
    }
}

fn is_likely_secret(environment_variable: &str) -> bool {
    if matches!(environment_variable, "NODE_ENV" | "MODE" | "DEV" | "PROD") {
        return false;
    }
    let lowercase_name = environment_variable.to_ascii_lowercase();
    lowercase_name.contains("secret")
        || lowercase_name.contains("token")
        || lowercase_name.contains("api_key")
        || lowercase_name.contains("apikey")
        || lowercase_name.contains("password")
        || lowercase_name.contains("private")
}
