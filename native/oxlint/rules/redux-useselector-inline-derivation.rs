use oxc_ast::{
    ast::{Argument, Expression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{context::LintContext, rule::Rule};

const ALLOCATING_ARRAY_METHODS: [&str; 9] = [
    "filter",
    "map",
    "flatMap",
    "slice",
    "concat",
    "toSorted",
    "toReversed",
    "toSpliced",
    "with",
];

#[derive(Debug, Default, Clone)]
pub struct ReduxUseselectorInlineDerivation;

declare_oxc_lint!(
    /// Warn when an inline Redux selector derives a fresh collection.
    ReduxUseselectorInlineDerivation,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "useSelector derives data inline.",
);

#[derive(Clone, Copy)]
enum ReduxAllocatingCall {
    Method(&'static str),
    Namespace(&'static str, &'static str),
}

enum ReduxSelectorBody<'node, 'ast> {
    Direct(&'node Expression<'ast>),
    Block(NodeId),
}

impl Rule for ReduxUseselectorInlineDerivation {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let aliases = redux_selector_aliases(ctx);
        if aliases.is_empty() {
            return;
        }

        let selector_bodies = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call) = node.kind() else {
                    return None;
                };
                if call.arguments.len() != 1 {
                    return None;
                }
                let Expression::Identifier(callee) = &call.callee else {
                    return None;
                };
                if !aliases.contains(callee.name.as_str()) {
                    return None;
                }
                let selector = call.arguments.first().and_then(Argument::as_expression)?;
                match selector.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => function
                        .get_expression()
                        .map(ReduxSelectorBody::Direct)
                        .or_else(|| Some(ReduxSelectorBody::Block(function.node_id.get()))),
                    Expression::FunctionExpression(function) => {
                        function.body.as_ref()?;
                        Some(ReduxSelectorBody::Block(function.node_id.get()))
                    }
                    _ => None,
                }
            })
            .collect::<Vec<_>>();
        if selector_bodies.is_empty() {
            return;
        }

        let block_selector_ids = selector_bodies
            .iter()
            .filter_map(|body| match body {
                ReduxSelectorBody::Block(function_id) => Some(*function_id),
                ReduxSelectorBody::Direct(_) => None,
            })
            .collect::<FxHashSet<_>>();
        let mut block_results = FxHashMap::default();
        if !block_selector_ids.is_empty() {
            for candidate in ctx.nodes().iter() {
                let AstKind::ReturnStatement(statement) = candidate.kind() else {
                    continue;
                };
                let Some(function_id) = local_callback_nearest_function_id(candidate.id(), ctx)
                else {
                    continue;
                };
                if !block_selector_ids.contains(&function_id)
                    || block_results.contains_key(&function_id)
                {
                    continue;
                }
                let Some(expression) = statement.argument.as_ref() else {
                    continue;
                };
                if let Some(result) = redux_returned_allocating_call(expression) {
                    block_results.insert(function_id, result);
                }
            }
        }

        for selector_body in selector_bodies {
            let result = match selector_body {
                ReduxSelectorBody::Direct(expression) => redux_returned_allocating_call(expression),
                ReduxSelectorBody::Block(function_id) => block_results.get(&function_id).copied(),
            };
            let Some((call, span)) = result else {
                continue;
            };
            let message = match call {
                ReduxAllocatingCall::Method(method) => format!(
                    "`.{method}(...)` returns a new array every render, so your component redraws on every action."
                ),
                ReduxAllocatingCall::Namespace(namespace, method) => format!(
                    "`{namespace}.{method}(...)` returns a new collection every render, so your component redraws on every action."
                ),
            };
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(span));
        }
    }
}

fn redux_selector_aliases(ctx: &LintContext<'_>) -> FxHashSet<String> {
    ctx.nodes()
        .iter()
        .find_map(|node| {
            let AstKind::Program(program) = node.kind() else {
                return None;
            };
            let (aliases, has_fallback_import) = collect_react_redux_selector_alias_names(program);
            Some(
                aliases
                    .into_iter()
                    .chain(has_fallback_import.then(|| "useSelector".to_string()))
                    .collect(),
            )
        })
        .unwrap_or_default()
}

fn redux_returned_allocating_call(
    expression: &Expression<'_>,
) -> Option<(ReduxAllocatingCall, Span)> {
    let expression = expression.get_inner_expression();
    if let Some(call) = redux_allocating_call(expression) {
        return Some((call, expression.span()));
    }
    match expression {
        Expression::ConditionalExpression(conditional) => {
            redux_returned_allocating_call(&conditional.consequent)
                .or_else(|| redux_returned_allocating_call(&conditional.alternate))
        }
        Expression::LogicalExpression(logical) => redux_returned_allocating_call(&logical.left)
            .or_else(|| redux_returned_allocating_call(&logical.right)),
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .and_then(redux_returned_allocating_call),
        _ => None,
    }
}

fn redux_allocating_call(expression: &Expression<'_>) -> Option<ReduxAllocatingCall> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
        return None;
    };
    let method = member.property.name.as_str();
    if let Expression::Identifier(namespace) = member.object.get_inner_expression() {
        let namespace = namespace.name.as_str();
        let namespace_call = match (namespace, method) {
            ("Object", "keys") => Some(ReduxAllocatingCall::Namespace("Object", "keys")),
            ("Object", "values") => Some(ReduxAllocatingCall::Namespace("Object", "values")),
            ("Object", "entries") => Some(ReduxAllocatingCall::Namespace("Object", "entries")),
            ("Object", "fromEntries") => {
                Some(ReduxAllocatingCall::Namespace("Object", "fromEntries"))
            }
            ("Object", "assign") => Some(ReduxAllocatingCall::Namespace("Object", "assign")),
            ("Array", "from") => Some(ReduxAllocatingCall::Namespace("Array", "from")),
            ("Array", "of") => Some(ReduxAllocatingCall::Namespace("Array", "of")),
            _ => None,
        };
        if namespace_call.is_some() {
            return namespace_call;
        }
    }
    ALLOCATING_ARRAY_METHODS
        .iter()
        .find(|candidate| **candidate == method)
        .copied()
        .map(ReduxAllocatingCall::Method)
}
