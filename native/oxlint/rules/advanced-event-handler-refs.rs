use oxc_ast::{
    ast::{Argument, ArrayExpressionElement, Expression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const REACT_STABLE_HANDLER_HOOK_NAMES: [&str; 2] = ["useCallback", "useEffectEvent"];
const CUSTOM_STABLE_HANDLER_HOOK_NAMES: [&str; 5] = [
    "useEffectEvent",
    "useEvent",
    "useEventCallback",
    "useMemoizedFn",
    "useStableCallback",
];
const SUBSCRIPTION_METHOD_NAMES: [&str; 7] = [
    "subscribe",
    "addEventListener",
    "addListener",
    "on",
    "watch",
    "listen",
    "sub",
];

#[derive(Debug, Default, Clone)]
pub struct AdvancedEventHandlerRefs;

declare_oxc_lint!(
    /// Warns when an effect re-subscribes because its handler identity changes.
    AdvancedEventHandlerRefs,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when an effect re-subscribes on every handler change.",
);

impl Rule for AdvancedEventHandlerRefs {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(effect_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx) {
            return;
        }
        let Some(callback_body_span) = effect_callback_body_span(effect_call) else {
            return;
        };
        let Some(Expression::ArrayExpression(dependencies)) = effect_call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            return;
        };

        let dependency_symbols = dependencies
            .elements
            .iter()
            .filter_map(ArrayExpressionElement::as_expression)
            .filter_map(|dependency| {
                let Expression::Identifier(identifier) = dependency else {
                    return None;
                };
                Some((
                    identifier.name.as_str(),
                    ctx.scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id(),
                ))
            })
            .collect::<FxHashMap<_, _>>();
        if dependency_symbols.is_empty() {
            return;
        }

        let mut registered_handler_name = None;
        let mut subscription_receiver_names = FxHashSet::default();
        for candidate in ctx.nodes().iter() {
            if !callback_body_span.contains_inclusive(candidate.span()) {
                continue;
            }
            let AstKind::CallExpression(subscription_call) = candidate.kind() else {
                continue;
            };
            let Some(subscription_member) = subscription_call.callee.as_member_expression() else {
                continue;
            };
            if !member_expression_identifier_property_name(subscription_member)
                .is_some_and(|method_name| SUBSCRIPTION_METHOD_NAMES.contains(&method_name))
            {
                continue;
            }
            if let Some(receiver_name) = member_root_identifier_name(subscription_member.object()) {
                subscription_receiver_names.insert(receiver_name);
            }
            let Some(Expression::Identifier(handler_identifier)) = subscription_call
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            if registered_handler_name.is_none()
                && dependency_symbols.contains_key(handler_identifier.name.as_str())
            {
                registered_handler_name = Some(handler_identifier.name.as_str());
            }
        }

        let Some(registered_handler_name) = registered_handler_name else {
            return;
        };
        if dependency_symbols
            .get(registered_handler_name)
            .copied()
            .flatten()
            .is_some_and(|symbol_id| stable_handler_symbol(symbol_id, ctx))
        {
            return;
        }
        if dependency_symbols
            .iter()
            .any(|(dependency_name, symbol_id)| {
                *dependency_name != registered_handler_name
                    && subscription_receiver_names.contains(dependency_name)
                    && !symbol_id.is_some_and(|symbol_id| stable_ref_symbol(symbol_id, ctx))
            })
        {
            return;
        }

        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "useEffect re-adds the \"{registered_handler_name}\" listener every time the handler changes."
            ))
            .with_label(effect_call.span),
        );
    }
}

fn effect_callback_body_span(
    effect_call: &oxc_ast::ast::CallExpression<'_>,
) -> Option<oxc_span::Span> {
    match effect_call
        .arguments
        .first()
        .and_then(Argument::as_expression)?
    {
        Expression::ArrowFunctionExpression(function) => Some(function.body.span()),
        Expression::FunctionExpression(function) => Some(function.body.as_ref()?.span()),
        _ => None,
    }
}

fn stable_handler_symbol(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(initializer) = &declarator.init else {
        return false;
    };
    match initializer {
        Expression::CallExpression(call_expression) => {
            is_react_hook_call(call_expression, &REACT_STABLE_HANDLER_HOOK_NAMES, ctx)
                || call_callee_name(call_expression).is_some_and(|callee_name| {
                    CUSTOM_STABLE_HANDLER_HOOK_NAMES.contains(&callee_name)
                        || is_throttled_handler_hook_name(callee_name)
                })
                || is_empty_deps_use_memo_call(call_expression, ctx)
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression_identifier_property_name(member_expression) == Some("current")
            }),
    }
}

fn stable_ref_symbol(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(
        declarator.init.as_ref(),
        Some(Expression::CallExpression(call_expression))
            if is_react_hook_call(call_expression, &["useRef"], ctx)
    )
}

fn is_empty_deps_use_memo_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    is_react_hook_call(call_expression, &["useMemo"], ctx)
        && matches!(
            call_expression
                .arguments
                .get(1)
                .and_then(Argument::as_expression),
            Some(Expression::ArrayExpression(dependencies)) if dependencies.elements.is_empty()
        )
}

fn call_callee_name<'a>(call_expression: &'a oxc_ast::ast::CallExpression<'a>) -> Option<&'a str> {
    match &call_expression.callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(member_expression_identifier_property_name),
    }
}

fn is_throttled_handler_hook_name(callee_name: &str) -> bool {
    let lowercase_name = callee_name.to_ascii_lowercase();
    if !lowercase_name.starts_with("use") {
        return false;
    }
    ["throttle", "debounce"].iter().any(|marker| {
        lowercase_name.find(marker).is_some_and(|marker_index| {
            marker_index >= 3
                && lowercase_name.as_bytes()[3..marker_index]
                    .iter()
                    .all(|character| character.is_ascii_alphanumeric() || *character == b'_')
        })
    })
}

fn member_root_identifier_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => member_root_identifier_name(expression.as_member_expression()?.object()),
    }
}
