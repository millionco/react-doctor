use oxc_ast::{
    AstKind,
    ast::{ChainElement, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::is_react_hook_name,
};

const EMPTY_REGISTRY_CONSTRUCTOR_NAMES: [&str; 4] = ["Map", "Set", "WeakMap", "WeakSet"];
const TRIVIAL_INITIALIZER_NAMES: [&str; 7] = [
    "Boolean",
    "String",
    "Number",
    "Array",
    "Object",
    "parseInt",
    "parseFloat",
];

#[derive(Debug, Default, Clone)]
pub struct RerenderLazyRefInit;

declare_oxc_lint!(
    /// Warns when a useRef initializer rebuilds an expensive value on every render.
    RerenderLazyRefInit,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when a useRef initializer rebuilds an expensive value on every render.",
);

impl Rule for RerenderLazyRefInit {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(reference_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(reference_call, &["useRef"], ctx) {
            return;
        }
        let Some(initializer) = reference_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(Expression::get_inner_expression)
        else {
            return;
        };
        let (callee, is_new_call, runtime_argument_count) = match initializer {
            Expression::CallExpression(call_expression) => (
                &call_expression.callee,
                false,
                call_expression.arguments.len(),
            ),
            Expression::ChainExpression(chain_expression) => {
                let ChainElement::CallExpression(call_expression) = &chain_expression.expression
                else {
                    return;
                };
                (
                    &call_expression.callee,
                    false,
                    call_expression.arguments.len(),
                )
            }
            Expression::NewExpression(new_expression) => {
                (&new_expression.callee, true, new_expression.arguments.len())
            }
            _ => return,
        };
        let callee = callee.get_inner_expression();
        let callee_name = match callee {
            Expression::Identifier(identifier) => identifier.name.as_str(),
            expression => expression
                .as_member_expression()
                .and_then(oxc_ast::ast::MemberExpression::static_property_name)
                .unwrap_or("fn"),
        };
        if TRIVIAL_INITIALIZER_NAMES.contains(&callee_name) {
            return;
        }
        if is_new_call
            && runtime_argument_count == 0
            && EMPTY_REGISTRY_CONSTRUCTOR_NAMES
                .iter()
                .any(|constructor_name| {
                    is_proven_global_namespace_reference(callee, constructor_name, ctx)
                })
        {
            return;
        }
        if !is_new_call && is_react_hook_name(callee_name) {
            return;
        }
        let call_shape = if is_new_call {
            format!("new {callee_name}()")
        } else {
            format!("{callee_name}()")
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "useRef({call_shape}) rebuilds this value on every render & throws it away."
            ))
            .with_label(initializer.span()),
        );
    }
}
