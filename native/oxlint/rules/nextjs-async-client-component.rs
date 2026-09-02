use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, FunctionType},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NextjsAsyncClientComponent;

declare_oxc_lint!(
    /// Disallow async Next.js client components.
    NextjsAsyncClientComponent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow async Next.js client components.",
);

impl Rule for NextjsAsyncClientComponent {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !ctx
            .nodes()
            .program()
            .directives
            .iter()
            .any(|directive| directive.directive == "use client")
        {
            return;
        }
        match node.kind() {
            AstKind::Function(function)
                if function.r#type == FunctionType::FunctionDeclaration
                    && function.r#async
                    && function
                        .id
                        .as_ref()
                        .is_some_and(|identifier| is_uppercase_name(identifier.name.as_str())) =>
            {
                let component_name = function.id.as_ref().unwrap().name.as_str();
                ctx.diagnostic(
                    async_client_component_diagnostic(component_name).with_label(function.span),
                );
            }
            AstKind::VariableDeclarator(declarator) => {
                let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                    return;
                };
                if !is_uppercase_name(identifier.name.as_str()) {
                    return;
                }
                let Some(initializer) = &declarator.init else {
                    return;
                };
                let component_function = unwrap_object_freeze_or_seal(initializer, ctx);
                let is_async = match component_function {
                    Expression::ArrowFunctionExpression(function) => function.r#async,
                    Expression::FunctionExpression(function) => function.r#async,
                    _ => false,
                };
                if is_async {
                    ctx.diagnostic(
                        async_client_component_diagnostic(identifier.name.as_str())
                            .with_label(declarator.span),
                    );
                }
            }
            _ => {}
        }
    }
}

fn async_client_component_diagnostic(component_name: &str) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "Async client component \"{component_name}\" fails to render because client components can't be async."
    ))
}

fn is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn unwrap_object_freeze_or_seal<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &LintContext<'a>,
) -> &'b Expression<'a> {
    let mut current_expression = expression.get_inner_expression();
    loop {
        let Expression::CallExpression(call_expression) = current_expression else {
            return current_expression;
        };
        let Expression::StaticMemberExpression(member_expression) =
            call_expression.callee.get_inner_expression()
        else {
            return current_expression;
        };
        let Expression::Identifier(receiver) = member_expression.object.get_inner_expression()
        else {
            return current_expression;
        };
        if receiver.name != "Object"
            || ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id()
                .is_some()
            || !matches!(member_expression.property.name.as_str(), "freeze" | "seal")
        {
            return current_expression;
        }
        let Some(wrapped_expression) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return current_expression;
        };
        current_expression = wrapped_expression.get_inner_expression();
    }
}
