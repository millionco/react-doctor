use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const CONTEXT_MODULE_SOURCES: [&str; 3] = ["react", "use-context-selector", "react-tracked"];
const MESSAGE_PREFIX: &str =
    "createContext() builds a new context every render, so every consumer gets cut off & resets.";

#[derive(Debug, Default, Clone)]
pub struct NoCreateContextInRender;

declare_oxc_lint!(
    /// Disallow creating React contexts during render.
    NoCreateContextInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow creating React contexts during render.",
);

impl Rule for NoCreateContextInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !module_api_path_matches(
            &call_expression.callee,
            &["createContext"],
            &CONTEXT_MODULE_SOURCES,
            true,
            ctx,
        ) && !is_global_react_create_context_call(call_expression, ctx)
        {
            return;
        }
        let Some(function_node) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        let Some(component_or_hook_name) = component_or_hook_function_name(function_node, ctx)
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{MESSAGE_PREFIX} (called inside \"{component_or_hook_name}\")"
            ))
            .with_label(call_expression.span),
        );
    }
}

fn is_global_react_create_context_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Expression::Identifier(identifier) = member_expression.object().get_inner_expression()
    else {
        return false;
    };
    identifier.name == "React"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
        && member_expression.static_property_name() == Some("createContext")
}
