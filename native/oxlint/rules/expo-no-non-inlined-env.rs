use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const COMPUTED_MESSAGE: &str = "Computed `process.env[...]` access isn't inlined by babel-preset-expo and is `undefined` at runtime. Use static `process.env.EXPO_PUBLIC_NAME`.";
const DESTRUCTURING_MESSAGE: &str = "Destructuring `process.env` isn't inlined by babel-preset-expo, so the values are `undefined` at runtime. Read each var via `process.env.EXPO_PUBLIC_NAME`.";

#[derive(Debug, Default, Clone)]
pub struct ExpoNoNonInlinedEnv;

declare_oxc_lint!(
    /// Disallow Expo environment-variable reads that Metro cannot inline.
    ExpoNoNonInlinedEnv,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow non-inlinable Expo environment-variable reads.",
);

impl Rule for ExpoNoNonInlinedEnv {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_react_native_file_active(ctx)
            && !expo_non_inlined_env_is_node_or_build_file(
                &ctx.file_path().to_string_lossy().replace('\\', "/"),
            )
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::ComputedMemberExpression(member_expression) => {
                if !expo_non_inlined_env_is_process_env(&member_expression.object) {
                    return;
                }
                if matches!(
                    member_expression.expression.get_inner_expression(),
                    Expression::StringLiteral(literal)
                        if !literal.value.starts_with("EXPO_PUBLIC_")
                ) {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(COMPUTED_MESSAGE).with_label(member_expression.span),
                );
            }
            AstKind::VariableDeclarator(declarator) => {
                if !matches!(declarator.id, BindingPattern::ObjectPattern(_))
                    || declarator
                        .init
                        .as_ref()
                        .is_none_or(|initializer| !expo_non_inlined_env_is_process_env(initializer))
                {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(DESTRUCTURING_MESSAGE).with_label(declarator.span),
                );
            }
            _ => {}
        }
    }
}

fn expo_non_inlined_env_is_process_env(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::StaticMemberExpression(member_expression)
            if member_expression.property.name == "env"
                && matches!(
                    &member_expression.object,
                    Expression::Identifier(identifier) if identifier.name == "process"
                )
    )
}

fn expo_non_inlined_env_is_node_or_build_file(filename: &str) -> bool {
    let filename = filename.strip_prefix("./").unwrap_or(filename);
    expo_non_inlined_env_has_directory(filename, &["scripts", "tools", "tooling", "cli", "bin"])
        || expo_non_inlined_env_has_directory(filename, &["__tests__"])
        || expo_non_inlined_env_has_named_extension(filename, ".config")
        || expo_non_inlined_env_has_named_extension(filename, "+api")
        || expo_non_inlined_env_has_named_extension(filename, "+html")
        || expo_non_inlined_env_has_named_extension(filename, ".server")
        || expo_non_inlined_env_has_named_extension(filename, ".test")
        || expo_non_inlined_env_has_named_extension(filename, ".spec")
        || expo_non_inlined_env_has_named_extension(filename, ".e2e")
}

fn expo_non_inlined_env_has_directory(filename: &str, names: &[&str]) -> bool {
    filename
        .split('/')
        .any(|segment| names.contains(&segment))
}

fn expo_non_inlined_env_has_named_extension(filename: &str, marker: &str) -> bool {
    const SCRIPT_EXTENSIONS: [&str; 12] = [
        "js", "jsx", "ts", "tsx", "cjs", "cjsx", "cts", "ctsx", "mjs", "mjsx", "mts",
        "mtsx",
    ];
    SCRIPT_EXTENSIONS
        .iter()
        .any(|extension| filename.ends_with(&format!("{marker}.{extension}")))
}
