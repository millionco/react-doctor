use oxc_ast::{
    ast::{BindingPattern, Expression, FormalParameters},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::node::NodeId;

use crate::{context::LintContext, rule::Rule, AstNode};

#[derive(Debug, Default, Clone)]
pub struct JsAsyncReduceWithoutAwaitedAcc;

enum FirstParameterShape {
    Identifier(String),
    Destructured,
}

declare_oxc_lint!(
    /// Warns when an async reduce callback does not await its accumulator.
    JsAsyncReduceWithoutAwaitedAcc,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when an async reduce callback does not await its accumulator.",
);

impl Rule for JsAsyncReduceWithoutAwaitedAcc {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(reduce_call) = node.kind() else {
            return;
        };
        let Some(method_name) = reduce_call
            .callee
            .as_member_expression()
            .and_then(|member_expression| member_expression.static_property_name())
            .filter(|method_name| matches!(*method_name, "reduce" | "reduceRight"))
        else {
            return;
        };
        let Some(reducer) = reduce_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(Expression::get_inner_expression)
        else {
            return;
        };
        let (parameters, reducer_node_id, reducer_span) = match reducer {
            Expression::ArrowFunctionExpression(function) if function.r#async => {
                (&function.params, function.node_id.get(), function.span)
            }
            Expression::FunctionExpression(function) if function.r#async => {
                (&function.params, function.node_id.get(), function.span)
            }
            _ => return,
        };
        let Some(first_parameter) = classify_first_parameter(parameters) else {
            return;
        };
        let (has_direct_await, awaited_accumulator_names) =
            collect_direct_awaits(reducer_node_id, ctx);
        if !has_direct_await {
            return;
        }

        match first_parameter {
            FirstParameterShape::Destructured => {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This async `.{method_name}` reducer destructures its accumulator, but every run after the first gets a Promise, so the pieces come out empty & the work is lost. Await it first: `async (previous, item) => {{ const [...] = await previous; ...; return [...]; }}`, & seed with `Promise.resolve([...])`"
                    ))
                    .with_label(reducer_span),
                );
            }
            FirstParameterShape::Identifier(accumulator_name) => {
                if awaited_accumulator_names
                    .iter()
                    .any(|awaited_name| awaited_name == &accumulator_name)
                {
                    return;
                }
                let previous_parameter_name = ["previous", "prev", "priorResult"]
                    .into_iter()
                    .find(|candidate| *candidate != accumulator_name)
                    .unwrap_or("priorResult");
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This async `.{method_name}` reducer never awaits its accumulator \"{accumulator_name}\", so each run gets a Promise instead of the real value & the work is lost. Reassign it at the top (`{accumulator_name} = await {accumulator_name};`), or rewrite as `async ({previous_parameter_name}, item) => {{ const {accumulator_name} = await {previous_parameter_name}; ...; return {accumulator_name}; }}`, & seed with `Promise.resolve(...)`"
                    ))
                    .with_label(reducer_span),
                );
            }
        }
    }
}

fn classify_first_parameter(parameters: &FormalParameters<'_>) -> Option<FirstParameterShape> {
    let pattern = &parameters.items.first()?.pattern;
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            Some(FirstParameterShape::Identifier(identifier.name.to_string()))
        }
        BindingPattern::ArrayPattern(_) | BindingPattern::ObjectPattern(_) => {
            Some(FirstParameterShape::Destructured)
        }
        BindingPattern::AssignmentPattern(assignment) => match &assignment.left {
            BindingPattern::BindingIdentifier(identifier) => {
                Some(FirstParameterShape::Identifier(identifier.name.to_string()))
            }
            BindingPattern::ArrayPattern(_) | BindingPattern::ObjectPattern(_) => {
                Some(FirstParameterShape::Destructured)
            }
            BindingPattern::AssignmentPattern(_) => None,
        },
    }
}

fn collect_direct_awaits(reducer_node_id: NodeId, ctx: &LintContext<'_>) -> (bool, Vec<String>) {
    let mut has_direct_await = false;
    let mut awaited_accumulator_names = Vec::new();
    for candidate in ctx.nodes().iter() {
        let AstKind::AwaitExpression(await_expression) = candidate.kind() else {
            continue;
        };
        if !is_in_same_function_scope(candidate, reducer_node_id, ctx) {
            continue;
        }
        has_direct_await = true;
        if let Expression::Identifier(identifier) = await_expression.argument.get_inner_expression()
        {
            awaited_accumulator_names.push(identifier.name.to_string());
        }
    }
    (has_direct_await, awaited_accumulator_names)
}

fn is_in_same_function_scope(
    candidate: &AstNode<'_>,
    reducer_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if ancestor.id() == reducer_node_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}
